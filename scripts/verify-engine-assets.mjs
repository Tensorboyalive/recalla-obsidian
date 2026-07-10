import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

let release;
try {
	release = JSON.parse(
		await readFile(new URL("../release-digests.json", import.meta.url), "utf8"),
	);
} catch (error) {
	throw new Error("cannot read release-digests.json", { cause: error });
}
const expectedAssets = [
	"recalla-macos-arm64",
	"recalla-macos-x64",
	"recalla-linux-arm64",
	"recalla-linux-x64",
	"recalla-windows-x64.exe",
];
const maxBytes = 250 * 1024 * 1024;
const maxChecksumBytes = 16 * 1024;
const digestPattern = /^[a-f0-9]{64}$/;

if (!/^\d+\.\d+\.\d+$/.test(release.engineVersion)) {
	throw new Error("release-digests.json has an invalid engineVersion");
}
if (
	JSON.stringify(Object.keys(release.assets).sort()) !==
	JSON.stringify([...expectedAssets].sort())
) {
	throw new Error(
		"release-digests.json must contain exactly the five supported assets",
	);
}

const base = `https://github.com/Tensorboyalive/recalla/releases/download/v${release.engineVersion}`;
for (const asset of expectedAssets) {
	const trusted = String(release.assets[asset] ?? "").toLowerCase();
	if (!digestPattern.test(trusted)) {
		throw new Error(`missing trusted digest for ${asset}`);
	}

	const checksumResponse = await fetch(`${base}/${asset}.sha256`, {
		signal: AbortSignal.timeout(120_000),
	});
	if (!checksumResponse.ok) {
		throw new Error(`${asset}.sha256 returned HTTP ${checksumResponse.status}`);
	}
	const declaredChecksumBytes = Number(
		checksumResponse.headers.get("content-length") ?? 0,
	);
	if (declaredChecksumBytes > maxChecksumBytes) {
		throw new Error(`${asset}.sha256 is unexpectedly large`);
	}
	const checksum = await checksumResponse.text();
	if (Buffer.byteLength(checksum) > maxChecksumBytes) {
		throw new Error(
			`${asset}.sha256 exceeds the ${maxChecksumBytes}-byte limit`,
		);
	}
	const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/m.exec(checksum);
	if (!match || match[2].replace(/^.*[\\/]/, "") !== asset) {
		throw new Error(`${asset}.sha256 does not name the exact asset`);
	}
	if (match[1].toLowerCase() !== trusted) {
		throw new Error(`${asset}.sha256 differs from the committed digest`);
	}

	const binaryResponse = await fetch(`${base}/${asset}`, {
		signal: AbortSignal.timeout(300_000),
	});
	if (!binaryResponse.ok || !binaryResponse.body) {
		throw new Error(`${asset} returned HTTP ${binaryResponse.status}`);
	}
	const declared = Number(binaryResponse.headers.get("content-length") ?? 0);
	if (declared > maxBytes) throw new Error(`${asset} exceeds the 250 MB limit`);

	const hash = createHash("sha256");
	let received = 0;
	for await (const chunk of binaryResponse.body) {
		received += chunk.byteLength;
		if (received > maxBytes)
			throw new Error(`${asset} exceeds the 250 MB limit`);
		hash.update(chunk);
	}
	const actual = hash.digest("hex");
	if (actual !== trusted) throw new Error(`${asset} digest mismatch`);
	console.log(`verified ${asset} (${received} bytes)`);
}
