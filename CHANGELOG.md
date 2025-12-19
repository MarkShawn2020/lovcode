# Changelog

## 0.7.0

### Minor Changes

- ### Features

  - feat(distill): 添加目录监听自动刷新与 UI 优化
  - feat(chats): 实现虚拟无限滚动加载
  - feat(distill): 支持从 distill 跳转到 session

  ### Performance

  - perf: 优化 History 页面性能，避免 IO 阻塞 UI

  ### Fixes

  - fix(export): 修复导出对话框按钮被隐藏的问题
  - fix(distill): 修复打开文件路径解析错误

  ### Style

  - style(sidebar): 优化 Knowledge 子菜单选中状态的视觉层次
  - style(theme): 集成 Lovstudio 暖学术设计系统

  ### Refactor

  - refactor(session): 使用下拉菜单优化 SessionDetail 工具栏

## 0.6.2

### Patch Changes

- fix(search): 修复中文搜索无法匹配的问题

  - 实现 JiebaTokenizer 自定义分词器支持中文分词
  - 为 content 和 session_summary 字段配置 jieba 分词器

## 0.6.1

### Patch Changes

- fix: add Cargo.toml version sync for correct binary versioning

## 0.6.0

### Minor Changes

- 新增 Sessions 和 Chats tab 及全文搜索功能

  - History 页面支持三种视图切换：Projects（按项目分组）、Sessions（扁平列表）、Chats（所有消息）
  - 集成 Tantivy 搜索引擎，支持消息内容实时搜索
  - 各 tab 独立懒加载，切换时保持缓存
  - Chats 显示已加载/总计消息数

## 0.5.2

### Patch Changes

- 8103989: fix: sync Tauri version from package.json to ensure consistent artifact naming

## 0.5.1

### Patch Changes

- 85d0e82: fix: update submodule reference to valid commit

## 0.5.0

### Minor Changes

- d85a5a3: 新增 Commands 使用统计功能：从 session 历史中提取 slash command 调用次数，支持按使用量/名称排序

## [0.4.0] - 2025-12-17

- 新增会话原文件快速打开功能（Reveal in Finder）
- 新增 Clean 模式过滤中间过程消息
- 优化选择模式，支持快速选择全部/仅用户消息
- 导出支持精简 Bullet 格式
- 新增水印选项

## [0.3.5] - 2025-12-17

- 修复 MCP 配置文件路径（现正确使用 ~/.claude.json）
- MCP 页面新增快速打开配置文件按钮

## [0.3.4] - 2025-12-17

- 修复打包后 Marketplace 模板无法加载的问题

## [0.3.3] - 2025-12-16

- 优化首页标语文案

## [0.3.2] - 2025-12-16

- 调整开发环境配置

## [0.3.1] - 2025-12-16

- 修复顶栏拖拽移动窗口功能

## [0.3.0] - 2025-12-15

- 新增会话多选导出功能
- 支持导出为 Markdown 格式，含目录和元信息
- 支持项目级别批量导出多个会话

## [0.2.0] - 2025-12-10

- 新增用户头像和个人资料设置
- 支持本地上传头像图片
- 个人资料自动保存
