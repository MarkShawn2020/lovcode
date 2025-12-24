# PRD: Parallel Vibe Coding Workspace

## Overview

在 Lovcode 中构建「并行 Vibe Coding」工作区，让开发者可以同时管理多个项目、并行开发多个 feature，每个 feature 完成后自动通知用户 review。

## 目标用户

使用 AI coding 工具（claude code, codex 等）的开发者，需要同时处理多个项目或在同一项目中并行开发多个功能。

## 核心场景

1. **多项目切换**：开发者同时维护 3 个项目，每个项目都有 pnpm dev 在跑
2. **并行 feature 开发**：在同一个项目中，让 AI 同时处理 login-fix 和 signup 两个功能
3. **异步 review**：AI 完成任务后通知开发者，开发者可以稍后 review

## 功能需求

### P0: 核心功能

#### 1. Project 管理
- [ ] 添加本地 git repo 作为 project
- [ ] Project 列表展示（左侧边栏）
- [ ] 切换当前激活的 project
- [ ] Project 状态指示（有活跃进程/空闲）

#### 2. Feature 系统
- [ ] 在 project 下创建 feature（自定义任务单元）
- [ ] Feature 标签页切换
- [ ] Feature 状态：pending / running / completed / needs-review
- [ ] 可选绑定 git branch（创建时选择或后续绑定）

#### 3. PTY 面板系统
- [ ] xterm.js 终端渲染
- [ ] Rust 端 PTY 管理（portable-pty）
- [ ] 面板分割（水平/垂直）
- [ ] 面板大小调整（拖拽）
- [ ] 面板关闭/新建

#### 4. 共享面板
- [ ] 标记面板为「共享」
- [ ] 共享面板固定在左侧区域
- [ ] 共享面板跨 feature 可见
- [ ] 共享面板状态独立于 feature

#### 5. 通知系统
- [ ] 监听 claude Stop hook
- [ ] 发送 tray 通知
- [ ] Tray 菜单列出待 review 的 feature
- [ ] 点击菜单项定位到对应 project/feature/面板

#### 6. 持久化
- [ ] Project 列表持久化
- [ ] Feature 状态持久化
- [ ] 面板布局持久化
- [ ] 进程信息持久化（重启后提示恢复）

### P1: 增强功能

- [ ] Feature 绑定到 chat session（查看历史对话）
- [ ] 并行修改同文件警告
- [ ] 面板搜索（在终端输出中搜索）
- [ ] 面板滚动锁定
- [ ] 快捷键支持（Ctrl+Shift+T 新建面板等）

### P2: 未来迭代

- [ ] 面板录制/回放
- [ ] Feature 模板
- [ ] 团队协作（共享 workspace）

## 技术设计

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        React Layer                           │
├─────────────────────────────────────────────────────────────┤
│  WorkspaceView                                               │
│  ├── ProjectSidebar        (project 列表)                    │
│  ├── FeatureTabs           (feature 标签)                    │
│  └── PanelGrid             (面板网格)                        │
│      ├── SharedPanelZone   (共享面板区)                      │
│      └── FeaturePanelZone  (feature 面板区)                  │
│          └── TerminalPane  (xterm.js 封装)                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Tauri IPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Rust Layer                            │
├─────────────────────────────────────────────────────────────┤
│  Commands                                                    │
│  ├── workspace_commands.rs  (project/feature CRUD)           │
│  ├── pty_commands.rs        (PTY 创建/写入/resize)           │
│  └── notify_commands.rs     (tray 通知)                      │
│                                                              │
│  Services                                                    │
│  ├── pty_manager.rs         (PTY 进程池管理)                 │
│  ├── workspace_store.rs     (持久化存储)                     │
│  └── hook_watcher.rs        (Stop hook 文件监听)             │
└─────────────────────────────────────────────────────────────┘
```

### 数据模型

```typescript
interface Project {
  id: string;
  name: string;
  path: string;           // git repo 路径
  createdAt: number;
  features: Feature[];
  sharedPanels: Panel[];  // 共享面板
}

interface Feature {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'needs-review';
  gitBranch?: string;     // 可选绑定
  chatSessionId?: string; // 未来绑定到 chat
  panels: Panel[];
  layout: PanelLayout;
  createdAt: number;
}

interface Panel {
  id: string;
  ptyId: string;          // Rust 端 PTY ID
  title: string;
  isShared: boolean;
  command?: string;       // 启动命令（用于恢复）
}

interface PanelLayout {
  type: 'horizontal' | 'vertical';
  sizes: number[];        // 百分比
  children: (PanelLayout | string)[]; // 嵌套布局或 panel id
}
```

### 关键依赖

**Frontend:**
- `@xterm/xterm` - 终端渲染
- `@xterm/addon-fit` - 自适应大小
- `@xterm/addon-web-links` - 链接点击
- `react-resizable-panels` - 面板分割

**Rust:**
- `portable-pty` - 跨平台 PTY
- `notify` - 文件监听（hook 触发）
- `tauri::tray` - 系统托盘

### IPC 接口

```rust
// Project 管理
#[tauri::command]
fn add_project(path: String) -> Result<Project, String>;

#[tauri::command]
fn list_projects() -> Vec<Project>;

#[tauri::command]
fn remove_project(id: String) -> Result<(), String>;

// Feature 管理
#[tauri::command]
fn create_feature(project_id: String, name: String) -> Result<Feature, String>;

#[tauri::command]
fn update_feature_status(id: String, status: String) -> Result<(), String>;

// PTY 管理
#[tauri::command]
fn create_pty(project_id: String, cwd: String) -> Result<String, String>; // 返回 pty_id

#[tauri::command]
fn write_pty(pty_id: String, data: Vec<u8>) -> Result<(), String>;

#[tauri::command]
fn resize_pty(pty_id: String, cols: u16, rows: u16) -> Result<(), String>;

#[tauri::command]
fn kill_pty(pty_id: String) -> Result<(), String>;

// 通知
#[tauri::command]
fn get_pending_reviews() -> Vec<PendingReview>;

#[tauri::command]
fn focus_feature(project_id: String, feature_id: String);
```

### UI 布局

```
┌─────────────────────────────────────────────────────────────┐
│ Workspace                                            [+ New] │
├──────────────┬──────────────────────────────────────────────┤
│              │ [login-fix ▸] [signup] [api-refactor] [+]    │
│  Projects    ├──────────────────────────────────────────────┤
│              │                                              │
│  ▶ proj-A ◉  │  ┌────────────┬─────────────────────────┐   │
│    proj-B    │  │  SHARED    │  login-fix panels       │   │
│    proj-C    │  │            │  ┌─────────┬─────────┐  │   │
│              │  │ ┌────────┐ │  │ PTY 1   │ PTY 2   │  │   │
│              │  │ │$ pnpm  │ │  │         │ claude  │  │   │
│              │  │ │  dev   │ │  │         │ ...     │  │   │
│              │  │ │        │ │  │         │         │  │   │
│              │  │ └────────┘ │  └─────────┴─────────┘  │   │
│              │  │            │                         │   │
│  [+ Project] │  └────────────┴─────────────────────────┘   │
└──────────────┴──────────────────────────────────────────────┘
```

## 成功指标

1. 用户可以在 < 5 秒内添加一个新 project
2. 创建 feature 并启动 AI < 3 秒
3. AI 完成后通知延迟 < 1 秒
4. 面板渲染性能与原生终端无明显差异
5. 重启 app 后 < 2 秒恢复 workspace 状态

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| PTY 跨平台兼容性 | 中 | 高 | 使用 portable-pty，优先支持 macOS |
| xterm.js 性能问题 | 低 | 中 | 限制终端 buffer 大小，支持清屏 |
| 多 PTY 内存占用 | 中 | 中 | 限制最大 PTY 数量，空闲超时关闭 |
| Hook 监听可靠性 | 低 | 高 | 结合进程退出事件双重检测 |

## 里程碑

1. **M1: PTY 基础** - xterm.js 渲染 + 单个 PTY 通信
2. **M2: 面板系统** - 分割/调整/共享面板
3. **M3: Project & Feature** - 完整的项目和功能管理
4. **M4: 通知系统** - Hook 监听 + Tray 通知
5. **M5: 持久化** - 完整状态保存和恢复
