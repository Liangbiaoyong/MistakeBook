import { app, BrowserWindow, ipcMain, protocol, dialog, shell } from 'electron'
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
  setChoice,
  setProviderKey,
  upsertProvider,
  getProviderKey,
  getFeatureModel
} from './config'
import { startCapture, registerIpcHandlers as registerCaptureIpc } from './capture/capture'
import { registerHotkey, unregisterHotkeys } from './capture/hotkey'
import { chatVisionJSON } from './llm/client'
import { ExtractionSchema } from './llm/schema'
import { CAPTURE_SYSTEM } from './llm/prompts'
import { analyzeErrorPatterns } from './features/analyze'
import { generateVariants } from './features/generate'
import { forecastTopics } from './features/forecast'
import { nextReview, isDue } from './review'
import { getSettings, updateSettings } from './settings'

const ASSET_SCHEME = 'cuoti-asset'

let mainWindow: BrowserWindow | null = null
let lastCapture: CapturePayload | null = null

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
  ipcMain.handle(channel, async (_e, ...args): Promise<Result<TOut>> => {
    try {
      return { ok: true, data: await fn(...(args as TArgs)) }
    } catch (e) {
      const error = toMessage(e)
      console.error(`[ipc:${channel}]`, error)
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

/* ────────────── 采集 ────────────── */

async function doCapture(): Promise<CapturePayload | null> {
  const payload = await startCapture()
  if (!payload) return null
  lastCapture = payload
  if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
  mainWindow?.webContents.send(IPC.captureCaptured, payload)
  return payload
}

function setupHotkey(): void {
  const accel = getSettings().hotkey
  if (!registerHotkey(accel, () => void doCapture())) {
    console.warn(`[hotkey] 注册失败：${accel}（可能被占用）`)
  }
}

/* ────────────── 连通性自检（设置页的「测试」按钮） ────────────── */

async function testChoice(choice: ModelChoice): Promise<{ latencyMs: number; echo: string }> {
  const cfg = getPublicConfig()
  const provider = cfg.providers.find((p) => p.id === choice.provider)
  if (!provider) throw new Error(`未知的 provider：${choice.provider}`)
  const key = getProviderKey(choice.provider)
  if (!key) throw new Error('MissingKeyError')

  const started = Date.now()
  const res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: choice.model,
      messages: [{ role: 'user', content: '只回复两个字：连通' }],
      max_tokens: 16,
      temperature: 0
    }),
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}：${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return {
    latencyMs: Date.now() - started,
    echo: json.choices?.[0]?.message?.content?.trim() ?? '(空响应)'
  }
}

/* ────────────── IPC 注册 ────────────── */

function registerHandlers(): void {
  registerCaptureIpc()

  handle(IPC.captureStart, async (): Promise<null> => {
    await doCapture()
    return null
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

  handle(IPC.configTest, (choice: ModelChoice) => testChoice(choice))

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

/* ────────────── 生命周期 ────────────── */

registerAssetScheme()

app.whenReady().then(async () => {
  ensureDirs()
  fs.mkdirSync(getTempDir(), { recursive: true })

  handleAssetProtocol()
  const db = openIndex()
  initSchema(db)

  registerHandlers()
  createWindow()
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

app.on('will-quit', () => unregisterHotkeys())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason))
