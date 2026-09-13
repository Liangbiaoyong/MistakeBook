# 开发与使用说明

## 环境要求

| 项 | 版本 |
|---|---|
| Node.js | ≥ 20（开发机实测 24.11） |
| npm | ≥ 10 |
| 操作系统 | Windows 10/11（截图与全局热键部分依赖 Windows API） |

无需安装任何原生构建工具 —— SQLite 使用 Electron 内置的 `node:sqlite`，全项目**零原生依赖**。

## 起步

```bash
npm install
npm run dev
```

首次安装若 Electron 二进制下载缓慢，可指定镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm install --registry=https://registry.npmmirror.com
```

## 首次运行要做的三件事

1. **填 API Key** —— 设置 → Provider 与密钥。默认走 DeepSeek；Key 用系统凭据库加密后存进 `userData/keys.bin`，**不会写进 `config.json`，更不会进 git**。
2. **设考试日期** —— 设置 → 学习计划。**不填的话，复习排程会退化成普通的间隔重复**，失去「考前冲刺」这一层设计。
3. （可选）**改错题库目录** —— 默认在 `<文档>/MistakeBook`。

按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> 即可框选一道题开始录入。

## 数据流

```
热键 → 框选（capture/）→ 视觉模型识别（llm/）→ 人工确认（Composer.tsx）
     → 写入 Markdown + 图片（store/vault.ts）→ 更新 SQLite 索引（store/index-db.ts）
     → 列表 / 详情 / 复习 / 统计（renderer）
```

**两条铁律**：

- **文件是唯一真相源**。索引随时可以从 Markdown 全量重建（设置 → 重建索引，或删掉 `userData/index.db` 重启）。索引坏了不是事故。
- **截图是不可变证据**。模型认错了就改 Markdown 正文，原图永远留着 —— 将来换更好的模型可以重新识别。

## 目录导览

```
src/
  shared/       两侧共用的类型与 IPC 契约（改这里等于改接口）
  main/
    capture/    全局热键 + 全屏框选 overlay + 裁剪
    llm/        OpenAI 兼容客户端、提示词、Zod schema
    store/      paths / frontmatter / vault / index-db
    features/   错因分析、变式出题、考点排行
    config.ts   模型配置（多 provider + 按功能覆盖）
    settings.ts 考试日期、热键
    review.ts   带考试日期的复习调度（纯函数，有单测）
  preload/      contextBridge 暴露 window.api
  renderer/     React 界面
tests/          单元测试
```

## 常见问题

**截图没反应**
热键被别的程序占了。设置 → 学习计划换个组合，保存时会立刻重新注册；注册失败会**如实报错**（不会静默失效）。

**提示"当前选中的模型不支持读图"**
「采集识别」必须选一个支持视觉的模型（`ModelChoice.vision === true`）。默认的 `deepseek-flash` 支持。

**识别不准，尤其是手写**
预期之内。缓解手段有三层：模型会自评 `confidence`，低于 0.75 时录入窗会**强制提示你核对**；表单全程可改；原图永久保留。

**公式没渲染出来**
`renderMarkdown` 对解析失败的 TeX 会降级成 `<code>` 而不抛错。检查 `$...$` 是否配对。

**页面图表空白**
ECharts 实例在卸载时销毁；若从别处切回来仍空白，多半是容器高度为 0 —— 图表容器必须有显式高度。

## 新增一个模型 Provider

设置页已支持填 id / 名称 / base URL。只要对方是 **OpenAI 兼容**的 `/chat/completions`，就能直接用。

## 校验与测试

```bash
npm run typecheck   # 必须 0 错误
npm test            # 单元测试
npm run build       # 三端编译
npm run dist        # 打 Windows 安装包（输出到 release/）
```

## 已知限制

1. 截图 v1 **只支持光标所在的那块显示器**，多屏未跨屏拼接。
2. 视觉模型单图 token 上限约 1024，**截图务必裁紧**（只截一道题）。
3. DeepSeek 视觉能力尚未在真实 Key 上端到端验证过 —— 配置层可随时换 Qwen-VL / GLM-4V。
