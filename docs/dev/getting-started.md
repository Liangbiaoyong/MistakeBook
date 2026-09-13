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
热键 → 框选截图（capture/）
     → 后台识别（llm/，不阻塞界面）
     → 右下角浮层 + 桌面通知窗显示进度与倒计时
     → 30 秒无操作即自动保存；也可点「编辑」进 Composer 改
     → 写入 Markdown + 图片（store/vault.ts）→ 更新 SQLite 索引（store/index-db.ts）
     → 列表 / 详情 / 复习 / 统计（renderer）
```

**流水线跑在渲染进程**（`App.tsx` 持有任务状态），所以主窗口**收进托盘时它仍在跑**：

- ⚠ 主窗口关掉了 `backgroundThrottling` —— 隐藏窗口默认会被节流（定时器降到约每分钟一次），
  不关掉的话 30 秒自动保存倒计时会直接卡住。
- 桌面通知窗（`main/notify-window.ts`）是**独立窗口**，只要应用还活着（托盘常驻）就能显示，
  不需要打开主界面。它 `focusable: false`，不会抢走你正在用的窗口的焦点。

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
按顺序排查：
1. 跑 `npx electron . --selftest`，看 `框选界面` 那行 —— 若显示「缺失」，说明构建没带上 `overlay.html`，重新 `npm run build`。
2. 热键被别的程序占了。注册失败时**会弹窗告诉你**，不会静默；到「设置 → 学习计划」换个组合，保存时会立刻重新注册。
3. 忘了它常驻在托盘里 —— 托盘菜单里有「截图录入」，单击托盘图标可唤出主窗口。
4. **看日志**：`%APPDATA%\MistakeBook\mistakebook.log`（超过 1MB 自动轮转为 `.log.1`）。
   打包版没有控制台，这里就是唯一的现场记录。每条早期返回路径都会写明原因
   （屏幕源没找到 / 用户取消 / 选区过小 / 裁剪失败）。

**框选的操作方式**：拖动框住区域 → **松开鼠标即提交**（也可以按回车）。Esc 或右键取消。
选区太小时不会提交也不会关闭，可以重拖。

**按了热键，框选界面出来了但看不到背景图**
截图落在 `userData/tmp/`，overlay 用 `file://` 读它，读完即删。若背景是空的，多半是 `desktopCapturer` 没拿到屏幕源（多显示器或权限问题）——日志里会写明实际截到的尺寸与匹配到的源。

**提示"当前选中的模型不支持读图"**
「采集识别」必须选一个支持视觉的模型（`ModelChoice.vision === true`）。默认的 `deepseek-flash` 支持。

**识别不准，尤其是手写**
预期之内。缓解手段有三层：模型会自评 `confidence`，低于 0.75 时录入窗会**强制提示你核对**；表单全程可改；原图永久保留。

**公式没渲染出来**
`renderMarkdown` 对解析失败的 TeX 会降级成 `<code>` 而不抛错。检查 `$...$` 是否配对。

**页面图表空白**
ECharts 实例在卸载时销毁；若从别处切回来仍空白，多半是容器高度为 0 —— 图表容器必须有显式高度。

## 自检

配置完之后，用一行命令就能确认整条链路通不通（不开窗口，退出码即结论）：

```bash
npx electron . --selftest                  # 查配置 + 文本连通性
npx electron . --selftest <图片路径>        # 再跑一次真实视觉识别
```

输出形如：

```
── MistakeBook 自检 ──
仓库目录 : D:\...\Documents\MistakeBook
识别模型 : opencode-go / claude-sonnet-4-6
协议格式 : anthropic   端点: http://127.0.0.1:15721
API Key  : 已配置
文本连通 : OK (1645ms) → 连通
视觉识别 : OK (10356ms) → {"firstLine":"第1章 绪 论"}
```

退出码：`0` 全通 / `2` 未配 Key / `3` 文本失败 / `4` 视觉失败。
「为什么识别不工作」这类问题，先跑它，别猜。

## 新增一个模型 Provider

设置页可以填 id / 名称 / baseUrl / **协议格式** / **附加请求头**。

- 协议格式 `openai`：聊天走 `baseUrl/chat/completions`
- 协议格式 `anthropic`：聊天走 `baseUrl/v1/messages`，并自动带 `anthropic-version`

`baseUrl` 怎么填取决于对方把端点挂在哪 —— 有的带 `/v1`，有的不带。
附加请求头一行一条 `Key: Value`（例如 OpenCode Go 需要的 `x-opencode-session`）。

「拉取模型」按钮会请求模型列表端点；对方不提供时（返回空或报错）会提示你手动填模型名，
这属于正常情况，不是故障。

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
