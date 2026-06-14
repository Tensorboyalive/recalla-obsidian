import { Notice, Plugin, TFile, WorkspaceLeaf, requestUrl } from "obsidian";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import {
	AskOutcome,
	DEFAULT_SETTINGS,
	RecallaSettings,
	ServerState,
	toMessage,
} from "./src/types";
import { BinaryManager } from "./src/binary-manager";
import { parseAskOutput, classifyAskError } from "./src/ask";
import { RECALLA_CHAT_VIEW, RecallaChatView } from "./src/chat-view";
import { RecallaSearchModal } from "./src/search-modal";
import { RecallaSettingTab } from "./src/settings-tab";

const REINDEX_DEBOUNCE_MS = 3000;
const SERVER_READY_TIMEOUT_MS = 20000;
const SERVER_POLL_INTERVAL_MS = 400;

export default class RecallaPlugin extends Plugin {
	settings: RecallaSettings = DEFAULT_SETTINGS;
	binary!: BinaryManager;
	serverProcess: ChildProcess | null = null;
	indexing = false;
	private statusBarEl: HTMLElement | null = null;
	private reindexTimer: ReturnType<typeof setTimeout> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.binary = new BinaryManager(this.pluginDir());

		this.registerView(
			RECALLA_CHAT_VIEW,
			(leaf: WorkspaceLeaf) => new RecallaChatView(leaf, this)
		);
		this.addRibbonIcon("messages-square", "Recalla chat", () => {
			void this.activateChatView();
		});

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("recalla-status-bar");
		this.updateStatusBar();

		this.addCommand({
			id: "recalla-open-chat",
			name: "Recalla: Open chat",
			callback: () => {
				void this.activateChatView();
			},
		});

		this.addCommand({
			id: "recalla-download-engine",
			name: "Recalla: Download or update the engine",
			callback: () => {
				void this.downloadEngine();
			},
		});

		this.addCommand({
			id: "recalla-make-agent-readable",
			name: "Recalla: Make my vault agent-readable",
			callback: () => {
				void this.makeAgentReadable();
			},
		});

		this.addCommand({
			id: "recalla-index",
			name: "Recalla: Reindex vault",
			callback: () => {
				void this.indexVault();
			},
		});

		this.addCommand({
			id: "recalla-serve-start",
			name: "Recalla: Start local server",
			callback: () => this.startServer(),
		});

		this.addCommand({
			id: "recalla-serve-stop",
			name: "Recalla: Stop local server",
			callback: () => this.stopServer(),
		});

		this.addCommand({
			id: "recalla-search",
			name: "Recalla: Search vault (agent index)",
			callback: async () => {
				const ready = await this.ensureServerReady();
				if (ready) {
					new RecallaSearchModal(this.app, this).open();
				}
			},
		});

		this.addCommand({
			id: "recalla-copy-mcp",
			name: "Recalla: Copy MCP config to clipboard",
			callback: () => {
				void this.copyMcpConfig();
			},
		});

		this.addCommand({
			id: "recalla-agents",
			name: "Recalla: Generate AGENTS.md and llms.txt",
			callback: () => this.runAgents(),
		});

		this.addSettingTab(new RecallaSettingTab(this.app, this));

		if (this.settings.autoStartServer) {
			this.startServer();
		}

		if (this.settings.autoReindexOnSave) {
			this.registerEvent(
				this.app.vault.on("modify", () => this.scheduleReindex())
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
			(await this.loadData()) as Partial<RecallaSettings>
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	getVaultPath(): string {
		const adapter = this.app.vault.adapter as unknown as {
			basePath: string;
		};
		return adapter.basePath;
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
		return "recalla";
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
				"Recalla: no engine build for this platform. Set a custom engine path in settings."
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
				"Recalla: no engine build for this platform. Set a custom engine path in settings."
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
				const kind =
					err.code === "ENOENT" ? "engine-missing" : "unknown";
				finish({
					answer: "",
					sources: [],
					error: { kind, message: err.message },
				});
			});
			child.on("close", (code: number | null) => {
				if (code === 0 || code === null) {
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
				if (code === 0 || code === null) {
					new Notice("Recalla: index complete.");
					resolve(true);
				} else {
					new Notice(`Recalla index exited with code ${code}.`);
					resolve(false);
				}
			});
		});
	}

	startServer(): void {
		if (this.serverProcess !== null) {
			new Notice("Recalla server is already running.");
			return;
		}
		const vaultPath = this.getVaultPath();
		const child = spawn(this.resolveBinaryPath(), [
			"serve",
			"--vault",
			vaultPath,
			"--port",
			String(this.settings.port),
		]);

		child.on("error", (err: Error) => {
			this.serverProcess = null;
			this.updateStatusBar();
			new Notice(`Recalla server failed: ${err.message}`);
		});

		child.on("close", () => {
			this.serverProcess = null;
			this.updateStatusBar();
		});

		this.serverProcess = child;
		this.updateStatusBar();
		new Notice(`Recalla: server started on 127.0.0.1:${this.settings.port}`);
	}

	stopServer(): void {
		if (this.serverProcess === null) {
			return;
		}
		this.serverProcess.kill();
		this.serverProcess = null;
		this.updateStatusBar();
		new Notice("Recalla: server stopped.");
	}

	/** A single /health probe. True only on a 200 with the recalla engine. */
	async isServerHealthy(): Promise<boolean> {
		try {
			const res = await requestUrl({
				url: `http://127.0.0.1:${this.settings.port}/health`,
				throw: false,
			});
			return res.status === 200 && res.json?.ok === true;
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
		timeoutMs: number = SERVER_READY_TIMEOUT_MS
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
			this.startServer();
		}
		const notice = new Notice("Recalla: starting local server...", 0);
		const ok = await this.waitForServerReady();
		notice.hide();
		if (!ok) {
			new Notice(
				"Recalla: the local server did not come up in time. Check the engine path in settings."
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
			if (code === 0 || code === null) {
				new Notice("Recalla: AGENTS.md and llms.txt generated.");
			} else {
				new Notice(`Recalla agents exited with code ${code}.`);
			}
		});
	}
}
