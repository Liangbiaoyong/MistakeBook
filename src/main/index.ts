import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, protocol, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { IPC } from '@shared/ipc'
import type { CapturePayload } from '@shared/ipc'
import type {
  AppSettings,
  Extraction,
  FeatureKey,
  Grade,
  ListFilter,
  Mistake,
  MistakeInput,
  ModelChoice,
  ProviderConfig,
  Result
} from '@shared/types'

import { ensureDirs, getVaultDir, setVaultDir, assetsDir, getTempDir } from './store/paths'
import {
  saveMistake,
  readMistake,
  listMistakes,
  updateMistake,
  deleteMistake,
  rebuildIndex
} from './store/vault'
import { openIndex, initSchema, statsOverview, countRows } from './store/index-db'
import {
  getPublicConfig,
  getProviderById,
  getProviderKey,
  setChoice,
  setProviderKey,
  removeProviderKey,
  upsertProvider,
  getFeatureModel
} from './config'
import { startCapture, overlayHtmlPath } from './capture/capture'
import { registerHotkey, unregisterHotkeys } from './capture/hotkey'
import { chatText, chatVisionJSON, listModels } from './llm/client'
import { z } from 'zod'
import { ExtractionSchema } from './llm/schema'
import { CAPTURE_SYSTEM } from './llm/prompts'
import { analyzeErrorPatterns } from './features/analyze'
import { generateVariants } from './features/generate'
import { forecastTopics } from './features/forecast'
import { nextReview, isDue } from './review'
import { getSettings, updateSettings } from './settings'
import { logLine } from './log'

const ASSET_SCHEME = 'cuoti-asset'

/**
 * 资源文件的真实路径。
 *
 * ⚠ 图标不能用 `?asset` 引入：electron-vite 只会把它解析成相对路径
 * `../../resources/icon.png`，开发模式下这个位置确实存在，但**打包后它在 app.asar 里并不存在**。
 * 而 `nativeImage.createFromPath()` 找不到文件时不会报错，只是返回一张空图 ——
 * 表现就是「任务栏 / 托盘图标是透明的」。打包版必须走 process.resourcesPath。
 * （配合 electron-builder.yml 的 extraResources 把 resources/ 拷进去。）
 */
function resourcePath(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '../../resources', name)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let lastCapture: CapturePayload | null = null
/** 只有当真的在退出时才放行窗口关闭，否则关窗口只是收进托盘 */
let quitting = false

/* ────────────── 通知 ────────────── */

/** 向渲染进程推送用户可见的提示 */
function notify(msg: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.appNotify, msg)
  }
}

/* ────────────── IPC 包装 ────────────── */

function toMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  if (name === 'MissingKeyError') return '还没有配置该模型的 API Key，请到「设置」里填写。'
  if (name === 'VisionUnsupportedError') {
    return '当前选中的模型不支持读图，请到「设置 → 采集识别」换一个支持视觉的模型。'
  }
  return e instanceof Error ? e.message : String(e)
}

/** 把任意处理函数包成永不 reject 的 Result，渲染层只看 ok */
function handle<TArgs extends unknown[], TOut>(
  channel: string,
  fn: (...args: TArgs) => Promise<TOut> | TOut
): void {
  // 先摘掉可能存在的同名 handler：重复注册会直接抛异常，
  // 而那个异常会中断后续所有 handler 的注册，让整个应用变成空壳。
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (_e, ...args): Promise<Result<TOut>> => {
    try {
      return { ok: true, data: await fn(...(args as TArgs)) }
    } catch (e) {
      const error = toMessage(e)
      console.error(`[ipc:${channel}]`, error)
      logLine('ipc', `[${channel}] ${error}`)
      return { ok: false, error }
    }
  })
}

/* ────────────── 资源协议：<img src="cuoti-asset://local/assets/x.png"> ────────────── */

function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (req) => {
    const url = new URL(req.url)
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, '')).replace(/^assets\//, '')
    const root = path.resolve(assetsDir())
    const abs = path.resolve(root, rel)
    // 防目录穿越：解析后必须仍在 assets 目录内
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return new Response('forbidden', { status: 403 })
    }
    try {
      const data = await fs.promises.readFile(abs)
      return new Response(new Uint8Array(data), {
        headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

/* ────────────── 窗口 ────────────── */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: '错题本',
    icon: nativeImage.createFromPath(resourcePath('icon.png')),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 关窗口 = 收进托盘，不退出。常驻是这软件的常态（要随时按热键）。
  mainWindow.on('close', (e) => {
    if (!quitting && tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadURL(pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString())
  }
}

/* ────────────── 托盘 ────────────── */

function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
  tray.setToolTip(`错题本 · 按 ${getSettings().hotkey} 截图录入`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '截图录入', click: () => void doCapture() },
      { label: '打开主窗口', click: () => showMain() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  // 单击托盘图标唤出主窗口（Windows 上这是用户的直觉）
  tray.on('click', () => showMain())
}

/* ────────────── 采集 ────────────── */

async function doCapture(): Promise<CapturePayload | null> {
  logLine('hotkey', '触发截图')
  const payload = await startCapture()
  if (!payload) {
    logLine('hotkey', '截图返回 null')
    return null
  }
  logLine('hotkey', `截图成功: ${payload.imageAbsPath}`)
  lastCapture = payload
  if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
  mainWindow?.webContents.send(IPC.captureCaptured, payload)
  return payload
}

function setupHotkey(): void {
  const accel = getSettings().hotkey
  if (registerHotkey(accel, () => void doCapture())) {
    logLine('hotkey', `已注册 ${accel}`)
    return
  }

  logLine('hotkey', `注册失败：${accel}（可能被占用）`)
  console.warn(`[hotkey] 注册失败：${accel}（可能被占用）`)
  // 静默失败是最难受的失败：用户按了没反应，完全不知道为什么。明确告诉他。
  void dialog.showMessageBox({
    type: 'warning',
    title: '全局热键没能注册',
    message: `热键 ${accel} 注册失败，通常是已被其他程序占用。`,
    detail: '你仍然可以用托盘菜单里的「截图录入」，或到「设置 → 学习计划」换一个组合。',
    buttons: ['知道了']
  })
}

/* ────────────── 连通性自检（设置页的「测试」按钮） ────────────── */

async function testChoice(choice: ModelChoice): Promise<{ latencyMs: number; echo: string }> {
  const started = Date.now()
  // 走正常的调用路径，这样测的就是真实的协议格式、请求头与端点拼接
  const echo = await chatText({
    choice,
    user: '只回复两个字：连通',
    maxTokens: 32,
    temperature: 0
  })
  return { latencyMs: Date.now() - started, echo: echo.trim().slice(0, 40) }
}

/* ────────────── IPC 注册 ────────────── */

function registerHandlers(): void {
  // 注意：capture:start 由这里注册，而不是调用采集模块的 registerIpcHandlers()。
  // 截图完成后必须把 payload 推给渲染层去弹录入窗，这条事件流只能有一个主人。
  handle(IPC.captureStart, async (): Promise<null> => {
    try {
      await doCapture()
      return null
    } catch (err) {
      logLine('ipc', `capture:start 失败: ${err instanceof Error ? err.message : String(err)}`)
      notify('截图失败，请重试')
      return null
    }
  })

  handle(IPC.extract, async (absPath: string | null): Promise<Extraction> => {
    const target = absPath ?? lastCapture?.imageAbsPath
    if (!target) throw new Error('没有可识别的图片，请先按热键截图。')
    return chatVisionJSON<Extraction>({
      system: CAPTURE_SYSTEM,
      user: '请识别这道题，按约定输出 JSON。',
      imageAbsPath: target,
      schema: ExtractionSchema
    })
  })

  handle(IPC.mistakeSave, async (input: MistakeInput) => {
    const { id } = await saveMistake(
      { ...input, imageAbsPath: input.imageAbsPath ?? lastCapture?.imageAbsPath },
      undefined,
      // 记录真正做识别的模型，而不是硬编码一个名字
      getFeatureModel('capture').model
    )
    return { id }
  })

  handle(IPC.mistakeList, async (filter: ListFilter | undefined) => listMistakes(filter ?? {}))

  handle(IPC.mistakeGet, async (id: string): Promise<Mistake> => {
    const m = await readMistake(id)
    if (!m) throw new Error(`找不到错题 ${id}`)
    return m
  })

  handle(IPC.mistakeUpdate, async (id: string, patch: Partial<Mistake>) => {
    await updateMistake(id, patch)
    return null
  })

  handle(IPC.mistakeDelete, async (id: string) => {
    await deleteMistake(id)
    return null
  })

  handle(IPC.reviewDue, async () => {
    const sums = await listMistakes({})
    return sums.filter((s) => isDue(s.review))
  })

  handle(IPC.reviewGrade, async (id: string, grade: Grade) => {
    const m = await readMistake(id)
    if (!m) throw new Error(`找不到错题 ${id}`)
    await updateMistake(id, { review: nextReview(m.review, grade, getSettings().examDate) })
    return null
  })

  handle(IPC.statsOverview, () => {
    const db = openIndex()
    initSchema(db)
    return statsOverview(db)
  })

  handle(IPC.analysisErrorPatterns, (filter: ListFilter | undefined) =>
    analyzeErrorPatterns(filter)
  )

  handle(IPC.generateVariants, (id: string, n?: number) => generateVariants(id, n ?? 3))

  handle(IPC.forecastTopics, () => forecastTopics())

  handle(IPC.configGet, () => getPublicConfig())

  handle(IPC.configSetChoice, (feature: FeatureKey | 'default', choice: ModelChoice) => {
    setChoice(feature, choice)
    return null
  })

  handle(IPC.configSetProviderKey, (providerId: string, apiKey: string) => {
    setProviderKey(providerId, apiKey)
    return null
  })

  handle(IPC.configUpsertProvider, (p: ProviderConfig) => {
    upsertProvider(p)
    return null
  })

  handle(IPC.configRemoveProviderKey, (providerId: string) => {
    removeProviderKey(providerId)
    return null
  })

  handle(IPC.configTest, (choice: ModelChoice) => testChoice(choice))

  handle(IPC.configListModels, (providerId: string) => listModels(providerId))

  handle(IPC.vaultGet, () => getVaultDir())

  handle(IPC.vaultChoose, async () => {
    const r = await dialog.showOpenDialog({
      title: '选择错题仓库目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return getVaultDir()
    setVaultDir(r.filePaths[0])
    await rebuildIndex()
    return r.filePaths[0]
  })

  handle(IPC.indexRebuild, () => rebuildIndex())

  handle(IPC.settingsGet, () => getSettings())

  handle(IPC.settingsSet, (patch: Partial<AppSettings>) => {
    const prevHotkey = getSettings().hotkey
    const next = updateSettings(patch)

    // 热键改名了就得重新注册：先摘掉旧的，注册失败要如实报错（而不是静默失效）
    if (patch.hotkey && patch.hotkey !== prevHotkey) {
      unregisterHotkeys()
      if (!registerHotkey(next.hotkey, () => void doCapture())) {
        throw new Error(`热键 ${next.hotkey} 注册失败，可能已被其他程序占用`)
      }
    }
    return next
  })
}

/* ────────────── 自检 ──────────────
   用法（在项目目录）：
     npx electron . --selftest                 只检查配置与文本连通性
     npx electron . --selftest <图片路径>       顺带跑一次真实的视觉识别
   不需要开窗口，退出码即结论，便于排查「为什么识别不工作」。 */

async function runSelfTest(imagePath?: string): Promise<number> {
  const choice = getFeatureModel('capture')
  const provider = getProviderById(choice.provider)
  const hasKey = !!getProviderKey(choice.provider)

  // 同时写进日志：打包版没有控制台，日志是唯一的出口
  const say = (line: string): void => {
    console.log(line)
    logLine('selftest', line)
  }

  say('── MistakeBook 自检 ──')
  say(`版本     : ${app.getVersion()}${app.isPackaged ? '（打包版）' : '（开发）'}`)
  say(`仓库目录 : ${getVaultDir()}`)
  say(`识别模型 : ${choice.provider} / ${choice.model}`)
  say(`协议格式 : ${provider?.format ?? 'openai'}   端点: ${provider?.baseUrl ?? '(未知 provider)'}`)
  say(`API Key  : ${hasKey ? '已配置' : '未配置 —— 请到「设置」里填写'}`)

  // 这几项在打包版里最容易「静默失效」——文件找不到不报错，只是静悄悄地不工作
  const mustExist: Array<[string, string]> = [
    ['框选界面', overlayHtmlPath],
    ['应用图标', resourcePath('icon.png')],
    ['托盘图标', resourcePath('tray.png')]
  ]
  for (const [label, p] of mustExist) {
    const exists = fs.existsSync(p)
    say(`${label} : ${exists ? 'OK' : '缺失！'}  ${p}`)
    if (!exists) return 5
  }
  if (!provider || !hasKey) return 2

  try {
    const t0 = Date.now()
    const echo = await chatText({
      choice,
      user: '回复两个字：连通',
      // 给足预算：有的网关默认开思考模式，预算太小会被推理吃光而拿不到文本
      maxTokens: 512,
      temperature: 0
    })
    console.log(`文本连通 : OK (${Date.now() - t0}ms) → ${echo.trim().slice(0, 30)}`)
  } catch (e) {
    say(`文本连通 : 失败 → ${e instanceof Error ? e.message : String(e)}`)
    return 3
  }

  if (!imagePath) {
    say('视觉识别 : 跳过（未提供图片路径）')
    return 0
  }

  try {
    const t0 = Date.now()
    const out = await chatVisionJSON({
      system: '只输出 JSON，不要任何其它文字。',
      user: '用 JSON 回答：{"firstLine":"图中最上面的那行文字"}',
      imageAbsPath: imagePath,
      schema: z.object({ firstLine: z.string() }),
      maxTokens: 800
    })
    say(`视觉识别 : OK (${Date.now() - t0}ms) → ${JSON.stringify(out).slice(0, 200)}`)
    return 0
  } catch (e) {
    say(`视觉识别 : 失败 → ${e instanceof Error ? e.message : String(e)}`)
    return 4
  }
}

/* ────────────── 生命周期 ────────────── */

registerAssetScheme()

app.whenReady().then(async () => {
  // 把版本号和运行形态写进日志：出问题时第一件事就是确认「你跑的到底是哪个版本」
  logLine(
    'app',
    `应用启动 v${app.getVersion()}${app.isPackaged ? '（打包版）' : '（开发）'} hotkey=${getSettings().hotkey}`
  )
  ensureDirs()
  fs.mkdirSync(getTempDir(), { recursive: true })

  // 自检模式：不开窗口，跑完即退出
  const argv = process.argv.slice(1)
  const selfIdx = argv.indexOf('--selftest')
  if (selfIdx >= 0) {
    const next = argv[selfIdx + 1]
    const image = next && !next.startsWith('--') ? next : undefined
    app.exit(await runSelfTest(image))
    return
  }

  handleAssetProtocol()
  const db = openIndex()
  initSchema(db)

  registerHandlers()
  createWindow()
  createTray()
  setupHotkey()

  // 索引为空 → 从 Markdown 全量重建（文件才是真相源）
  try {
    if (countRows(db) === 0) await rebuildIndex()
  } catch (e) {
    console.warn('[index] 初始重建跳过：', e)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => {
  unregisterHotkeys()
  tray?.destroy()
  tray = null
})

// 有托盘常驻，窗口全关也不退出
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (!tray) app.quit()
})

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason))
