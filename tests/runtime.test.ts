import assert from "node:assert/strict";
import test from "node:test";

import { isSuccessfulExit, isValidPort } from "../src/runtime";

test("only exit code zero is success", () => {
	assert.equal(isSuccessfulExit(0), true);
	assert.equal(isSuccessfulExit(1), false);
	assert.equal(isSuccessfulExit(null), false);
});

test("ports stay inside the TCP range", () => {
	assert.equal(isValidPort(1), true);
	assert.equal(isValidPort(65_535), true);
	assert.equal(isValidPort(0), false);
	assert.equal(isValidPort(65_536), false);
	assert.equal(isValidPort(1.5), false);
	assert.equal(isValidPort(Number.NaN), false);
});

