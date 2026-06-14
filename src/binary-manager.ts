import { Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import type { IncomingMessage } from "http";
import { toMessage } from "./types";

/** GitHub release asset name for each supported platform. */
const ASSET_BY_PLATFORM: Record<string, string> = {
	darwin: "recalla-macos",
	linux: "recalla-linux",
	win32: "recalla-windows.exe",
};

const RELEASE_BASE =
	"https://github.com/Tensorboyalive/recalla/releases/latest/download";

const MAX_REDIRECTS = 5;
const BYTES_PER_MB = 1_048_576;
const EXECUTABLE_MODE = 0o755;

type ProgressFn = (received: number, total: number) => void;

/**
 * Downloads, caches, and locates the standalone `recalla` engine binary so a
 * non-technical user never has to install anything by hand.
 */
export class BinaryManager {
	private readonly binDir: string;

	constructor(pluginDir: string) {
		this.binDir = path.join(pluginDir, "bin");
	}

	/** True when the current OS has a published engine build. */
	isPlatformSupported(): boolean {
		return this.assetName() !== null;
	}

	/** Absolute path where the managed binary lives (it may not exist yet). */
	binaryPath(): string {
		const suffix = process.platform === "win32" ? ".exe" : "";
		return path.join(this.binDir, `recalla-engine${suffix}`);
	}

	/** True when a managed binary has already been downloaded and cached. */
	isDownloaded(): boolean {
		try {
			return fs.statSync(this.binaryPath()).isFile();
		} catch {
			return false;
		}
	}

	/**
	 * Download (or update) the engine from the latest GitHub release, writing to
	 * a temp file first and reporting progress through a single reused Notice.
	 */
	async downloadLatest(): Promise<void> {
		const asset = this.assetName();
		if (asset === null) {
			throw new Error(
				`Unsupported platform "${process.platform}": no Recalla engine build is available.`
			);
		}

		fs.mkdirSync(this.binDir, { recursive: true });

		const url = `${RELEASE_BASE}/${asset}`;
		const target = this.binaryPath();
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

			fs.renameSync(tmp, target);
			if (process.platform !== "win32") {
				fs.chmodSync(target, EXECUTABLE_MODE);
			}
			notice.setMessage("Recalla: engine ready.");
			window.setTimeout(() => notice.hide(), 4000);
		} catch (err) {
			this.safeUnlink(tmp);
			notice.hide();
			throw new Error(`engine download failed: ${toMessage(err)}`);
		}
	}

	private assetName(): string | null {
		return ASSET_BY_PLATFORM[process.platform] ?? null;
	}

	/** Stream a URL to disk, following redirects manually (GitHub uses 302s). */
	private downloadTo(
		url: string,
		dest: string,
		onProgress: ProgressFn,
		redirectsLeft: number = MAX_REDIRECTS
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const request = https.get(url, (res: IncomingMessage) => {
				const status = res.statusCode ?? 0;
				const location = res.headers.location;

				if (status >= 300 && status < 400 && location) {
					res.resume();
					if (redirectsLeft <= 0) {
						reject(new Error("too many redirects."));
						return;
					}
					const next = new URL(location, url).toString();
					this.downloadTo(
						next,
						dest,
						onProgress,
						redirectsLeft - 1
					).then(resolve, reject);
					return;
				}

				if (status !== 200) {
					res.resume();
					reject(new Error(`HTTP ${status}.`));
					return;
				}

				const total = Number.parseInt(
					res.headers["content-length"] ?? "0",
					10
				);
				const totalBytes = Number.isNaN(total) ? 0 : total;
				let received = 0;
				const file = fs.createWriteStream(dest);

				res.on("data", (chunk: Buffer) => {
					received += chunk.length;
					onProgress(received, totalBytes);
				});
				res.on("error", (err: Error) => {
					this.safeUnlink(dest);
					reject(err);
				});
				file.on("error", (err: Error) => {
					this.safeUnlink(dest);
					reject(err);
				});
				file.on("finish", () => file.close(() => resolve()));
				res.pipe(file);
			});

			request.on("error", reject);
		});
	}

	private safeUnlink(target: string): void {
		try {
			fs.unlinkSync(target);
		} catch {
			/* nothing to clean up */
		}
	}
}
