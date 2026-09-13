import { BrowserWindow, ipcMain, screen } from 'electron'
import { logLine } from './log'
import notifyHtmlPath from './notify/notify.html?asset'

export { notifyHtmlPath }

const WIN_WIDTH = 360
const MIN_HEIGHT = 120
const MAX_HEIGHT = 520
const MARGIN = 16

/** 内容高度变了就报上来，由主进程调整窗口 —— 否则固定高度会把第二张卡裁掉 */
const NOTIFY_RESIZE = 'notify:resize'

/** 简化的任务类型（只保留通知窗口需要的字段） */
export interface NotifyTask {
  id: string
  status: string
  extraction?: {
    subject?: string
    /** 注意是 points —— 与真实的 Extraction 类型保持一致 */
    points?: string[]
    /** 置信度 0-1 */
    confidence?: number
  } | null
  remaining?: number
  /** 初始自动保存延迟秒数（用于进度条分母） */
  total?: number
  error?: string
  payload?: {
    imageAbsPath: string
  }
}

/** 单例：通知窗口引用 */
let notifyWin: BrowserWindow | null = null
/** 当前高度，用于保持右下角锚定 */
let currentHeight = 170

/** 把窗口钉在光标所在显示器工作区的右下角（高度按内容变） */
function anchorBottomRight(height: number): void {
  if (!notifyWin || notifyWin.isDestroyed()) return
  // 使用光标所在的显示器，而非主显示器（截图发生在光标所在的显示器）
  const cursorPoint = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursorPoint)
  const h = Math.min(Math.max(Math.round(height) || MIN_HEIGHT, MIN_HEIGHT), MAX_HEIGHT)
  currentHeight = h
  notifyWin.setBounds({
    x: workArea.x + workArea.width - WIN_WIDTH - MARGIN,
    y: workArea.y + workArea.height - h - MARGIN,
    width: WIN_WIDTH,
    height: h
  })
}

/**
 * 初始化通知窗口（只在 app.whenReady 后调用一次）
 */
export function initNotifyWindow(): void {
  // 在主显示器的工作区右下角显示
  const { workArea } = screen.getPrimaryDisplay()

  notifyWin = new BrowserWindow({
    x: workArea.x + workArea.width - WIN_WIDTH - MARGIN,
    y: workArea.y + workArea.height - currentHeight - MARGIN,
    width: WIN_WIDTH,
    height: currentHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    // 不抢焦点：用户正在做题，不能被打断
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  })

  // 内容高度变化 → 调整窗口（连截几张图时卡片会变多）
  ipcMain.removeAllListeners(NOTIFY_RESIZE)
  ipcMain.on(NOTIFY_RESIZE, (_e, h: unknown) => anchorBottomRight(Number(h)))

  // 加载通知 HTML
  notifyWin.loadFile(notifyHtmlPath).catch((err) => {
    logLine('notify', `通知窗口加载失败: ${err instanceof Error ? err.message : String(err)}`)
  })

  notifyWin.on('closed', () => {
    notifyWin = null
  })
}

/**
 * 推送任务状态到通知窗口
 * - 有任务 → 显示；没有 → 隐藏（不销毁，后续复用）
 *
 * 注意**不能**只把 recognizing/ready/saving 当作「活跃」：
 * saved 状态必须留在屏幕上 —— 用户需要看到「已保存 ✓」才算确认真的入库了。
 * 移除时机由渲染层负责（保存成功后 2.5 秒它会自己把任务删掉）。
 */
export function pushNotifyState(tasks: NotifyTask[]): void {
  if (!notifyWin || notifyWin.isDestroyed()) return

  if (tasks.length > 0) {
    if (!notifyWin.isVisible()) {
      anchorBottomRight(currentHeight) // 每次显示前重新定位（显示器热插拔 / 分辨率变化后位置会失效）
      notifyWin.showInactive()
    }
    notifyWin.webContents.send('notify:state', tasks)
  } else {
    notifyWin.hide()
  }
}

/**
 * 获取当前通知窗口引用（供 main/index.ts 监听事件）
 */
export function getNotifyWindow(): BrowserWindow | null {
  return notifyWin
}
