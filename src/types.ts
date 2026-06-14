export interface RecallaSettings {
	/** User override. Absolute path or command. Empty means "let the plugin decide". */
	recallaPath: string;
	port: number;
	autoStartServer: boolean;
	autoReindexOnSave: boolean;
}

export const DEFAULT_SETTINGS: RecallaSettings = {
	recallaPath: "",
	port: 8090,
	autoStartServer: false,
	autoReindexOnSave: false,
};

export interface RecallaSearchResult {
	id: string;
	title: string;
	category: string;
	summary: string;
	path: string;
}

export type ServerState = "off" | "running" | "indexing";

/** Why an `ask` invocation failed, so the chat UI can show targeted help. */
export type AskErrorKind =
	| "engine-missing"
	| "server-down"
	| "no-api-key"
	| "unknown";

export interface AskError {
	kind: AskErrorKind;
	message: string;
}

export interface AskOutcome {
	answer: string;
	sources: string[];
	error: AskError | null;
}

/** Turn an unknown thrown value into a readable message. */
export function toMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}
