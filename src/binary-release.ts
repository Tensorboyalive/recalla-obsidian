import releaseDigests from "../release-digests.json";

const SHA256_HEX = /^[a-f0-9]{64}$/;

export const MANAGED_ENGINE_VERSION = releaseDigests.engineVersion;
export const MANAGED_ENGINE_RELEASE = `v${MANAGED_ENGINE_VERSION}`;
export const RELEASE_ASSETS = Object.keys(releaseDigests.assets);

export function resolveBinaryAsset(
  platform: NodeJS.Platform,
  architecture: string,
): string {
  const key = `${platform}/${architecture}`;
  const assets: Record<string, string> = {
    "darwin/arm64": "recalla-macos-arm64",
    "darwin/x64": "recalla-macos-x64",
    "linux/arm64": "recalla-linux-arm64",
    "linux/x64": "recalla-linux-x64",
    "win32/x64": "recalla-windows-x64.exe",
  };
  const asset = assets[key];
  if (!asset) {
    throw new Error(
      `No prebuilt Recalla engine for ${key}. Install recalla manually and ` +
        "set its executable path in plugin settings.",
    );
  }
  return asset;
}

export function validateReleaseDigest(asset: string, digest: string): string {
  const normalized = digest.toLowerCase();
  if (!SHA256_HEX.test(normalized)) {
    throw new Error(`No trusted SHA-256 digest is embedded for ${asset}`);
  }
  return normalized;
}

export function expectedReleaseDigest(asset: string): string {
  const digests = releaseDigests.assets as Record<string, string>;
  return validateReleaseDigest(asset, digests[asset] ?? "");
}

export function parsePublishedChecksum(
  checksumFile: string,
  expectedAsset: string,
): string {
  for (const line of checksumFile.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (!match) continue;
    const publishedName = match[2].replace(/^.*[\\/]/, "");
    if (publishedName === expectedAsset) return match[1].toLowerCase();
  }
  throw new Error(`Missing valid SHA-256 checksum for ${expectedAsset}`);
}
