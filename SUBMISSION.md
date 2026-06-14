# Obsidian community plugin submission

Everything needed to list Recalla in the Obsidian community plugin directory.
The two externally-visible steps (creating the GitHub release and opening the PR)
are listed last and need explicit approval before running.

## Compliance checklist (done)

- [x] Public repo: `Tensorboyalive/recalla-obsidian`.
- [x] `manifest.json` at root: id `recalla` (no "obsidian", no "plugin"), name
      `Recalla`, version, minAppVersion, description (concise, no "this plugin",
      does not mention Obsidian), author, authorUrl, `isDesktopOnly: true`
      (it spawns a child process and downloads a binary, so desktop only).
- [x] `versions.json` maps the version to a minAppVersion.
- [x] `LICENSE` present (Apache-2.0).
- [x] `README.md` explains install, usage, and requirements.
- [x] Build is clean: `npm run build` produces `main.js`, `tsc --noEmit` passes.
- [x] No telemetry, no network calls except the pinned GitHub release download,
      which is SHA256-verified before the binary is executed.

## Reviewer note (be ready for this)

Recalla downloads a standalone engine binary from its own GitHub release and runs
it. Obsidian reviewers scrutinize code that fetches and executes binaries. Our
mitigations, call them out in the PR:

- The download URL is pinned to the official repo
  (`github.com/Tensorboyalive/recalla/releases/latest/download/...`).
- The download is verified against a published per-binary `.sha256` and rejected
  on mismatch (see `src/binary-manager.ts`).
- The user must opt in (a command or the one-click setup) before anything is
  downloaded; nothing happens silently on load.
- `isDesktopOnly` is true; the plugin uses Node `child_process`/`https`/`crypto`.
- Users can instead point at a `recalla` they installed themselves (settings).

## community-plugins.json entry (paste this)

Append to the array in `obsidianmd/obsidian-releases/community-plugins.json`:

```json
{
	"id": "recalla",
	"name": "Recalla",
	"author": "Tensorboyalive",
	"description": "Make your vault a fast, private, agent-readable brain. Index, search, and chat with your notes, all on your machine.",
	"repo": "Tensorboyalive/recalla-obsidian"
}
```

## Steps that need approval (do not run without an explicit go)

1. Create the plugin GitHub release (tag must equal the manifest version, assets
   at the release root):

   ```bash
   cd ~/projects/recalla-obsidian
   npm run build   # ensure main.js is current
   gh release create 0.1.0 --repo Tensorboyalive/recalla-obsidian \
     --title "Recalla 0.1.0" \
     --notes "First release: index, search, chat panel, MCP config, and a self-managed engine binary (SHA256-verified)." \
     main.js manifest.json styles.css
   ```

2. Open the directory PR:

   ```bash
   gh repo fork obsidianmd/obsidian-releases --clone --remote
   # edit community-plugins.json: append the entry above
   # commit on a branch, push to your fork, then:
   gh pr create --repo obsidianmd/obsidian-releases \
     --title "Add plugin: Recalla" \
     --body "Recalla makes a vault agent-readable: local index, search, and chat. Desktop-only. Engine binary is downloaded from our pinned GitHub release and SHA256-verified before execution. Repo: https://github.com/Tensorboyalive/recalla-obsidian"
   ```

3. Respond to the automated bot checks and a human reviewer. Iterate until merged.
   Once merged, Recalla appears in Settings -> Community plugins for everyone.
