<p align="center">
  <img src="docs/images/cover.png" alt="Lovcode Cover" width="100%">
</p>

<h1 align="center">
  <img src="assets/logo.svg" width="32" height="32" alt="Logo" align="top">
  Lovcode
</h1>

<p align="center">
  <strong>I came, I saw, I conquered. / 我来，我见，我征服。</strong><br>
  <sub>Desktop command table for Claude Code, Codex, terminal sessions, and local AI coding history</sub><br>
  <sub>macOS • Windows • Linux</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.0-blue" alt="Tauri">
  <img src="https://img.shields.io/badge/React-19-blue" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-Apache_2.0-green" alt="License">
</p>

---

<p align="center">
  <a href="https://code.lovstudio.ai/">Website</a> •
  <a href="#overview">Overview</a> •
  <a href="#features">Features</a> •
  <a href="#documentation">Docs</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#development">Development</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#release-notes">Release Notes</a>
</p>

---

## Overview

Lovcode is an open-source desktop app for developers who work with multiple AI coding tools. It brings Claude Code, Codex, terminal sessions, local chat history, linked files, runtime configuration, commands, MCP servers, skills, hooks, and MaaS providers into one local command table.

The goal is simple: arrive at the right project, see the full context, and resume or hand off work without digging through scattered terminals and exports.

![Gallery](docs/assets/gallery.png)

## Workflow

| Step | Lovcode keeps close |
|------|---------------------|
| **I came** | Project paths, agent runtimes, setup scripts, and session launch controls |
| **I saw** | Searchable histories, tool calls, linked files, usage details, and structured traces |
| **I conquered** | Resume actions, cross-agent handoff prompts, archived context, and release-ready records |
| **我来** | 项目目录、运行时、启动脚本和 Agent 入口 |
| **我见** | 可搜索历史、工具调用、关联文件和结构化上下文 |
| **我征服** | 可续接会话、跨 Agent 交接、归档记录和交付线索 |

## Features

### Workbench

- Launch Claude Code, Codex, terminal, or general chat sessions from a selected project.
- Keep project/session setup, cleanup, and custom runtime scripts available in the embedded terminal dock.
- Track pinned, archived, unread, review, runtime, and display-mode state across sessions.
- Duplicate windows, resume sessions, and copy project path actions from the workbench.

### History and Search

- Browse Claude Code, Codex, app-code, app-web, and app-cowork histories from one viewer.
- Search full text, session IDs, metadata, and details with Chinese-aware indexing.
- Index active and archived Codex session files, including dotted tokens such as domains, package names, and asset names.
- Inspect tool calls, thinking blocks, grouped results, generated images, and token/cost context.

### Files and Context

- Open local paths from prompts, markdown links, and agent output directly inside Lovcode.
- Preview UTF-8 text, Markdown, images, directories, ZIP archives, and unsupported binary fallbacks.
- Jump to line/column references and route unresolved agent paths through candidate prefixes.
- Copy session information, related files, trace context, and handoff prompts for Claude Code or Codex.

### Configuration

- Manage commands, MCP servers, skills, hooks, sub-agents, output styles, runtime environments, and MaaS providers.
- Configure Claude Code and Codex runtimes, inspect install/version status, and keep runtime preferences local.
- Activate MaaS providers separately for Claude Code and Codex with vendor/model metadata and token verification.
- Browse marketplace templates and installed skills with sorting, filtering, previews, and token estimates.

### App Surface

- Localized interface for English, Chinese, and system language.
- In-app update checks, release history, auto-update controls, and direct release links.
- Authenticated Lovstudio feedback tickets with tags, ticket IDs, and admin review tooling.

## Documentation

Project documentation that does not need to live in the repository root is kept under `docs/`.

- [Proxy configuration](docs/proxy-configuration.md)
- [Product requirements](docs/prd-parallel-vibe-coding.md)
- [Warm Academic design guide](docs/design-guide.md)
- [OpenCode research index](docs/research/RESEARCH_INDEX.md)

## oh-my-lovcode

Community configuration framework for Lovcode, inspired by oh-my-zsh.

```bash
curl -fsSL https://raw.githubusercontent.com/lovstudio/oh-my-lovcode/main/install.sh | bash
```

Share and discover statusbar themes, keybindings, and more at [oh-my-lovcode](https://github.com/lovstudio/oh-my-lovcode).

## Installation

Download the latest release for your platform from [Releases](https://github.com/lovstudio/lovcode/releases).

Lovcode publishes desktop builds for macOS, Windows, and Linux when release workflows complete.

## Usage

1. Launch Lovcode.
2. Open **Workbench** and choose a project, runtime, setup script, and agent channel.
3. Start Claude Code, Codex, terminal, or general chat work from the selected context.
4. Use **History** and global search to find previous sessions across Claude Code, Codex, and app sources.
5. Open a session to inspect tool calls, thinking, linked files, generated images, and usage details.
6. Continue from the session footer, resume in a new agent, or copy handoff context.
7. Manage commands, MCP servers, skills, hooks, output styles, runtime settings, and MaaS providers under **Configuration**.

## Development

```bash
# Clone the repository (with submodules)
git clone --recursive https://github.com/lovstudio/lovcode.git
cd lovcode

# Install dependencies
pnpm install

# Run full Tauri development with Rust watcher
pnpm dev:app

# Frontend-focused development: Vite HMR stays on, Rust changes do not restart the app
pnpm dev:app:no-watch

# Build for distribution
pnpm tauri build
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Tailwind CSS, Vite |
| Backend | Rust, Tauri 2 |
| UI Components | shadcn/ui |
| State | Jotai |
| Search | Tantivy + jieba (full-text, Chinese-aware) |

## Release Notes

The README stays focused on the current product surface. Version-by-version details live in:

- [CHANGELOG.md](CHANGELOG.md)
- [GitHub Releases](https://github.com/lovstudio/lovcode/releases)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lovstudio/lovcode&type=Date)](https://star-history.com/#lovstudio/lovcode&Date)

## License

Apache-2.0
