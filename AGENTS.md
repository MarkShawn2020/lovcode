# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Design System

This project uses **Lovstudio Warm Academic Style (暖学术风格)**

Reference complete design guide: file:///Users/mark/@lovstudio/design/design-guide.md

### Quick Rules
1. **禁止硬编码颜色**：必须使用 semantic 类名（如 `bg-primary`、`text-muted-foreground`）
2. **字体配对**：标题用 `font-serif`，正文用默认 `font-sans`
3. **圆角风格**：使用 `rounded-lg`、`rounded-xl`、`rounded-2xl`
4. **主色调**：陶土色（按钮/高亮）+ 暖米色背景 + 炭灰文字
5. **组件优先**：优先使用 shadcn/ui 组件

### Color Palette
- **Primary**: #CC785C (陶土色 Terracotta)
- **Background**: #F9F9F7 (暖米色 Warm Beige)
- **Foreground**: #181818 (炭灰色 Charcoal)
- **Border**: #E8E6DC

### Common Patterns
- 主按钮: `bg-primary text-primary-foreground hover:bg-primary/90`
- 卡片: `bg-card border border-border rounded-xl`
- 标题: `font-serif text-foreground`

## Project Overview

Ataru is a local-first AI conversation recall desktop app built with Tauri 2 + React 19 + TypeScript. It focuses on searching and recovering useful context from AI coding tool histories while retaining the legacy Lovcode CLI as a compatibility alias and preserving storage contracts.

## Search Domain Model

Ataru 的公开搜索层级固定为 `turn → run → session → project`：

- `Turn`：最小原子 transcript item，例如一条用户消息、AI 回复、工具调用或工具结果；Turn 不拥有标题。
- `Run`：一次完整执行，从用户提出问题开始，到 AI 完成最终回应结束，包含多个 Turn。底层索引继续使用兼容字段 `round_index` / `round_prompt`，公开 API 使用 `runIndex` / `runPrompt`。
- `Session`：同一来源的一段连续对话，包含多个 Run。
- `Project`：一个工作目录及其历史 Session 集合。

UI 和搜索契约不得把 `Turn` 展示成“用户问题 + AI 完整回复”；那是 `Run` 的语义。Turn 结果应展示消息类型、正文、命中位置和所属 Run 上下文；Run 结果才可以使用用户首句作为标题。禁止为 Turn 或 Run 使用 `Untitled turn`、`未命名回合` 之类的标题占位。

## Commands

```bash
# Frontend development (hot reload)
pnpm dev

# Type check + production build
pnpm build

# Run Tauri desktop app (auto-starts pnpm dev)
pnpm tauri dev

# Build distributable
pnpm tauri build
```

## Architecture

**Dual-layer architecture:**
- `src/` - React frontend (Vite, port 1420)
- `src-tauri/` - Rust backend (Tauri 2)

**Frontend-backend communication:**
- Use `invoke()` from `@tauri-apps/api/core` to call Rust commands
- Define Rust commands with `#[tauri::command]` in `src-tauri/src/lib.rs`
- Register commands in `tauri::generate_handler![]`

## Conventions

- CSS: Tailwind CSS preferred
- No dynamic imports or setTimeout unless necessary
- Extract shared components when patterns repeat across multiple components
- 不要执行pnpm build等，因为本地在运行 pnpm tauri dev

## Path Migration Recovery

- 移动项目根目录后，Cargo/Tauri 的 `src-tauri/target` 可能继续保存旧绝对路径。
- `pnpm install` 只更新前端依赖，不会刷新 Rust 构建产物；若启动错误引用旧目录下的权限文件或 build 输出，先退出当前 dev 进程，再执行：

  ```bash
  cargo clean --manifest-path src-tauri/Cargo.toml
  ```

- 清理后使用原来的 `npx lovstudio app ataru tauri dev` 或 `pnpm tauri dev` 重新启动；该操作只清理可重建的本地构建缓存，不涉及源码和用户会话数据。

## Cross-session Notes

- `scripts/sync-cargo-version.cjs` 必须同时同步 `src-tauri/tauri.conf.json`，其 `version` 优先于 Cargo.toml（2026-08-18, c163788）
- `pnpm version` 会被 pnpm 内建命令截获，bump 必须用 `pnpm run version`（2026-08-18, c163788）
- 未识别的 CLI 参数会 fall through 去启动桌面 GUI，所以外部脚本调用 ataru 前必须先 `--version` 版本门控（2026-08-18, c163788）
- JSON CLI 的检索只走 keyword 模式，`--level` 会强制 `SearchMode::Keyword`，不要承诺命令行有语义/hybrid（2026-08-18, c163788）
- `SEARCH_INDEX_BUILD_LOCK` 只在进程内生效，CLI 与桌面端并发构建靠「写临时目录再原子替换」兜底，构建前先读 `index status`（2026-08-18, c163788）
- Ataru projectId 是以 `-` 开头的路径 slug，传给 argparse 类解析器必须用 `--flag=value` 形式（2026-08-18, c163788）
- 搜索响应字段是 camelCase（`tookMs` 而非 `took_ms`）（2026-08-18, c163788）
