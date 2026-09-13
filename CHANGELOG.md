# 变更记录

本项目的所有重要变更都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [未发布]

### 新增
- 项目脚手架：Electron 44 + electron-vite 5 + React 19 + TypeScript 7 + Tailwind CSS 4
- 全屏英雄区（Fullscreen Hero）风格的设计系统：暗底、玻璃卡片、胶囊控件，含动效降级
- 共享类型与 IPC 契约（`src/shared/types.ts`、`src/shared/ipc.ts`）
- 带考试日期的复习调度器 `src/main/review.ts`，含 16 项单元测试
- 杂项设置存储 `src/main/settings.ts`（考试日期、热键）

### 决策
- **选 Electron 而非 Tauri**：已有跑通的 Electron 构建经验，踩过的坑均有解；Tauri 的体积/内存优势对本项目不构成决策因素
- **SQLite 用 Electron 内置的 `node:sqlite`**：实测可用，换来零原生依赖，免掉 better-sqlite3 的 ABI 重编译
- **存储采用「文件为真相源 + SQLite 为派生索引」**：数据永远可由 Markdown 重建
- **不提供「押题」功能**：改写为「高频考点排行」，依据错题分布排优先级

[未发布]: https://github.com/Liangbiaoyong/MistakeBook/commits/main
