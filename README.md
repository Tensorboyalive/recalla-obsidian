# Recalla for Obsidian

Make your Obsidian vault a fast, private, agent-readable brain. Recalla indexes your
notes into agent-readable cards, serves a local HTTP search API on `127.0.0.1:8090`,
and exposes an MCP server so AI agents can read your vault. Everything runs locally,
and you never have to touch a terminal.

The plugin runs a small standalone Recalla engine in the background and adds an
in-Obsidian chat panel and search panel plus one-click setup commands. Nothing to
install by hand: the plugin downloads the engine for your operating system on
demand.

## What it does

- Downloads and manages the Recalla engine automatically (no Python, no terminal).
- Indexes your vault into agent-readable cards.
- Runs a local HTTP API (`127.0.0.1:8090` by default) for fast search.
- Adds a right-sidebar chat panel that answers from your vault with clickable
  source links.
- Provides an in-Obsidian search panel backed by that API.
- Copies a ready-to-paste MCP config so AI agents can connect to your vault.
- Generates `AGENTS.md` and `llms.txt` for agent tooling.

## Requirements

- Obsidian 1.4.0 or newer (desktop only, since the plugin runs a local engine).

That is it. The first time you need the engine, run **Recalla: Make my vault
agent-readable** or **Recalla: Download or update the engine** and the plugin
fetches the correct standalone binary from the latest GitHub release, caches it
under the plugin folder, and uses it for everything.

Advanced users can point the plugin at their own engine build via the
**Custom engine path** setting. Resolution order is: custom path, then the
downloaded engine, then `recalla` on your PATH.

### Answering questions

The chat panel runs `recalla ask` locally. To get answers you need a language
model:

- Set `OPENAI_API_KEY` in your environment for OpenAI, or
- Set `ANTHROPIC_API_KEY` for Claude, or
- Run a local model with [Ollama](https://ollama.com), which needs no key.

Restart Obsidian after setting an environment variable so it is picked up.

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

Click the chat ribbon icon, or open the command palette and run any of these:

- `Recalla: Make my vault agent-readable` downloads the engine if needed, indexes
  the vault, and starts the local server, all in one click.
- `Recalla: Download or update the engine` fetches the latest engine binary.
- `Recalla: Open chat` opens the right-sidebar chat panel.
- `Recalla: Reindex vault` rebuilds the agent index.
- `Recalla: Start local server` starts the local HTTP API and MCP server.
- `Recalla: Stop local server` stops it.
- `Recalla: Search vault (agent index)` opens the in-Obsidian search panel.
- `Recalla: Copy MCP config to clipboard` copies an MCP server config for your agent.
- `Recalla: Generate AGENTS.md and llms.txt` writes agent-tooling files into the vault.

A status bar item shows the current state: `Recalla: off`, `Recalla: running :8090`,
or `Recalla: indexing...`.

## Settings

- **Recalla engine**: shows engine status and a button to download or update it.
- **Custom engine path**: optional override. Leave empty to use the managed engine.
- **Server port**: local HTTP API port (default `8090`, bound to `127.0.0.1`).
- **Auto-start server on load**: start the server when Obsidian opens.
- **Auto-reindex on save**: reindex automatically after notes change (debounced).

## License

Apache-2.0
