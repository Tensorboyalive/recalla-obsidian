import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { AskError, AskOutcome } from "./types";
import type RecallaPlugin from "../main";

export const RECALLA_CHAT_VIEW = "recalla-chat-view";

/**
 * Right-sidebar chat panel. Sends questions to `recalla ask` and renders the
 * answer with clickable source links, with targeted help when the engine is
 * missing, the server is down, or no LLM key is configured.
 */
export class RecallaChatView extends ItemView {
	private readonly plugin: RecallaPlugin;
	private listEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendButton!: HTMLButtonElement;
	private busy = false;

	constructor(leaf: WorkspaceLeaf, plugin: RecallaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return RECALLA_CHAT_VIEW;
	}

	getDisplayText(): string {
		return "Recalla chat";
	}

	getIcon(): string {
		return "messages-square";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("recalla-chat");

		const header = root.createDiv({ cls: "recalla-chat-header" });
		header.createSpan({ text: "Recalla", cls: "recalla-chat-title" });
		header.createSpan({
			text: "Ask your vault. Answers stay local.",
			cls: "recalla-chat-subtitle",
		});

		this.listEl = root.createDiv({ cls: "recalla-chat-list" });
		this.renderWelcome();

		const form = root.createEl("form", { cls: "recalla-chat-form" });
		this.inputEl = form.createEl("textarea", {
			cls: "recalla-chat-input",
			attr: {
				rows: "2",
				placeholder: "Ask anything about your notes...",
			},
		});
		this.sendButton = form.createEl("button", {
			cls: "recalla-chat-send",
			attr: { type: "submit", "aria-label": "Send" },
		});
		setIcon(this.sendButton, "send-horizontal");

		this.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter" && !evt.shiftKey) {
				evt.preventDefault();
				void this.submit();
			}
		});
		form.addEventListener("submit", (evt: SubmitEvent) => {
			evt.preventDefault();
			void this.submit();
		});
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private renderWelcome(): void {
		const card = this.listEl.createDiv({ cls: "recalla-chat-welcome" });
		card.createDiv({
			cls: "recalla-msg-text",
			text: "Ask a question and I will answer from your vault, with links to the notes I used.",
		});
	}

	private async submit(): Promise<void> {
		if (this.busy) {
			return;
		}
		const question = this.inputEl.value.trim();
		if (question.length === 0) {
			return;
		}

		this.appendUserMessage(question);
		this.inputEl.value = "";
		this.setBusy(true);
		const pending = this.appendPending();

		try {
			const outcome = await this.plugin.runAsk(question);
			pending.remove();
			this.renderOutcome(outcome);
		} catch (err) {
			pending.remove();
			this.appendError({
				kind: "unknown",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			this.setBusy(false);
			this.inputEl.focus();
		}
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.sendButton.disabled = busy;
		this.inputEl.disabled = busy;
	}

	private appendUserMessage(text: string): void {
		const row = this.listEl.createDiv({
			cls: "recalla-msg recalla-msg-user",
		});
		row.createDiv({ cls: "recalla-msg-text", text });
		this.scrollToBottom();
	}

	private appendPending(): HTMLElement {
		const row = this.listEl.createDiv({
			cls: "recalla-msg recalla-msg-assistant",
		});
		row.createDiv({ cls: "recalla-msg-text", text: "Thinking..." });
		this.scrollToBottom();
		return row;
	}

	private renderOutcome(outcome: AskOutcome): void {
		if (outcome.error !== null) {
			this.appendError(outcome.error);
			return;
		}

		const row = this.listEl.createDiv({
			cls: "recalla-msg recalla-msg-assistant",
		});
		const answer = outcome.answer.length > 0 ? outcome.answer : "(no answer)";
		row.createDiv({ cls: "recalla-msg-text", text: answer });

		if (outcome.sources.length > 0) {
			const sourcesEl = row.createDiv({ cls: "recalla-sources" });
			sourcesEl.createDiv({ cls: "recalla-sources-label", text: "Sources" });
			for (const source of outcome.sources) {
				const link = sourcesEl.createEl("a", {
					cls: "recalla-source-link",
					text: source,
					href: "#",
				});
				link.addEventListener("click", (evt: MouseEvent) => {
					evt.preventDefault();
					this.plugin.openSource(source);
				});
			}
		}
		this.scrollToBottom();
	}

	private appendError(error: AskError): void {
		const row = this.listEl.createDiv({
			cls: "recalla-msg recalla-msg-assistant recalla-msg-error",
		});
		const body = row.createDiv({ cls: "recalla-msg-text" });

		if (error.kind === "engine-missing") {
			body.setText(
				"The Recalla engine is not installed yet. Download it once and you are ready to go."
			);
			const action = row.createDiv({ cls: "recalla-msg-actions" });
			const button = action.createEl("button", {
				cls: "recalla-inline-button",
				text: "Download engine",
			});
			button.addEventListener("click", () => {
				button.disabled = true;
				void this.plugin.downloadEngine().finally(() => {
					button.disabled = false;
				});
			});
			return;
		}

		if (error.kind === "server-down") {
			body.setText(
				"Recalla could not reach the local server. Start it and try again."
			);
			const action = row.createDiv({ cls: "recalla-msg-actions" });
			const button = action.createEl("button", {
				cls: "recalla-inline-button",
				text: "Start local server",
			});
			button.addEventListener("click", () => {
				this.plugin.startServer();
			});
			return;
		}

		if (error.kind === "no-api-key") {
			body.setText("No language model is configured. Pick one of these:");
			const list = row.createEl("ul", { cls: "recalla-help-list" });
			list.createEl("li", {
				text: "Set OPENAI_API_KEY in your environment for OpenAI.",
			});
			list.createEl("li", {
				text: "Set ANTHROPIC_API_KEY in your environment for Claude.",
			});
			list.createEl("li", {
				text: "Or run a local model with Ollama and no key is needed.",
			});
			row.createDiv({
				cls: "recalla-help-note",
				text: "After setting a key, fully quit and reopen Obsidian so it picks up the change.",
			});
			return;
		}

		body.setText(`Something went wrong: ${error.message}`);
	}

	private scrollToBottom(): void {
		this.listEl.scrollTop = this.listEl.scrollHeight;
	}
}
