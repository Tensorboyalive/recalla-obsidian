# Recalla for Obsidian

Make your Obsidian vault a fast, private, agent-readable brain. Recalla indexes your
notes into agent-readable cards, serves a local HTTP search API on `127.0.0.1:8090`,
and exposes an MCP server so AI agents can read your vault. Everything runs locally,
and you never have to touch a terminal.

This plugin is a thin wrapper around the `recalla` CLI (a Python tool). The plugin
runs the CLI in the background and adds an in-Obsidian search panel plus one-click
setup commands.

## What it does

- Indexes your vault into agent-readable cards.
- Runs a local HTTP API (`127.0.0.1:8090` by default) for fast search.
- Provides an in-Obsidian search panel backed by that API.
- Copies a ready-to-paste MCP config so AI agents can connect to your vault.
- Generates `AGENTS.md` and `llms.txt` for agent tooling.

## Requirements

- Obsidian 1.4.0 or newer (desktop only, since the plugin shells out to a CLI).
- The `recalla` CLI installed and on your PATH:

  ```
  pip install recalla
  ```

  If `recalla` is not on your PATH, set the absolute path to it in the plugin
  settings ("Recalla CLI path").

## Install (manual)

1. Build or download `main.js` and grab `manifest.json` from this repo.
2. Create the folder `<your-vault>/.obsidian/plugins/recalla/`.
3. Copy `main.js` and `manifest.json` (and `styles.css` if present) into that folder.
4. In Obsidian, open Settings, go to Community plugins, and enable "Recalla".

Community-plugin store submission is planned, after which you will be able to install
it directly from inside Obsidian.

## Build from source

```
npm install
npm run build
```

This produces `main.js` in the repo root.

## Usage

Open the command palette and run any of these commands:

- `Recalla: Reindex vault` rebuilds the agent index.
- `Recalla: Start local server` starts the local HTTP API and MCP server.
- `Recalla: Stop local server` stops it.
- `Recalla: Search vault (agent index)` opens the in-Obsidian search panel.
- `Recalla: Copy MCP config to clipboard` copies an MCP server config for your agent.
- `Recalla: Generate AGENTS.md and llms.txt` writes agent-tooling files into the vault.

A status bar item shows the current state: `Recalla: off`, `Recalla: running :8090`,
or `Recalla: indexing...`.

## Settings

- **Recalla CLI path**: command or absolute path to the `recalla` CLI (default `recalla`).
- **Server port**: local HTTP API port (default `8090`, bound to `127.0.0.1`).
- **Auto-start server on load**: start the server when Obsidian opens.
- **Auto-reindex on save**: reindex automatically after notes change (debounced).

## License

Apache-2.0
