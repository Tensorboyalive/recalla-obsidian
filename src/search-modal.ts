import { App, Notice, SuggestModal, TFile, requestUrl } from "obsidian";
import type { RecallaSearchResult } from "./types";
import type RecallaPlugin from "../main";

/** Quick-switcher style search backed by the local Recalla HTTP API. */
export class RecallaSearchModal extends SuggestModal<RecallaSearchResult> {
	private readonly plugin: RecallaPlugin;

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
		} catch {
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
			void this.app.workspace.getLeaf(false).openFile(file);
		} else {
			void this.app.workspace.openLinkText(item.path, "", false);
		}
	}
}
