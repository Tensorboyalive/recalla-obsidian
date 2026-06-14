import type { AskError } from "./types";

interface ParsedAnswer {
	answer: string;
	sources: string[];
}

const SOURCES_LINE = /^\s*sources?\s*:/i;
const LEADING_BULLET = /^[-*•\d.)\s]+/;
const SURROUNDING_BRACKETS = /^\[+|\]+$/g;

/**
 * Split `recalla ask` stdout into the answer body and a list of cited paths.
 * Handles both inline ("sources: a.md, b.md") and bulleted source lists.
 */
export function parseAskOutput(raw: string): ParsedAnswer {
	const lines = raw.split(/\r?\n/);
	const idx = lines.findIndex((line) => SOURCES_LINE.test(line));
	if (idx === -1) {
		return { answer: raw.trim(), sources: [] };
	}

	const answer = lines.slice(0, idx).join("\n").trim();
	const sources: string[] = [];

	const inline = lines[idx].replace(SOURCES_LINE, "");
	collectSources(inline, sources);
	for (let i = idx + 1; i < lines.length; i++) {
		collectSources(lines[i], sources);
	}

	return { answer, sources };
}

function collectSources(segment: string, out: string[]): void {
	const cleaned = segment.replace(LEADING_BULLET, "").trim();
	if (cleaned.length === 0) {
		return;
	}
	for (const part of cleaned.split(/\s*,\s*/)) {
		const token = part.replace(SURROUNDING_BRACKETS, "").trim();
		if (token.length > 0 && !out.includes(token)) {
			out.push(token);
		}
	}
}

/** Classify a failing `ask` run so the chat UI can offer the right fix. */
export function classifyAskError(output: string): AskError {
	const text = output.toLowerCase();

	if (
		text.includes("econnrefused") ||
		text.includes("connection refused") ||
		(text.includes("server") && text.includes("not running")) ||
		text.includes("failed to connect")
	) {
		return { kind: "server-down", message: output.trim() };
	}

	if (
		text.includes("openai_api_key") ||
		text.includes("anthropic_api_key") ||
		text.includes("api key") ||
		text.includes("no llm") ||
		text.includes("no model configured")
	) {
		return { kind: "no-api-key", message: output.trim() };
	}

	return { kind: "unknown", message: output.trim() || "the engine exited with an error." };
}
