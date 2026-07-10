import { type App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "./types";
import { isValidPort } from "./runtime";
import type RecallaPlugin from "../main";

export class RecallaSettingTab extends PluginSettingTab {
	private readonly plugin: RecallaPlugin;

	constructor(app: App, plugin: RecallaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Engine").setHeading();

		const status = this.plugin.engineStatusLabel();
		new Setting(containerEl)
			.setName("Recalla engine")
			.setDesc(
				`Status: ${status}. The engine is a small standalone program. Download it once and the plugin manages it for you.`,
			)
			.addButton((button) =>
				button
					.setButtonText("Download or update")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						await this.plugin.downloadEngine();
						button.setDisabled(false);
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Custom engine path")
			.setDesc(
				"Optional. Absolute path or command for the recalla engine. Leave empty to use the downloaded engine, or `recalla` on your PATH.",
			)
			.addText((text) =>
				text
					.setPlaceholder("(use managed engine)")
					.setValue(this.plugin.settings.recallaPath)
					.onChange(async (value) => {
						this.plugin.settings.recallaPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Server").setHeading();

		new Setting(containerEl)
			.setName("Server port")
			.setDesc("Local HTTP API port (bound to 127.0.0.1).")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.port))
					.setValue(String(this.plugin.settings.port))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (isValidPort(parsed)) {
							this.plugin.settings.port = parsed;
							await this.plugin.saveSettings();
						}
					}),
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
					}),
			);

		new Setting(containerEl)
			.setName("Auto-reindex on save")
			.setDesc(
				"Reindex the vault automatically after notes change (debounced).",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoReindexOnSave)
					.onChange(async (value) => {
						this.plugin.settings.autoReindexOnSave = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
