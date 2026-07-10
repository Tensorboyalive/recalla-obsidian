# Obsidian community plugin submission

release candidate checklist for listing Recalla in the Obsidian community plugin
directory. public repository, release, and PR steps are external mutations and
must not run without explicit maintainer approval.

current official references:

- [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [release flow](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)
- [community repository](https://github.com/obsidianmd/obsidian-releases)

## local compliance checklist

- [x] `manifest.json` is at the root. its id is `recalla`, its description is
  concise and ends in a period, and `isDesktopOnly` is true because the plugin
  uses Node process, filesystem, HTTPS, and crypto APIs.
- [x] `versions.json` maps `0.1.1` to the minimum Obsidian app version.
- [x] `LICENSE` is Apache-2.0.
- [x] `README.md` explains install, operation, supported architectures, privacy,
  and the managed-engine download.
- [x] `npm test` and `npm run build` verify runtime guards and produce `main.js`.
- [x] `.github/workflows/release.yml` rejects a mismatched tag, reruns tests and
  build, verifies the pinned engine artifacts, and creates an immutable release.
- [x] managed binaries are selected by OS and CPU architecture and cached under
  release-and-asset-specific paths.
- [ ] after engine release, populate all five trusted hashes in
  `release-digests.json`; the plugin and release workflow fail closed until then.

## launch gates

- [ ] make `Tensorboyalive/recalla` public and publish engine `0.5.0` with all
  five architecture-specific binaries and checksums.
- [ ] run `node scripts/verify-engine-assets.mjs` against the populated digest
  map; it downloads and hashes every pinned engine asset.
- [ ] make `Tensorboyalive/recalla-obsidian` public.
- [ ] publish plugin release `0.1.1` with `main.js`, `manifest.json`, and
  `styles.css` attached at the release root.
- [ ] verify a clean manual install and one-click engine setup in Obsidian.
- [ ] open and land the community-directory PR.

## reviewer disclosure

Recalla downloads a standalone engine from its official GitHub release and runs
it. call this out directly in the submission:

- nothing downloads on plugin load. the user must run the setup command.
- the URL is pinned to the official engine `v0.5.0` release, not a mutable
  `latest` redirect.
- the selected asset must match the current OS and CPU architecture.
- the plugin downloads that asset's `.sha256`, requires it to name the exact
  binary, hashes the bytes, and rejects the download on any mismatch.
- installation uses a temporary file and restores the previous verified binary
  if replacement fails.
- users can bypass managed downloads and point to a self-installed executable.
- the plugin is desktop-only and has no telemetry.

reviewers may still reject an executable-downloading plugin. that is an external
policy decision, not a locally closable engineering task.

## community-plugins.json entry

```json
{
  "id": "recalla",
  "name": "Recalla",
  "author": "Tensorboyalive",
  "description": "Make your vault a fast, private, agent-readable brain. Index, search, and chat with your notes, all on your machine.",
  "repo": "Tensorboyalive/recalla-obsidian"
}
```

## approval-only release and submission

1. after the engine release is publicly verified, create the plugin tag:

   ```bash
   cd /Users/lucifer/Documents/Lucifer/projects/recalla-ecosystem/recalla-obsidian
   npm ci
   npm test
   npm run build
   git tag -a 0.1.1 -m "recalla obsidian 0.1.1"
   git push origin 0.1.1
   ```

   the release workflow checks the version triplet and publishes the required
   assets. verify the release is public before continuing.

2. fork `obsidianmd/obsidian-releases`, append the entry above to
   `community-plugins.json`, and open a PR titled `Add plugin: Recalla`.

3. in the PR, disclose the downloaded engine and checksum/rollback controls.
respond to automated checks and the human reviewer until merged.
