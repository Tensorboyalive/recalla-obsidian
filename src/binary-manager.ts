import { Notice } from "obsidian";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import type { IncomingMessage } from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import {
	expectedReleaseDigest,
	MANAGED_ENGINE_RELEASE,
	MANAGED_ENGINE_VERSION,
	parsePublishedChecksum,
	resolveBinaryAsset,
} from "./binary-release";
import { toMessage } from "./types";

const RELEASE_BASE = `https://github.com/Tensorboyalive/recalla/releases/download/${MANAGED_ENGINE_RELEASE}`;

const MAX_REDIRECTS = 5;
const BYTES_PER_MB = 1_048_576;
const MAX_BINARY_BYTES = 250 * BYTES_PER_MB;
const MAX_CHECKSUM_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const EXECUTABLE_SMOKE_TIMEOUT_MS = 15_000;
const EXECUTABLE_MODE = 0o755;

type ProgressFn = (received: number, total: number) => void;

/**
 * Downloads, caches, and locates the standalone `recalla` engine binary so a
 * non-technical user never has to install anything by hand.
 */
export class BinaryManager {
	private readonly binDir: string;
	private inflight: Promise<void> | null = null;
	private verifiedCache: {
		target: string;
		size: number;
		mtimeMs: number;
		digest: string;
	} | null = null;

	constructor(pluginDir: string) {
		this.binDir = path.join(pluginDir, "bin");
	}

	/** True when the current OS has a published engine build. */
	isPlatformSupported(): boolean {
		try {
			this.assetName();
			return true;
		} catch {
			return false;
		}
	}

	/** Absolute path where the managed binary lives (it may not exist yet). */
	binaryPath(): string {
		return path.join(this.binDir, MANAGED_ENGINE_RELEASE, this.assetName());
	}

	/** True when a managed binary has already been downloaded and cached. */
	isDownloaded(): boolean {
		try {
			const target = this.binaryPath();
			const stat = fs.statSync(target);
			if (!stat.isFile()) return false;
			const trusted = expectedReleaseDigest(this.assetName());
			if (
				this.verifiedCache?.target === target &&
				this.verifiedCache.size === stat.size &&
				this.verifiedCache.mtimeMs === stat.mtimeMs &&
				this.verifiedCache.digest === trusted
			) {
				return true;
			}
			const digest = this.hashFile(target);
			if (digest !== trusted) return false;
			this.verifiedCache = {
				target,
				size: stat.size,
				mtimeMs: stat.mtimeMs,
				digest,
			};
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * True when a managed binary exists on disk but fails digest verification.
	 * Callers use this to warn instead of silently falling back to PATH.
	 */
	hasCorruptManagedBinary(): boolean {
		try {
			return fs.statSync(this.binaryPath()).isFile() && !this.isDownloaded();
		} catch {
			return false;
		}
	}

	/**
	 * Download the pinned managed engine, writing to a temp file first and
	 * reporting progress through a single reused Notice.
	 */
	async downloadLatest(): Promise<void> {
		// Single-flight: overlapping palette/onboarding triggers must not race on the
		// shared temp, target, and backup paths.
		if (this.inflight !== null) return this.inflight;
		this.inflight = this.runDownload().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	private async runDownload(): Promise<void> {
		const asset = this.assetName();

		const url = `${RELEASE_BASE}/${asset}`;
		const target = this.binaryPath();
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const tmp = `${target}.download`;
		const notice = new Notice("Recalla: downloading engine...", 0);

		try {
			await this.downloadTo(url, tmp, (received, total) => {
				if (total > 0) {
					const pct = Math.floor((received / total) * 100);
					notice.setMessage(`Recalla: downloading engine... ${pct}%`);
				} else {
					const mb = (received / BYTES_PER_MB).toFixed(1);
					notice.setMessage(`Recalla: downloading engine... ${mb} MB`);
				}
			});

			// Verify integrity. The binary is executed, so a mismatch must abort.
			notice.setMessage("Recalla: verifying engine...");
			await this.verifyChecksum(tmp, `${url}.sha256`, asset);
			this.installVerified(tmp, target);
			this.removeLegacyCache();
			notice.setMessage("Recalla: engine ready.");
			window.setTimeout(() => notice.hide(), 4000);
		} catch (err) {
			this.safeUnlink(tmp);
			notice.hide();
			throw new Error(`engine download failed: ${toMessage(err)}`);
		}
	}

	/** Replace an existing engine without leaving a broken partial update. */
	private installVerified(tmp: string, target: string): void {
		const backup = `${target}.previous`;
		let movedExisting = false;
		let installedNew = false;
		this.safeUnlink(backup);
		try {
			if (fs.existsSync(target)) {
				fs.renameSync(target, backup);
				movedExisting = true;
			}
			fs.renameSync(tmp, target);
			installedNew = true;
			if (process.platform !== "win32") {
				fs.chmodSync(target, EXECUTABLE_MODE);
			}
			const version = execFileSync(target, ["--version"], {
				encoding: "utf8",
				timeout: EXECUTABLE_SMOKE_TIMEOUT_MS,
				windowsHide: true,
			}).trim();
			if (version !== `recalla ${MANAGED_ENGINE_VERSION}`) {
				throw new Error(`unexpected engine version: ${version || "no output"}`);
			}
			this.safeUnlink(backup);
		} catch (err) {
			if (installedNew) {
				this.safeUnlink(target);
			}
			if (movedExisting && fs.existsSync(backup)) {
				fs.renameSync(backup, target);
			}
			throw err;
		}
	}

	private assetName(): string {
		return resolveBinaryAsset(process.platform, process.arch);
	}

	/** Stream a bounded HTTPS response to disk, following GitHub redirects. */
	private downloadTo(
		url: string,
		dest: string,
		onProgress: ProgressFn,
		redirectsLeft: number = MAX_REDIRECTS,
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const request = https.get(
				url,
				{ timeout: REQUEST_TIMEOUT_MS },
				(res: IncomingMessage) => {
					const status = res.statusCode ?? 0;
					const location = res.headers.location;

					if (status >= 300 && status < 400 && location) {
						res.destroy();
						if (redirectsLeft <= 0) {
							reject(new Error("too many redirects"));
							return;
						}
						const next = new URL(location, url);
						if (next.protocol !== "https:") {
							reject(new Error("refusing a non-HTTPS release redirect"));
							return;
						}
						this.downloadTo(
							next.toString(),
							dest,
							onProgress,
							redirectsLeft - 1,
						).then(resolve, reject);
						return;
					}

					if (status !== 200) {
						res.destroy();
						reject(new Error(`HTTP ${status}`));
						return;
					}

					const total = Number.parseInt(
						res.headers["content-length"] ?? "0",
						10,
					);
					const totalBytes = Number.isNaN(total) ? 0 : total;
					if (totalBytes > MAX_BINARY_BYTES) {
						res.destroy();
						reject(new Error("release binary exceeds the 250 MB limit"));
						return;
					}

					let received = 0;
					let settled = false;
					const file = fs.createWriteStream(dest);
					const fail = (err: Error) => {
						if (settled) return;
						settled = true;
						res.destroy();
						file.once("close", () => {
							this.safeUnlink(dest);
							reject(err);
						});
						file.destroy();
					};

					res.setTimeout(REQUEST_TIMEOUT_MS, () =>
						fail(new Error("release download timed out")),
					);
					res.on("data", (chunk: Buffer) => {
						received += chunk.length;
						if (received > MAX_BINARY_BYTES) {
							fail(new Error("release binary exceeds the 250 MB limit"));
							return;
						}
						onProgress(received, totalBytes);
					});
					res.on("error", fail);
					file.on("error", fail);
					file.on("finish", () => {
						if (settled) return;
						settled = true;
						file.close((err) => (err ? reject(err) : resolve()));
					});
					res.pipe(file);
				},
			);

			// Bounds connection setup (DNS/TCP/TLS) as well as an idle connected socket.
			request.on("timeout", () =>
				request.destroy(new Error("release request timed out")),
			);
			request.on("error", (err) => {
				this.safeUnlink(dest);
				reject(err);
			});
		});
	}

	/**
	 * Verify the downloaded file against its published .sha256. Missing,
	 * malformed, or mismatched checksums fail closed because this file executes.
	 */
	private async verifyChecksum(
		filePath: string,
		checksumUrl: string,
		expectedAsset: string,
	): Promise<void> {
		const trusted = expectedReleaseDigest(expectedAsset);
		const published = parsePublishedChecksum(
			await this.fetchText(checksumUrl),
			expectedAsset,
		);
		if (published !== trusted) {
			this.safeUnlink(filePath);
			throw new Error(
				"published checksum does not match the trusted plugin digest",
			);
		}
		const actual = this.hashFile(filePath);
		if (actual !== trusted) {
			this.safeUnlink(filePath);
			throw new Error(
				`checksum mismatch (expected ${trusted}, got ${actual}). Download rejected.`,
			);
		}
	}

	/** Fetch a small bounded HTTPS text resource, following redirects. */
	private fetchText(
		url: string,
		redirectsLeft: number = MAX_REDIRECTS,
	): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const request = https.get(
				url,
				{ timeout: REQUEST_TIMEOUT_MS },
				(res: IncomingMessage) => {
					const status = res.statusCode ?? 0;
					const location = res.headers.location;
					if (status >= 300 && status < 400 && location) {
						res.destroy();
						if (redirectsLeft <= 0) {
							reject(new Error("too many redirects"));
							return;
						}
						const next = new URL(location, url);
						if (next.protocol !== "https:") {
							reject(new Error("refusing a non-HTTPS checksum redirect"));
							return;
						}
						this.fetchText(next.toString(), redirectsLeft - 1).then(
							resolve,
							reject,
						);
						return;
					}
					if (status !== 200) {
						res.destroy();
						reject(new Error(`HTTP ${status}`));
						return;
					}
					let body = "";
					let received = 0;
					res.setEncoding("utf8");
					res.setTimeout(REQUEST_TIMEOUT_MS, () =>
						res.destroy(new Error("checksum download timed out")),
					);
					res.on("data", (chunk: string) => {
						received += Buffer.byteLength(chunk);
						if (received > MAX_CHECKSUM_BYTES) {
							res.destroy(new Error("checksum response is too large"));
							return;
						}
						body += chunk;
					});
					res.on("end", () => resolve(body));
					res.on("error", reject);
				},
			);
			request.on("timeout", () =>
				request.destroy(new Error("checksum request timed out")),
			);
			request.on("error", reject);
		});
	}

	/** Best-effort cleanup of the pre-0.1.1 unversioned cache location. */
	private removeLegacyCache(): void {
		this.safeUnlink(path.join(this.binDir, "recalla-engine"));
		this.safeUnlink(path.join(this.binDir, "recalla-engine.exe"));
	}

	private hashFile(target: string): string {
		const hash = crypto.createHash("sha256");
		const descriptor = fs.openSync(target, "r");
		const chunk = Buffer.allocUnsafe(BYTES_PER_MB);
		try {
			let bytesRead = 0;
			do {
				bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
				if (bytesRead > 0) hash.update(chunk.subarray(0, bytesRead));
			} while (bytesRead > 0);
		} finally {
			fs.closeSync(descriptor);
		}
		return hash.digest("hex");
	}

	private safeUnlink(target: string): void {
		if (this.verifiedCache?.target === target) this.verifiedCache = null;
		try {
			fs.unlinkSync(target);
		} catch {
			/* nothing to clean up */
		}
	}
}
