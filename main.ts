import {
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	SuggestModal,
	requestUrl,
	TFile,
	App,
} from "obsidian";
import { spawn, ChildProcess } from "child_process";

interface RecallaSettings {
	recallaPath: string;
	port: number;
	autoStartServer: boolean;
	autoReindexOnSave: boolean;
}

const DEFAULT_SETTINGS: RecallaSettings = {
	recallaPath: "recalla",
	port: 8090,
	autoStartServer: false,
	autoReindexOnSave: false,
};

interface RecallaSearchResult {
	id: string;
	title: string;
	category: string;
	summary: string;
	path: string;
}

type ServerState = "off" | "running" | "indexing";

export default class RecallaPlugin extends Plugin {
	settings: RecallaSettings = DEFAULT_SETTINGS;
	serverProcess: ChildProcess | null = null;
	indexing = false;
	private statusBarEl: HTMLElement | null = null;
	private reindexTimer: ReturnType<typeof setTimeout> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("recalla-status-bar");
		this.updateStatusBar();

		this.addCommand({
			id: "recalla-index",
			name: "Recalla: Reindex vault",
			callback: () => this.runIndex(),
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
			callback: () => {
				new RecallaSearchModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: "recalla-copy-mcp",
			name: "Recalla: Copy MCP config to clipboard",
			callback: () => this.copyMcpConfig(),
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

	runIndex(): void {
		if (this.indexing) {
			new Notice("Recalla is already indexing.");
			return;
		}
		const vaultPath = this.getVaultPath();
		this.indexing = true;
		this.updateStatusBar();
		new Notice("Recalla: indexing vault...");

		const child = spawn(this.settings.recallaPath, [
			"index",
			"--vault",
			vaultPath,
		]);

		child.on("error", (err: Error) => {
			this.indexing = false;
			this.updateStatusBar();
			new Notice(`Recalla index failed: ${err.message}`);
		});

		child.on("close", (code: number | null) => {
			this.indexing = false;
			this.updateStatusBar();
			if (code === 0 || code === null) {
				new Notice("Recalla: index complete.");
			} else {
				new Notice(`Recalla index exited with code ${code}.`);
			}
		});
	}

	startServer(): void {
		if (this.serverProcess !== null) {
			new Notice("Recalla server is already running.");
			return;
		}
		const vaultPath = this.getVaultPath();
		const child = spawn(this.settings.recallaPath, [
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

	private scheduleReindex(): void {
		if (this.reindexTimer !== null) {
			clearTimeout(this.reindexTimer);
		}
		this.reindexTimer = setTimeout(() => {
			this.reindexTimer = null;
			this.runIndex();
		}, 3000);
	}

	async copyMcpConfig(): Promise<void> {
		const vaultPath = this.getVaultPath();
		const config = {
			mcpServers: {
				recalla: {
					command: this.settings.recallaPath,
					args: ["mcp", "--vault", vaultPath],
				},
			},
		};
		const json = JSON.stringify(config, null, 2);
		try {
			await navigator.clipboard.writeText(json);
			new Notice("Recalla: MCP config copied to clipboard.");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Recalla: could not copy MCP config: ${message}`);
		}
	}

	runAgents(): void {
		const vaultPath = this.getVaultPath();
		new Notice("Recalla: generating AGENTS.md and llms.txt...");
		const child = spawn(this.settings.recallaPath, [
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

class RecallaSearchModal extends SuggestModal<RecallaSearchResult> {
	private plugin: RecallaPlugin;

	constructor(app: App, plugin: RecallaPlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder("Search your vault via the Recalla agent index...");
	}

	async getSuggestions(query: string): Promise<RecallaSearchResult[]> {
		if (query.length < 2) {
			return [];
		}
		const port = this.plugin.settings.port;
		const url = `http://127.0.0.1:${port}/search?q=${encodeURIComponent(
			query
		)}&limit=15`;
		try {
			const response = await requestUrl({ url });
			const data = response.json as { results?: RecallaSearchResult[] };
			if (!data || !Array.isArray(data.results)) {
				return [];
			}
			return data.results;
		} catch (err) {
			new Notice(
				"Recalla: search failed. Start the local server with the 'Recalla: Start local server' command."
			);
			return [];
		}
	}

	renderSuggestion(item: RecallaSearchResult, el: HTMLElement): void {
		const titleEl = el.createDiv();
		titleEl.createSpan({
			text: item.title || item.path || item.id,
			cls: "recalla-suggestion-title",
		});
		if (item.category) {
			titleEl.createSpan({
				text: item.category,
				cls: "recalla-suggestion-meta",
			});
		}
		if (item.summary) {
			el.createSpan({
				text: item.summary,
				cls: "recalla-suggestion-summary",
			});
		}
	}

	onChooseSuggestion(item: RecallaSearchResult): void {
		if (!item.path) {
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(item.path);
		if (file instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(file);
		} else {
			this.app.workspace.openLinkText(item.path, "", false);
		}
	}
}

class RecallaSettingTab extends PluginSettingTab {
	private plugin: RecallaPlugin;

	constructor(app: App, plugin: RecallaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Recalla CLI path")
			.setDesc(
				"Command or absolute path to the recalla CLI. Install it with 'pip install recalla'."
			)
			.addText((text) =>
				text
					.setPlaceholder("recalla")
					.setValue(this.plugin.settings.recallaPath)
					.onChange(async (value) => {
						this.plugin.settings.recallaPath =
							value.trim() || DEFAULT_SETTINGS.recallaPath;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Server port")
			.setDesc("Local HTTP API port (bound to 127.0.0.1).")
			.addText((text) =>
				text
					.setPlaceholder("8090")
					.setValue(String(this.plugin.settings.port))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (!Number.isNaN(parsed) && parsed > 0) {
							this.plugin.settings.port = parsed;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Auto-start server on load")
			.setDesc("Start the local Recalla server when Obsidian opens.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStartServer)
					.onChange(async (value) => {
						this.plugin.settings.autoStartServer = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-reindex on save")
			.setDesc(
				"Reindex the vault automatically after notes change (debounced)."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoReindexOnSave)
					.onChange(async (value) => {
						this.plugin.settings.autoReindexOnSave = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
