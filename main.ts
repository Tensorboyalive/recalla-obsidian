import {
	FileSystemAdapter,
	Notice,
	Plugin,
	TFile,
	type WorkspaceLeaf,
	requestUrl,
} from "obsidian";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	type AskOutcome,
	DEFAULT_SETTINGS,
	type RecallaSettings,
	type ServerState,
	toMessage,
} from "./src/types";
import { BinaryManager } from "./src/binary-manager";
import { MANAGED_ENGINE_VERSION } from "./src/binary-release";
import { parseAskOutput, classifyAskError } from "./src/ask";
import { RECALLA_CHAT_VIEW, RecallaChatView } from "./src/chat-view";
import { RecallaSearchModal } from "./src/search-modal";
import { RecallaSettingTab } from "./src/settings-tab";
import { isSuccessfulExit, isValidPort } from "./src/runtime";

const REINDEX_DEBOUNCE_MS = 3000;
const SERVER_READY_TIMEOUT_MS = 20000;
const SERVER_POLL_INTERVAL_MS = 400;
const SERVER_STOP_TIMEOUT_MS = 5000;
const HEALTH_PROBE_TIMEOUT_MS = 3000;

export default class RecallaPlugin extends Plugin {
	settings: RecallaSettings = DEFAULT_SETTINGS;
	binary!: BinaryManager;
	serverProcess: ChildProcess | null = null;
	indexing = false;
	private statusBarEl: HTMLElement | null = null;
	private reindexTimer: ReturnType<typeof setTimeout> | null = null;
	private serverStopTimer: ReturnType<typeof setTimeout> | null = null;
	private warnedCorruptEngine = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.binary = new BinaryManager(this.pluginDir());

		this.registerView(
			RECALLA_CHAT_VIEW,
			(leaf: WorkspaceLeaf) => new RecallaChatView(leaf, this),
		);
		this.addRibbonIcon("messages-square", "Recalla chat", () => {
			void this.activateChatView();
		});

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("recalla-status-bar");
		this.updateStatusBar();

		this.addCommand({
			id: "open-chat",
			name: "Recalla: Open chat",
			callback: () => {
				void this.activateChatView();
			},
		});

		this.addCommand({
			id: "download-engine",
			name: "Recalla: Download or update the engine",
			callback: () => {
				void this.downloadEngine();
			},
		});

		this.addCommand({
			id: "make-agent-readable",
			name: "Recalla: Make my vault agent-readable",
			callback: () => {
				void this.makeAgentReadable();
			},
		});

		this.addCommand({
			id: "index",
			name: "Recalla: Reindex vault",
			callback: () => {
				void this.indexVault();
			},
		});

		this.addCommand({
			id: "serve-start",
			name: "Recalla: Start local server",
			callback: () => this.startServer(),
		});

		this.addCommand({
			id: "serve-stop",
			name: "Recalla: Stop local server",
			callback: () => this.stopServer(),
		});

		this.addCommand({
			id: "search",
			name: "Recalla: Search vault (agent index)",
			callback: async () => {
				const ready = await this.ensureServerReady();
				if (ready) {
					new RecallaSearchModal(this.app, this).open();
				}
			},
		});

		this.addCommand({
			id: "copy-mcp",
			name: "Recalla: Copy MCP config to clipboard",
			callback: () => {
				void this.copyMcpConfig();
			},
		});

		this.addCommand({
			id: "agents",
			name: "Recalla: Generate AGENTS.md and llms.txt",
			callback: () => this.runAgents(),
		});

		this.addSettingTab(new RecallaSettingTab(this.app, this));

		if (this.settings.autoStartServer) {
			this.startServer();
		}

		if (this.settings.autoReindexOnSave) {
			this.registerEvent(
				this.app.vault.on("modify", () => this.scheduleReindex()),
			);
		}
	}

	onunload(): void {
		this.stopServer();
		if (this.reindexTimer !== null) {
			clearTimeout(this.reindexTimer);
			this.reindexTimer = null;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<RecallaSettings>,
		);
		// Legacy saved data can carry an out-of-range port straight into spawn().
		if (!isValidPort(this.settings.port)) {
			this.settings.port = DEFAULT_SETTINGS.port;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	getVaultPath(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("Recalla requires a desktop filesystem vault.");
		}
		return adapter.getBasePath();
	}

	/** Absolute path to this plugin's own folder inside the vault. */
	private pluginDir(): string {
		return path.join(this.getVaultPath(), this.manifest.dir ?? "");
	}

	/**
	 * Resolve which binary to run, in priority order:
	 * user-set path > downloaded binary > `recalla` on PATH.
	 */
	resolveBinaryPath(): string {
		const override = this.settings.recallaPath.trim();
		if (override.length > 0) {
			return override;
		}
		if (this.binary.isDownloaded()) {
			return this.binary.binaryPath();
		}
		if (!this.warnedCorruptEngine && this.binary.hasCorruptManagedBinary()) {
			this.warnedCorruptEngine = true;
			new Notice(
				"Recalla: the downloaded engine failed integrity verification and was ignored. Re-run the download command.",
			);
		}
		return "recalla";
	}

	/** True when commands will run the plugin-managed, digest-verified binary. */
	private usingManagedEngine(): boolean {
		return (
			this.settings.recallaPath.trim().length === 0 && this.binary.isDownloaded()
		);
	}

	/** Human-readable engine state for the settings tab. */
	engineStatusLabel(): string {
		const override = this.settings.recallaPath.trim();
		if (override.length > 0) {
			return `using custom path (${override})`;
		}
		if (this.binary.isDownloaded()) {
			return "downloaded and ready";
		}
		if (!this.binary.isPlatformSupported()) {
			return "no build for this platform; set a custom path";
		}
		return "not downloaded yet";
	}

	private getState(): ServerState {
		if (this.indexing) {
			return "indexing";
		}
		if (this.serverProcess !== null) {
			return "running";
		}
		return "off";
	}

	private updateStatusBar(): void {
		if (this.statusBarEl === null) {
			return;
		}
		const state = this.getState();
		this.statusBarEl.removeClass("is-off", "is-running", "is-indexing");
		if (state === "indexing") {
			this.statusBarEl.setText("Recalla: indexing...");
			this.statusBarEl.addClass("is-indexing");
		} else if (state === "running") {
			this.statusBarEl.setText(`Recalla: running :${this.settings.port}`);
			this.statusBarEl.addClass("is-running");
		} else {
			this.statusBarEl.setText("Recalla: off");
			this.statusBarEl.addClass("is-off");
		}
	}

	/** Reveal the chat panel in the right sidebar, reusing an open one. */
	async activateChatView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(RECALLA_CHAT_VIEW);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (leaf === null) {
			return;
		}
		await leaf.setViewState({ type: RECALLA_CHAT_VIEW, active: true });
		await workspace.revealLeaf(leaf);
	}

	/** Download or update the managed engine binary. */
	async downloadEngine(): Promise<void> {
		if (!this.binary.isPlatformSupported()) {
			new Notice(
				"Recalla: no engine build for this platform. Set a custom engine path in settings.",
			);
			return;
		}
		try {
			await this.binary.downloadLatest();
			this.updateStatusBar();
		} catch (err) {
			new Notice(`Recalla: ${toMessage(err)}`);
		}
	}

	/**
	 * Ensure an engine is available: trust a custom path, reuse a download, or
	 * fetch it now. Returns false if nothing usable could be obtained.
	 */
	private async ensureEngine(): Promise<boolean> {
		if (this.settings.recallaPath.trim().length > 0) {
			return true;
		}
		if (this.binary.isDownloaded()) {
			return true;
		}
		if (!this.binary.isPlatformSupported()) {
			new Notice(
				"Recalla: no engine build for this platform. Set a custom engine path in settings.",
			);
			return false;
		}
		try {
			await this.binary.downloadLatest();
			this.updateStatusBar();
			return true;
		} catch (err) {
			new Notice(`Recalla: ${toMessage(err)}`);
			return false;
		}
	}

	/** One-click onboarding: get the engine, index the vault, start serving. */
	async makeAgentReadable(): Promise<void> {
		const ready = await this.ensureEngine();
		if (!ready) {
			return;
		}
		const indexed = await this.indexVault();
		if (indexed) {
			const up = await this.ensureServerReady();
			if (up) {
				new Notice("Recalla: your vault is agent-readable and serving.");
			}
		}
	}

	/** Run `recalla ask` and return a structured outcome for the chat UI. */
	runAsk(question: string): Promise<AskOutcome> {
		return new Promise<AskOutcome>((resolve) => {
			const vaultPath = this.getVaultPath();
			const bin = this.resolveBinaryPath();
			let stdout = "";
			let stderr = "";
			let settled = false;

			const finish = (outcome: AskOutcome): void => {
				if (!settled) {
					settled = true;
					resolve(outcome);
				}
			};

			let child: ChildProcess;
			try {
				child = spawn(bin, ["ask", question, "--vault", vaultPath]);
			} catch (err) {
				finish({
					answer: "",
					sources: [],
					error: { kind: "engine-missing", message: toMessage(err) },
				});
				return;
			}

			child.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString();
			});
			child.stderr?.on("data", (data: Buffer) => {
				stderr += data.toString();
			});
			child.on("error", (err: NodeJS.ErrnoException) => {
				const kind = err.code === "ENOENT" ? "engine-missing" : "unknown";
				finish({
					answer: "",
					sources: [],
					error: { kind, message: err.message },
				});
			});
			child.on("close", (code: number | null) => {
				if (isSuccessfulExit(code)) {
					const parsed = parseAskOutput(stdout);
					finish({
						answer: parsed.answer,
						sources: parsed.sources,
						error: null,
					});
				} else {
					finish({
						answer: stdout.trim(),
						sources: [],
						error: classifyAskError(stderr || stdout),
					});
				}
			});
		});
	}

	/** Open a cited note from a chat answer. */
	openSource(target: string): void {
		const file = this.app.vault.getAbstractFileByPath(target);
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf(false).openFile(file);
			return;
		}
		void this.app.workspace.openLinkText(target, "", false);
	}

	/** Index the vault. Resolves true on success, false on failure. */
	indexVault(): Promise<boolean> {
		if (this.indexing) {
			new Notice("Recalla is already indexing.");
			return Promise.resolve(false);
		}
		return new Promise<boolean>((resolve) => {
			const vaultPath = this.getVaultPath();
			this.indexing = true;
			this.updateStatusBar();
			new Notice("Recalla: indexing vault...");

			const child = spawn(this.resolveBinaryPath(), [
				"index",
				"--vault",
				vaultPath,
			]);

			child.on("error", (err: Error) => {
				this.indexing = false;
				this.updateStatusBar();
				new Notice(`Recalla index failed: ${err.message}`);
				resolve(false);
			});

			child.on("close", (code: number | null) => {
				this.indexing = false;
				this.updateStatusBar();
				if (isSuccessfulExit(code)) {
					new Notice("Recalla: index complete.");
					resolve(true);
				} else {
					new Notice(`Recalla index exited with code ${code}.`);
					resolve(false);
				}
			});
		});
	}

	startServer(announce = true): void {
		if (this.serverProcess !== null) {
			new Notice("Recalla server is already running.");
			return;
		}
		const vaultPath = this.getVaultPath();
		const child = spawn(
			this.resolveBinaryPath(),
			["serve", "--vault", vaultPath, "--port", String(this.settings.port)],
			{ stdio: "ignore" },
		);

		child.on("error", (err: Error) => {
			if (this.serverProcess === child) {
				this.clearTrackedServer(child);
			}
			new Notice(`Recalla server failed: ${err.message}`);
		});

		child.on("close", () => {
			if (this.serverProcess === child) {
				this.clearTrackedServer(child);
			}
		});

		this.serverProcess = child;
		this.updateStatusBar();
		if (announce) {
			void this.confirmServerStarted(child);
		}
	}

	/**
	 * Success is only announced after an identity-checked /health response; a
	 * child that never becomes ready is terminated instead of lingering as a
	 * tracked-but-dead server.
	 */
	private async confirmServerStarted(child: ChildProcess): Promise<void> {
		const notice = new Notice("Recalla: starting local server...", 0);
		const ok = await this.waitForServerReady();
		notice.hide();
		if (this.serverProcess !== child) {
			return;
		}
		if (ok) {
			new Notice(`Recalla: server ready on 127.0.0.1:${this.settings.port}`);
			return;
		}
		child.kill();
		this.clearTrackedServer(child);
		new Notice(
			"Recalla: the local server did not become ready. Check the engine path and port in settings.",
		);
	}

	private clearTrackedServer(child: ChildProcess): void {
		if (this.serverProcess !== child) return;
		if (this.serverStopTimer !== null) {
			clearTimeout(this.serverStopTimer);
			this.serverStopTimer = null;
		}
		this.serverProcess = null;
		this.updateStatusBar();
	}

	stopServer(): void {
		const child = this.serverProcess;
		if (child === null) return;
		child.kill();
		if (this.serverStopTimer !== null) clearTimeout(this.serverStopTimer);
		this.serverStopTimer = setTimeout(() => {
			if (this.serverProcess === child) {
				child.kill("SIGKILL");
				this.clearTrackedServer(child);
			}
		}, SERVER_STOP_TIMEOUT_MS);
		new Notice("Recalla: stopping server...");
	}

	/**
	 * A single bounded /health probe. Obsidian's requestUrl cannot be aborted,
	 * so a hung localhost service is raced against a short timeout instead of
	 * being allowed to stall the whole readiness deadline.
	 */
	async isServerHealthy(): Promise<boolean> {
		try {
			const res = await Promise.race([
				requestUrl({
					url: `http://127.0.0.1:${this.settings.port}/health`,
					throw: false,
				}),
				new Promise<never>((_, reject) => {
					window.setTimeout(
						() => reject(new Error("health probe timed out")),
						HEALTH_PROBE_TIMEOUT_MS,
					);
				}),
			]);
			const expectedVault = fs.realpathSync(this.getVaultPath());
			// Exact-version equality only applies to the plugin-managed binary. A
			// custom-path or PATH engine (the documented route on unsupported
			// platforms) must not be rejected for being newer than the pin.
			const versionOk = this.usingManagedEngine()
				? res.json?.version === MANAGED_ENGINE_VERSION
				: typeof res.json?.version === "string" && res.json.version.length > 0;
			return (
				res.status === 200 &&
				res.json?.ok === true &&
				res.json?.engine === "recalla" &&
				versionOk &&
				res.json?.vault === expectedVault
			);
		} catch {
			return false;
		}
	}

	/**
	 * Poll /health until the server answers or the timeout elapses. The
	 * standalone binary self-extracts on first run and can take several seconds
	 * to start, so callers must wait rather than assume the server is up.
	 */
	async waitForServerReady(
		timeoutMs: number = SERVER_READY_TIMEOUT_MS,
	): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (await this.isServerHealthy()) {
				return true;
			}
			await new Promise((r) => setTimeout(r, SERVER_POLL_INTERVAL_MS));
		}
		return false;
	}

	/**
	 * Guarantee the local server is reachable: reuse it if healthy, otherwise
	 * acquire the engine, start serving, and wait for /health. Returns false if
	 * it could not be made ready.
	 */
	async ensureServerReady(): Promise<boolean> {
		if (await this.isServerHealthy()) {
			return true;
		}
		if (this.serverProcess === null) {
			const ready = await this.ensureEngine();
			if (!ready) {
				return false;
			}
			// This path owns its own readiness notice below.
			this.startServer(false);
		}
		const notice = new Notice("Recalla: starting local server...", 0);
		const ok = await this.waitForServerReady();
		notice.hide();
		if (!ok) {
			new Notice(
				"Recalla: the local server did not come up in time. Check the engine path in settings.",
			);
		}
		return ok;
	}

	private scheduleReindex(): void {
		if (this.reindexTimer !== null) {
			clearTimeout(this.reindexTimer);
		}
		this.reindexTimer = setTimeout(() => {
			this.reindexTimer = null;
			void this.indexVault();
		}, REINDEX_DEBOUNCE_MS);
	}

	async copyMcpConfig(): Promise<void> {
		const vaultPath = this.getVaultPath();
		const config = {
			mcpServers: {
				recalla: {
					command: this.resolveBinaryPath(),
					args: ["mcp", "--vault", vaultPath],
				},
			},
		};
		const json = JSON.stringify(config, null, 2);
		try {
			await navigator.clipboard.writeText(json);
			new Notice("Recalla: MCP config copied to clipboard.");
		} catch (err) {
			new Notice(`Recalla: could not copy MCP config: ${toMessage(err)}`);
		}
	}

	runAgents(): void {
		const vaultPath = this.getVaultPath();
		new Notice("Recalla: generating AGENTS.md and llms.txt...");
		const child = spawn(this.resolveBinaryPath(), [
			"agents",
			"--vault",
			vaultPath,
		]);

		child.on("error", (err: Error) => {
			new Notice(`Recalla agents failed: ${err.message}`);
		});

		child.on("close", (code: number | null) => {
			if (isSuccessfulExit(code)) {
				new Notice("Recalla: AGENTS.md and llms.txt generated.");
			} else {
				new Notice(`Recalla agents exited with code ${code}.`);
			}
		});
	}
}
