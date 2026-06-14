# Handoff: zero-install engine management + chat panel

Goal: make the Recalla plugin work for a non-technical user who has nothing
installed but Obsidian. No Python, no terminal, no manual binary setup.

## What changed

The plugin was a single `main.ts` that shelled out to a `recalla` CLI assumed to
be on PATH. It now auto-manages a standalone engine binary, adds a chat panel, and
ships a one-click onboarding command. Source was split into small, cohesive
modules under `src/`.

### New files

- `src/types.ts` — shared types: `RecallaSettings` (with `recallaPath` now
  defaulting to empty, meaning "let the plugin decide"), `AskOutcome`/`AskError`,
  `ServerState`, and a `toMessage(unknown)` helper.
- `src/binary-manager.ts` — `BinaryManager`. Detects OS via `process.platform`
  (darwin -> `recalla-macos`, linux -> `recalla-linux`, win32 ->
  `recalla-windows.exe`), downloads the asset from
  `https://github.com/Tensorboyalive/recalla/releases/latest/download/<asset>`
  using Node `https` with manual 302 redirect following, streams to a `.download`
  temp file, atomically renames into place, `chmod +x` on non-Windows, and caches
  under `<plugin-dir>/bin/recalla-engine`. Progress is reported through a single
  reused `Notice` (percent when content-length is known, MB otherwise).
- `src/ask.ts` — pure helpers: `parseAskOutput` (splits answer from a `sources:`
  line, handling inline comma lists and bulleted lists) and `classifyAskError`
  (maps stderr to `server-down` / `no-api-key` / `unknown`).
- `src/chat-view.ts` — `RecallaChatView`, a right-sidebar `ItemView` with a
  scrollable message list and a textarea input (Enter sends, Shift+Enter newline).
  Renders the answer plus clickable source links. Shows targeted inline help for
  engine-missing (with a Download button), server-down (with a Start server
  button), and no-api-key (OPENAI_API_KEY / ANTHROPIC_API_KEY / Ollama guidance).
- `src/search-modal.ts` — the existing `RecallaSearchModal`, extracted unchanged.
- `src/settings-tab.ts` — `RecallaSettingTab`. New engine status line + download
  button, and the path field is now an optional "Custom engine path" override.

### Modified files

- `main.ts` — now orchestration only. Wires up `BinaryManager`, registers the
  chat view + ribbon icon, and adds commands:
  - `Recalla: Open chat`
  - `Recalla: Download or update the engine`
  - `Recalla: Make my vault agent-readable` (download if needed -> index -> serve)
  Key methods: `resolveBinaryPath()` enforces the resolution order
  **user-set path > downloaded binary > `recalla` on PATH**; `runAsk()` spawns
  `<binary> ask "<q>" --vault <vaultPath>` and returns a structured `AskOutcome`;
  `openSource()` opens cited notes; `indexVault()` now returns a Promise so the
  one-click flow can chain index -> serve. All CLI calls go through
  `resolveBinaryPath()`.
- `styles.css` — added chat panel styles (message bubbles, source links, input
  row, inline help) using Obsidian CSS variables. Motion/layout untouched.
- `README.md` — rewritten to describe the zero-install flow, the chat panel, the
  new commands/settings, and how to configure an LLM key (or Ollama).

## Design notes

- Desktop-only plugin, so Node built-ins (`child_process`, `https`, `fs`, `path`)
  are imported directly; esbuild marks them external.
- Submodules import the plugin class with `import type`, which is erased at
  compile time, so there is no runtime circular dependency.
- Strictly typed throughout: no `any`. Buffers, `NodeJS.ErrnoException`, and
  `IncomingMessage` are typed explicitly.

## Verification

Run from `~/projects/recalla-obsidian`:

- `npm install` — completes.
- `npm run build` — exit 0. Runs `tsc -noEmit -skipLibCheck` then esbuild;
  produces `main.js` (31 KB) with no errors. Confirmed the bundle contains the
  `recalla-chat-view` registration.
- `npx tsc --noEmit --skipLibCheck` — exit 0, no type errors.

`main.js` is gitignored (build artifact); source modules are committed.

## Not done (out of scope / needs human)

- No live end-to-end run against a real engine binary or a real LLM key (the
  release assets and keys are not available in this environment). Logic for
  download, ask parsing, and error classification is unit-friendly via `src/ask.ts`
  and was exercised through the type checker and build only.
- No release published, nothing pushed. Human approves releases.
