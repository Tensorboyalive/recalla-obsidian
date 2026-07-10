<div align="center">

<br/>

# recalla-obsidian

### search and chat your vault, without leaving obsidian

the obsidian plugin for [**recalla**](https://github.com/Tensorboyalive/recalla) —
a private, local-first, agent-native second brain. bm25 + semantic search and
chat over your notes, all on your machine.

<br/>

[![release](https://img.shields.io/badge/release-0.1.1-A1ED63?labelColor=093328)](https://github.com/Tensorboyalive/recalla-obsidian/releases/latest)
[![license](https://img.shields.io/badge/license-Apache--2.0-A1ED63?labelColor=093328)](./LICENSE)
[![local-first](https://img.shields.io/badge/local--first-no%20telemetry-093328?labelColor=A1ED63)](#)

</div>

---

## install

the community directory listing is pending, so install the three files from the
[latest release](https://github.com/Tensorboyalive/recalla-obsidian/releases/latest)
into `.obsidian/plugins/recalla/`, then enable **recalla** in community plugins.

run **recalla: make my vault agent-readable** from the command palette. the
plugin downloads the matching OS and CPU build from the pinned engine `v0.5.0`
release. it requires an embedded trusted digest, requires the published sidecar
to name that exact asset, and hashes the bytes before execution. then it indexes
the vault and starts the local api. no python or terminal setup is required.

managed builds support macOS arm64/x64, Linux arm64/x64, and Windows x64.
advanced users on another architecture can set a custom `recalla` executable in
plugin settings instead.

## what it does

- search your vault with bm25 + semantic ranking, inside obsidian.
- chat over full matching sections with citations. without an llm key, recalla
  returns an offline extractive answer from your notes.
- copy a ready-to-paste mcp config so agents can read and write memory locally.
- manage the engine, indexing, and local server from the command palette.
- no cloud, no account, no telemetry. only context sent to a configured cloud llm
  leaves the machine.

---

## the recalla ecosystem

| repo | what it is |
|------|-----------|
| [**recalla**](https://github.com/Tensorboyalive/recalla) | the engine: cli, retrieval, local json api, mcp server |
| [**recalla-obsidian**](https://github.com/Tensorboyalive/recalla-obsidian) | this plugin |
| [**create-recalla**](https://github.com/Tensorboyalive/create-recalla) | the `npx` scaffolder for a fresh vault |
| [**recalla-starter**](https://github.com/Tensorboyalive/recalla-starter) | a template vault to start from |

<div align="center"><br/><sub>apache-2.0 · a second brain that stays yours</sub></div>
