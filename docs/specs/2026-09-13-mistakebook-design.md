# MistakeBook · 设计文档

> 2026-09-13 · 状态：已定稿并进入实现

## 1. 定位

一个 **Windows 桌面 AI 错题本**。核心闭环：

```
全局热键框选截图 → 视觉大模型理解 → 结构化 Markdown 落盘
        → 派生的 SQLite 索引 → 复习队列 / 统计 / 错因分析 / 变式出题 / 考点排行
```

**为谁做**：一个人，2027 考研（2026-12 初试），科目 22408 = 政治 + 英语二 + 数学二 + 408。
**成功标准**：他每天真的会按热键截图录入，并且考前能用它做定向复习。

## 2. 非目标（YAGNI）

- ❌ 不做多用户 / 云同步 / 账号体系
- ❌ 不做 Anki 式完整 SRS 生态（只做够用的到期队列）
- ❌ 不做"押题"——**自称能预测原题是不诚实的**。只做「高频考点排行」：由错题分布 × 考纲/真题权重算出的、对你最值钱的考点清单
- ❌ 不做 PDF 标注挖掘（曾评估过：408 王道书是无文字层扫描件、标注是含歧义的手写笔迹，收益不稳，已搁置）

## 3. 技术选型（及理由）

| 决策 | 选择 | 理由 |
|---|---|---|
| 桌面外壳 | **Electron 44** | 用户已有跑通的 Electron 构建经验（KaoyanFocusCompanion），踩过的坑都有解（npmmirror 装二进制、`--no-asar`、透明窗口逐个进程）。Tauri 体积/内存更优，但对本项目不构成决策因素，且会把热键/截图/文件监听推进 Rust，抬高用户后续自维护的门槛 |
| 构建 | **electron-vite 5** + Vite 7 | main/preload/renderer 三端一套配置 |
| UI | **React 19 + TypeScript 7 + Tailwind 4** | |
| SQLite | **`node:sqlite`（Electron 44 内置）** | 实测可用。**零原生依赖**，免掉 better-sqlite3 的 ABI 重编译 |
| LaTeX | **KaTeX** | 轻、快，考研数学覆盖足够 |
| 图表 | **ECharts** | 中文标签友好，暗色主题易定制 |
| 校验 | **Zod** | 校验大模型返回的 JSON，挡住幻觉字段 |
| 截图 | **Electron 内置**（`desktopCapturer` + 全屏透明窗 + `nativeImage.crop`） | 零原生依赖 |
| 全局热键 | `globalShortcut` | |

**视觉模型**：`deepseek-flash`（2026-09 官方文档实测**支持图片输入**，1M 上下文）。⚠ 其单图 token 上限约 1024，大图会被缩到约 1300×1300 → **框选截图必须裁紧**。
仍保留「按功能指定 provider/model」的配置层，便于换 Qwen-VL / GLM-4V。

## 4. 架构

```
┌──────────────────────── Electron 主进程 ────────────────────────┐
│  hotkey.ts     全局热键 (globalShortcut)                        │
│  capture/      框选截图（overlay 窗 + desktopCapturer + crop）    │
│  llm/          OpenAI 兼容客户端；按功能位取模型；Zod 校验输出      │
│  store/        vault 读写（frontmatter+MD+图片）、index（SQLite）  │
│  features/     错因分析 / 变式出题 / 考点排行（提示词 + 编排）      │
│  config.ts     模型与 provider 配置；API key 走 safeStorage       │
└──────────────────────────────┬─────────────────────────────────┘
                               │ IPC（契约见 src/shared/ipc.ts）
┌──────────────────────────────┴─────────────────────────────────┐
│  渲染进程 (React)                                                │
│   书库(列表/筛选) · 详情(KaTeX 渲染) · 复习队列 · 统计            │
│   分析 · 考点排行 · 设置(全局模型 + 分功能覆盖 + key + vault)      │
└─────────────────────────────────────────────────────────────────┘
```

**两条数据道**：
- **真相源 = Markdown 文件**（可 git、可手改、任何编辑器能读）
- **索引 = SQLite**，位于 `userData/index.db`，**随时可从文件重建**
  - ⚠ 唯一的例外是**复习历史**：Markdown 只留得下「上次复习」与「轮次」，中间过程重建不出来。
    因此每次评分追加一行到 vault 根的 `reviews.jsonl`（用户数据，不是索引），重建索引时由它回填。
  - 同理，**合并掉的重复记录**只留下 `merged_from` 里的 id 列表 —— 记录能合，历史不能凭空造。

## 5. 数据模型

### 5.1 vault 布局

```
<vault>/                              # 默认 <Documents>/MistakeBook
├── mistakes/<科目>/<章节>/<id>.md
├── assets/<id>.png                   # 原始截图，只增不改（不可变证据）
└── reviews.jsonl                     # 复习事件，一行一次评分（追加写）
```

### 5.2 frontmatter

```yaml
id: 2026-09-13-a3f29c
created: 2026-09-13T14:23:21+08:00
source: 王道《数据结构》p.42 第08题
subject: 408
chapter: [数据结构, 树]
points: [树的度, 叶结点数]
type: 单选
level: 3
my_answer: C
right_answer: B
error_type: 概念混淆
status: new
confidence: 0.9
review: { last: null, next: 2026-09-15, round: 1 }
llm: { model: deepseek-flash, at: 2026-09-13T14:23:30+08:00 }
image: assets/2026-09-13-a3f29c.png
merged_from: [2026-09-11-b71e04]       # 可选：被合并进来的重复记录 id
```

**`status` 是派生值，不是可随手改的标记**：`deriveStatus(grade, round)` ——
顺利复习到第 4 轮才 `mastered`；答「忘了 / 困难」一律退回 `reviewing`（轮次本身也已回退）。
不这样绑的话，它就会退化成一个只增不减的虚荣数字。

### 5.3 正文小节（固定顺序，缺则略）

`## 题目` / `## 我的思路` / `## 正确解法` / `## 错因` / `## 变式` —— 均允许 LaTeX。

### 5.4 两条硬规则

1. **`confidence` 低 → 强制人工确认**。这是对冲"手写识别不准"的关键设计，不可省。
2. **`error_type` 走受控词表**（7 项，见 `src/shared/types.ts`），禁止模型自由发挥。

## 6. 分期

- **M1 能录能看**：截图 → 提取 → 确认 → 落盘 → 列表 → 详情(KaTeX)
- **M2 会复习**：到期队列 + 评分 + 复习状态回写
- **M3 会分析**：统计图表、错因归纳、考点排行、变式出题
- **M4 打磨**：审美统一、快捷键、托盘、打包、文档

## 7. 审美规范

基调源自 **Fullscreen Hero（全屏英雄区）** 风格包：暗色底、白字、玻璃卡片、胶囊按钮。

**风格包硬约束**（禁止漂移）：
- 禁 `shadow-sm/md/lg/xl`、`bg-gray-50`、`text-gray-900`、`border-gray-200`
- 卡片必须 `bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20`
- 按钮必须 `rounded-full`，且含 `active:scale-[0.98]`
- 交互统一 `200ms ease-out`，全部提供 `prefers-reduced-motion` 降级
- 正文对比度 ≥ WCAG AA

**必要的适配**（错题本是数据密集型应用，不是落地页）：
Hero 风格只适用于**首屏/欢迎页与空状态**。书库、详情、统计等密集页面沿用其**色彩与材质语言**（黑底、玻璃卡片、胶囊控件、白色高对比文字），但间距与字号改用紧凑刻度（`p-5`、`text-sm/base`），以保证一屏信息量。**这不算风格漂移——它保留了色板、材质与交互规则，只换了密度。**

## 8. 错误处理

- LLM 返回非法 JSON → Zod 校验失败 → 保留原始返回，提示重试，**不写坏文件**
- API 失败/超时 → 明确报错，不静默；录入窗内容不丢
- 索引损坏 → 一键从 MD 重建
- 写文件原子化：先写临时文件再 rename，避免半截文件

## 9. 测试

- 纯逻辑（调度、frontmatter 序列化往返、Markdown 渲染、Zod schema）用 **vitest** 单测
- 手动验收：截图 → 落盘 → 重启后仍在 → 索引可重建

## 10. 已知风险

1. **手写识别准确率**——缓解：低 confidence 强制确认 + 允许手改 + 原图永久保留（可换模型重识别）
2. **单图 1024 token 上限**——缓解：框选裁紧
3. **DeepSeek 视觉能力未亲测**——首次运行需真机验证；配置层可秒换模型
