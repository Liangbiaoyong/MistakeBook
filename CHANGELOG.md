# 变更记录

本项目的所有重要变更都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [未发布]

### 修复
- **假的原子写入**：原先写完 `.tmp` 立刻 `unlink`，再直接覆盖目标文件。改为真正的 `rename`，并确保目录存在
- **更新错题会重置复习进度**：保存时会无条件写回 `status: 'new'` 与 `review.round: 1`，等于每次评分都被抹掉（复习功能会完全失效）。改为按补丁合并，未提及的字段一律保留
- **id 碰撞会覆盖错题**：4 位 hex 只有 65536 种，2000 条必然碰撞。改为 6 位并加查重（`pickUniqueId`），把"查重"做成可确定性测试的纯函数
- **硬编码模型名**：vault 里写死了 `deepseek-flash`，用户换模型后会记录假数据。改为传入真实识别的模型名
- **两套冲突的复习间隔表**：vault 里另有一套 `1,3,7,14,30`，与 `review.ts` 的 `1,2,4,7,15,30` 不一致。统一收敛到 `review.ts`
- **`capture:start` 被注册两次**，异常中断了后续**所有** IPC 注册，应用变成空壳。已去除重复，并让 `handle()` 先 `removeHandler` 做幂等保护
- **索引其实在内存里**：`openIndex()` 用的是 `DatabaseSync(':memory:')`，与设计的「索引落盘到 `userData/index.db`」不符。改为文件索引
- **手搓的 YAML 解析器**：`frontmatter.ts` 自己解析而非用已装的 `gray-matter`，导致空数组变成 `['']`、数字被强转。改为 `gray-matter` 并补齐类型收窄
- **复习页拿不到题干和答案**：队列只有轻量摘要，页面却显示被截断的 `questionHead`。改为按 id 拉取完整记录并缓存
- **Tailwind v4 不允许 `@apply` 自定义类**：`.cu-btn-primary` 里的 `@apply cu-btn` 会让渲染层构建立即失败。改用共享选择器

### 新增
- 项目脚手架：Electron 44 + electron-vite 5 + React 19 + TypeScript 7 + Tailwind CSS 4
- 全屏英雄区（Fullscreen Hero）风格的设计系统：暗底、玻璃卡片、胶囊控件，含动效降级
- 共享类型与 IPC 契约（`src/shared/types.ts`、`src/shared/ipc.ts`）
- 带考试日期的复习调度器 `src/main/review.ts`，含 16 项单元测试
- 杂项设置存储 `src/main/settings.ts`（考试日期、热键），设置页可改；改热键会立刻重新注册
- frontmatter 往返测试（覆盖 YAML 特殊字符、日期、空数组等易错场景）

### 决策
- **选 Electron 而非 Tauri**：已有跑通的 Electron 构建经验，踩过的坑均有解；Tauri 的体积/内存优势对本项目不构成决策因素
- **SQLite 用 Electron 内置的 `node:sqlite`**：实测可用，换来零原生依赖，免掉 better-sqlite3 的 ABI 重编译
- **存储采用「文件为真相源 + SQLite 为派生索引」**：数据永远可由 Markdown 重建
- **不提供「押题」功能**：改写为「高频考点排行」，依据错题分布排优先级

[未发布]: https://github.com/Liangbiaoyong/MistakeBook/commits/main
