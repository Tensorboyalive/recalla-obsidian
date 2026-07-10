# Handoff: recalla-obsidian 0.1.1 release candidate

Current state of the plugin as prepared for the 0.5.0 open-core release. For
submission steps and reviewer disclosure see `SUBMISSION.md`; for the release
order see the engine repo's `PUBLISHING.md`.

## What this plugin is

Desktop-only Obsidian plugin that makes a vault agent-readable by managing the
standalone `recalla` engine: one-click download, index, local API server, search
modal, and a chat panel. Source is split into small modules under `src/` with
`main.ts` as orchestration.

## Security and release posture (0.1.1)

- Engine downloads are pinned to the `v0.5.0` release tag, never `latest`.
- The asset is selected by OS and CPU (`src/binary-release.ts`); unsupported
  pairs fail closed with guidance to set a custom path.
- A download is executed only if its SHA-256 matches BOTH the committed digest
  in `release-digests.json` and the published `.sha256` sidecar naming that
  exact asset. The digest map ships empty until the engine release exists, so
  the plugin and the release workflow fail closed by design.
- Downloads are bounded (250 MB binary, 16 KB checksum), timeout-bounded
  including connection setup, single-flight, and stream to a temp file.
- Replacement keeps a `.previous` backup, smoke-runs `--version`, and rolls
  back on failure. The cache path is release- and asset-specific.
- `/health` acceptance requires engine name, exact version, and canonical vault
  path; probes are raced against a 3 s timeout. Server start is announced only
  after readiness; a child that never becomes ready is terminated.
- Command IDs are unprefixed per Obsidian submission requirements. Vault path
  access uses the public `FileSystemAdapter` API.

## Verification

- `npm test` — 11 unit tests (asset mapping, digests, checksums, exit/port
  guards, ask parsing).
- `npm run build` — `tsc -noEmit -skipLibCheck` + esbuild produce `main.js`.
- `npm audit --audit-level=high` — clean.
- `node scripts/verify-engine-assets.mjs` — downloads and hashes all five
  pinned engine assets against the committed digests (fails until published).

## Human-gated (not done here)

- Populate `release-digests.json` after the engine `v0.5.0` release is public.
- Tag `0.1.1`, publish the GitHub release, manual Obsidian UI smoke, and the
  community-directory PR (see `SUBMISSION.md`).
