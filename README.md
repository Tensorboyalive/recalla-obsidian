<div align="center">

<br/>

# recalla-obsidian

### search and chat your vault, without leaving obsidian

the obsidian plugin for [**recalla**](https://github.com/Tensorboyalive/recalla) —
a private, local-first, agent-native second brain. bm25 + semantic search and
chat over your notes, all on your machine.

<br/>

[![release](https://img.shields.io/badge/release-0.1.0-A1ED63?labelColor=093328)](https://github.com/Tensorboyalive/recalla-obsidian/releases/tag/0.1.0)
[![license](https://img.shields.io/badge/license-Apache--2.0-A1ED63?labelColor=093328)](./LICENSE)
[![local-first](https://img.shields.io/badge/local--first-no%20telemetry-093328?labelColor=A1ED63)](#)

</div>

---

## install

the community directory listing is pending, so grab it from the release:

> [**release 0.1.0**](https://github.com/Tensorboyalive/recalla-obsidian/releases/tag/0.1.0)

then point the plugin at a running recalla engine:

```bash
pip install recalla        # or the zero-python binary
recalla serve --watch      # local json api on 127.0.0.1
```

## what it does

- search your vault with bm25 + semantic ranking, inside obsidian.
- chat over the results. retrieval stays local; only the context you pick reaches
  the llm (openai · anthropic · ollama · echo).
- nothing leaves your machine. no cloud, no account, no telemetry.

---

## the recalla ecosystem

| repo | what it is |
|------|-----------|
| [**recalla**](https://github.com/Tensorboyalive/recalla) | the engine: cli, retrieval, local json api, mcp server |
| [**recalla-obsidian**](https://github.com/Tensorboyalive/recalla-obsidian) | this plugin |
| [**create-recalla**](https://github.com/Tensorboyalive/create-recalla) | the `npx` scaffolder for a fresh vault |
| [**recalla-starter**](https://github.com/Tensorboyalive/recalla-starter) | a template vault to start from |

<div align="center"><br/><sub>apache-2.0 · a second brain that stays yours</sub></div>
