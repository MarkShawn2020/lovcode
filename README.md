<h1 align="center">
  <img src="assets/logo.svg" width="32" height="32" alt="Ataru" align="top">
  Ataru
</h1>

<p align="center">
  <strong>Search the memory of your AI work.</strong><br>
  <sub>用关键词或自然语言，快速、准确地找回过去的 AI 对话。</sub><br>
  <sub>macOS • Windows • Linux</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.0-blue" alt="Tauri">
  <img src="https://img.shields.io/badge/React-19-blue" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-Apache_2.0-green" alt="License">
</p>

## Ataru 是什么

Ataru 是一个 local-first 的 AI 对话记忆搜索器。它把 Claude Code、Codex 等工具散落在本机的聊天记录建立为统一索引，并按三个真正有用的层级召回：

- **Turn**：直接找回包含答案的一轮问答。
- **Session**：把多个命中归并到一段完整会话。
- **Project**：跨会话回看一个项目讨论过什么、如何演进。

Ataru 的北极星指标是 **TTCR（Time to Correct Recall）**：从开始输入，到用户确认“就是这条”的时间。关键词检索保持离线可用；自然语言检索在语义索引可用时采用混合召回，失败时降级到关键词结果。

## 与 Yoda 的关系

| 产品 | 负责的问题 |
|---|---|
| **Ataru** | 过去聊过什么，答案和上下文在哪里？ |
| **Yoda Agent Workspace** | 现在由哪个 Agent 继续做，如何执行与交付？ |

每条 Ataru 结果都保留原始 project、session、turn 和 message 定位信息。确认上下文后，可以直接在 Yoda 中继续，而不是把 Ataru 重新做成一套 Agent 工作台。

## 产品能力

- 中文友好的 Tantivy + Jieba 全文索引，支持技术名词、域名和字段查询。
- 自然语言查询、可选语义向量索引，以及关键词/语义的可解释混合排序。
- Turn、Session、Project 后端聚合，避免前端只对截断结果做二次猜测。
- 命中片段、原始会话上下文预览、message/line/turn 精确定位。
- 本地索引状态、增量刷新和清晰的语义降级提示。
- 一键将代表会话交给 Yoda 继续处理。

## 架构

Ataru 目前采用模块化单体，先稳定边界和检索质量，再决定哪些模块需要独立发布：

| 模块 | 职责 |
|---|---|
| `sdk` | `SearchRequest/Response/Hit`、稳定实体 ID、层级聚合与排名信号 |
| `api` | 版本化 Tauri/CLI 入口、模式编排、时限、降级与兼容适配 |
| `ai` | 查询意图、模式决策与 RRF 融合；现有语义存储暂由兼容适配器承接 |
| `desktop` | 搜索输入、结果验证、只读上下文与 Yoda handoff |

详细设计见：

- [ADR-0001：采用模块化单体重构 Ataru](docs/adr/0001-ataru-search-modular-monolith.md)
- [Ataru 搜索架构](docs/architecture/ataru-search-architecture.md)
- [Warm Academic 设计规范](docs/design-guide.md)

## 兼容策略

Ataru 从 Lovcode 演进而来。第一阶段只切换用户可见品牌与主路径，继续保留以下存量契约：

- `lovcode` npm/Rust package、CLI 命令与 GitHub release 资产。
- `app.lovpen.code` bundle identifier 和现有 updater endpoint。
- `lovcode:*` 本地存储键、`LOVCODE_*` 环境变量及旧数据/索引目录。
- 已有 Tauri commands、JSON 字段及 Yoda stable mapping ID。

这些兼容项会通过别名或双读迁移逐步收口，避免一次改名让旧历史、升级通道或 Yoda 映射失效。

## 使用

1. 启动 Ataru，首页会读取本地会话快照并检查搜索索引。
2. 输入关键词，或描述你记得的问题、决策与上下文。
3. 在 Turn、Session、Project 之间切换，选择最合适的召回粒度。
4. 在右侧核对原始上下文；需要继续工作时选择 **在 Yoda 中继续**。

既有兼容 CLI 仍可使用：

```bash
lovcode search "search ranking" --json --limit 20

# v1 Ataru 聚合契约；旧命令输出保持不变
lovcode search "search ranking" --json --level turn --limit 20
```

## 开发

```bash
git clone --recursive https://github.com/lovstudio/Ataru.git
cd Ataru
pnpm install

# Tauri + Vite 开发
pnpm dev:app

# 仅前端 HMR，Rust 进程不自动重启
pnpm dev:app:no-watch

# 发布构建
pnpm tauri build
```

| 层 | 技术 |
|---|---|
| Desktop | Tauri 2 |
| Frontend | React 19, TypeScript, Tailwind CSS, shadcn/ui |
| Keyword Search | Tantivy, Jieba |
| Semantic Search | OpenAI-compatible embeddings, LanceDB / SQLite fallback |
| State | React Query, Jotai |

## Release notes

- [CHANGELOG.md](CHANGELOG.md)
- [GitHub Releases](https://github.com/lovstudio/Ataru/releases)

## License

Apache-2.0
