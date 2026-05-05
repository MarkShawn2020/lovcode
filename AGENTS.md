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

Lovcode is a Vibe Coding assistant desktop app built with Tauri 2 + React 19 + TypeScript. Primary focus is supporting AI coding tool ecosystems (Codex, codex, etc.) with chat history viewer as the first feature.

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