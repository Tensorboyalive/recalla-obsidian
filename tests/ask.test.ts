import assert from "node:assert/strict";
import test from "node:test";

import { classifyAskError, parseAskOutput } from "../src/ask";

test("parseAskOutput splits and deduplicates inline sources", () => {
	assert.deepEqual(
		parseAskOutput("answer text\n\nsources: [a.md], b.md, a.md"),
		{ answer: "answer text", sources: ["a.md", "b.md"] },
	);
});

test("parseAskOutput accepts bulleted source lists", () => {
	assert.deepEqual(
		parseAskOutput("answer\nsources:\n- notes/a.md\n* notes/b.md"),
		{
			answer: "answer",
			sources: ["notes/a.md", "notes/b.md"],
		},
	);
});

test("parseAskOutput preserves an answer without citations", () => {
	assert.deepEqual(parseAskOutput("  offline answer  "), {
		answer: "offline answer",
		sources: [],
	});
});

test("classifyAskError maps actionable engine failures", () => {
	assert.equal(
		classifyAskError("ECONNREFUSED local server").kind,
		"server-down",
	);
	assert.equal(
		classifyAskError("OPENAI_API_KEY is missing").kind,
		"no-api-key",
	);
	assert.equal(classifyAskError("unexpected exit").kind, "unknown");
});
