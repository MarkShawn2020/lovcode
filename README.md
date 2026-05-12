<p align="center">
  <img src="docs/images/cover.png" alt="Lovcode Cover" width="100%">
</p>

<h1 align="center">
  <img src="assets/logo.svg" width="32" height="32" alt="Logo" align="top">
  Lovcode
</h1>

<p align="center">
  <strong>Search every conversation you've ever had with an AI.</strong><br>
  <sub>搜索你和 AI 之间的每一次对话</sub><br>
  <sub>Claude Code · Claude Desktop · Codex · ChatGPT · Gemini · … (adapter-based)</sub><br>
  <sub>macOS • Windows • Linux</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.0-blue" alt="Tauri">
  <img src="https://img.shields.io/badge/Rust-stable-orange" alt="Rust">
  <img src="https://img.shields.io/badge/React-19-blue" alt="React">
  <img src="https://img.shields.io/badge/License-Apache_2.0-green" alt="License">
</p>

---

> **🚧 v0.40 In-Progress Rewrite.** Lovcode is being refocused from a general "vibe coding assistant" into a single-purpose tool: **AI conversation search**. The previous Agent Workbench / Skills / Marketplace / Lab surfaces have been removed. The legacy v0.39 codebase is preserved on the [`legacy/v0.39-workbench`](https://github.com/lovstudio/lovcode/tree/legacy/v0.39-workbench) branch.

---

## Why Lovcode

You've had hundreds of conversations across Claude Code, Codex, Claude Desktop, ChatGPT, Gemini. Half of them contain the answer to the problem you're staring at right now. The other half contain code you've already written. None of them are findable.

Lovcode indexes all of it locally, into one searchable corpus — with adapter-based ingest so any AI tool that writes session files to disk can plug in.

## Four Ways to Search

Lovcode is **one Rust core** with four surfaces. Pick whichever fits your workflow.

| Surface | What it is | When to use |
|---|---|---|
| **`lovcode` CLI** | Single binary. `lovcode search "..."`. | Terminal, scripts, Unix pipes (`lovcode search foo \| jq`). Zero daemons. |
| **MCP server** | `lovcode mcp` subcommand, stdio transport. | Plug into Claude Desktop / Cursor / any MCP client — your AI can search your past AI conversations. |
| **Desktop + Floating Window** | Tauri 2 app with a global-hotkey floating search palette. | Spotlight-style instant recall while you work. |
| **Web UI** | Static frontend hitting the same core. | Self-host on your LAN, or run alongside the desktop app. |

All four call the same Rust crate. No duplicated logic, no Python runtime, no HTTP server you forgot to kill.

## Adapter-Based Data Sources

Each source is an adapter implementing a small Rust trait. Adding a new one means writing a parser, not rewiring the index.

**Shipped / planned for v0.40:**

- [x] **Claude Code** (`~/.claude/projects/**/*.jsonl`)
- [x] **Codex** (`~/.codex/sessions/**/*.jsonl`)
- [ ] **Claude Desktop** (cookie + Keychain decrypt → API pull)
- [ ] **ChatGPT** export (`.zip` import)
- [ ] **Gemini** export
- [ ] **Cursor / Zed / Continue.dev** chat history

> Want another source? An adapter is ~150 lines of Rust. PRs welcome.

## Installation

### CLI (quickest)

```bash
# macOS / Linux
curl -fsSL https://lovcode.dev/install.sh | sh

# or via cargo
cargo install lovcode
```

### Desktop app

Download the latest `.dmg` / `.msi` / `.AppImage` from [Releases](https://github.com/lovstudio/lovcode/releases).

### MCP server (Claude Desktop)

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "lovcode": {
      "command": "lovcode",
      "args": ["mcp"]
    }
  }
}
```

## Usage

### CLI

```bash
# Build the index (incremental; safe to re-run)
lovcode index

# Search everything
lovcode search "tantivy chinese tokenizer"

# Filter by source / project / date
lovcode search "deadlock" --source claude-code --since 7d
lovcode search --project ~/projects/lovcode --json | jq

# List indexed sources
lovcode sources

# Run MCP server (stdio)
lovcode mcp

# Run HTTP server (for the web UI / external clients)
lovcode serve --port 7878
```

### Desktop

1. Launch Lovcode → it auto-indexes on first run, then watches in the background.
2. Hit the global hotkey (default `⌘⇧K`) to open the floating search palette anywhere.
3. Hit `↵` on a result to open the full conversation in the main window.

### Web

```bash
lovcode serve --port 7878
# open http://localhost:7878
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Surfaces                                                    │
│  ┌─────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────┐   │
│  │ CLI bin │  │ MCP stdio│  │ Tauri desktop│  │ Web (HTTP)│  │
│  └────┬────┘  └────┬─────┘  └──────┬───────┘  └─────┬────┘   │
└───────┼────────────┼───────────────┼────────────────┼────────┘
        │            │               │                │
        ▼            ▼               ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│  lovcode-core  (Rust crate)                                  │
│  • Adapters  (claude-code / codex / chatgpt / …)             │
│  • Index     (tantivy + jieba for CJK)                       │
│  • Query     (full-text, filters, faceting)                  │
│  • Watcher   (notify-based incremental indexing)             │
└──────────────────────────────────────────────────────────────┘
```

**Design rules:**

- **One core, many shells.** All search logic lives in `lovcode-core`. CLI / Tauri / HTTP server are thin shells.
- **No daemon required.** CLI is cold-start fast. HTTP server is opt-in for web/MCP-remote use cases.
- **Local-first.** Your conversations never leave your machine unless you explicitly point at a remote index.
- **Adapter pluggability over feature bloat.** New source = new adapter file. No core changes.

## Roadmap

See the [v0.40 rewrite plan](docs/v0.40-rewrite-plan.md) for the live punch list. High level:

- **Phase 1** — Extract `lovcode-core` Rust crate from the current Tauri backend. Strip Workbench / Skills / Marketplace / Lab from `src/`. Keep search + floating window.
- **Phase 2** — Ship `lovcode` CLI binary with `index` / `search` / `sources` / `serve` / `mcp` subcommands.
- **Phase 3** — Add adapters: Claude Desktop, ChatGPT export, Gemini export.
- **Phase 4** — Polish: distribution, auto-update, docs site.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Core | Rust, tantivy (search), jieba-rs (CJK), notify (watcher) |
| CLI | clap |
| HTTP / MCP | axum, rmcp |
| Desktop | Tauri 2 |
| Frontend | React 19, TypeScript, Tailwind CSS, shadcn/ui, Jotai |

## Legacy (v0.39)

The pre-rewrite codebase — Agent Workbench, Skills manager, Marketplace, Lab/Wish Room, MaaS registry, multi-CLI launcher — lives on [`legacy/v0.39-workbench`](https://github.com/lovstudio/lovcode/tree/legacy/v0.39-workbench). It will not receive new features but remains buildable.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lovstudio/lovcode&type=Date)](https://star-history.com/#lovstudio/lovcode&Date)

## License

Apache-2.0
