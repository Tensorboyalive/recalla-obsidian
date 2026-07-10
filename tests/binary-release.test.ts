import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePublishedChecksum,
  resolveBinaryAsset,
  validateReleaseDigest,
} from "../src/binary-release";

const digest = "a".repeat(64);

test("maps supported operating-system and architecture pairs", () => {
  assert.equal(resolveBinaryAsset("darwin", "arm64"), "recalla-macos-arm64");
  assert.equal(resolveBinaryAsset("darwin", "x64"), "recalla-macos-x64");
  assert.equal(resolveBinaryAsset("linux", "arm64"), "recalla-linux-arm64");
  assert.equal(resolveBinaryAsset("linux", "x64"), "recalla-linux-x64");
  assert.equal(resolveBinaryAsset("win32", "x64"), "recalla-windows-x64.exe");
});

test("rejects architectures without a published binary", () => {
  assert.throws(
    () => resolveBinaryAsset("win32", "arm64"),
    /No prebuilt Recalla engine for win32\/arm64/,
  );
});

test("accepts standard and binary-mode checksum formats", () => {
  assert.equal(
    parsePublishedChecksum(`${digest}  recalla-linux-x64\n`, "recalla-linux-x64"),
    digest,
  );
  assert.equal(
    parsePublishedChecksum(`${digest.toUpperCase()} *dist/recalla-macos-arm64\n`, "recalla-macos-arm64"),
    digest,
  );
});

test("requires a trusted embedded digest", () => {
  assert.equal(validateReleaseDigest("asset", digest.toUpperCase()), digest);
  assert.throws(
    () => validateReleaseDigest("asset", ""),
    /No trusted SHA-256 digest/,
  );
  assert.throws(
    () => validateReleaseDigest("asset", "not-a-digest"),
    /No trusted SHA-256 digest/,
  );
});

test("requires a valid checksum for the exact asset", () => {
  assert.throws(
    () => parsePublishedChecksum(`${digest}  recalla-linux-arm64`, "recalla-linux-x64"),
    /Missing valid SHA-256 checksum/,
  );
  assert.throws(
    () => parsePublishedChecksum("not-a-checksum  recalla-linux-x64", "recalla-linux-x64"),
    /Missing valid SHA-256 checksum/,
  );
  assert.throws(
    () => parsePublishedChecksum("", "recalla-linux-x64"),
    /Missing valid SHA-256 checksum/,
  );
});
