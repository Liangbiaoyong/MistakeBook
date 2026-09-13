/**
 * 桌面截图与框选模块
 *
 * 实现全局热键触发 → 全屏透明窗显示冻结截图 → 用户框选区域 → 裁剪落盘 → 返回 CapturePayload
 */
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen
} from 'electron'
import type { NativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/ipc'
import type { CapturePayload } from '@shared/ipc'

/**
 * 框选结果（从 overlay 窗发送回来的像素坐标）
 * 经过 HiDPI/Retina 的 devicePixelRatio 缩放
 */
interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

/** 单例：当前进行中的截图 Promise，防止多次触发 */
let inflight: Promise<CapturePayload | null> | null = null

/** 最后一次成功的截图结果 */
let lastCapture: CapturePayload | null = null

/** 当前 overlay 窗口引用，用于 finally 销毁 */
let overlayWin: BrowserWindow | null = null

/** overlay 窗口发送的 IPC 通道 */
const OVERLAY_COMMIT = 'overlay:commit'
const OVERLAY_CANCEL = 'overlay:cancel'

/**
 * 获取最后成功的截图
 */
export function getLastCapture(): CapturePayload | null {
  return lastCapture
}

/**
 * 获取当前鼠标所在的显示器
 * v1: 只支持单显示器（光标所在显示器），不做多屏合成
 */
function getCursorDisplay(): Electron.Display {
  const cursorPoint = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(cursorPoint)
}

/**
 * 截取当前显示器的屏幕内容
 *
 * desktopCapturer.getSources 返回所有屏幕源，每个对应一个物理显示器。
 * 我们选取与光标所在的显示器匹配的源。
 */
async function captureScreen(): Promise<NativeImage | null> {
  try {
    const display = getCursorDisplay()
    const displayId = display.id
    const scaleFactor = display.scaleFactor

    // 截取屏幕（使用显示器的分辨率作为 thumbnail 大小）
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.size.width * scaleFactor),
        height: Math.round(display.size.height * scaleFactor)
      }
    })

    if (sources.length === 0) {
      console.error('[capture] desktopCapturer 未获取到任何屏幕源')
      return null
    }

    // 找到与显示器 ID 匹配的源（Electron 内部用 display_id 标识）
    // 如果找不到精确匹配，就用第一个（通常是主显示器）
    let source = sources.find(
      (s) => s.display_id === String(displayId)
    )
    if (!source) {
      // 备用：尝试按名称匹配（某些系统上 display_id 可能不匹配）
      source = sources[0]
    }

    return source.thumbnail
  } catch (err) {
    console.error('[capture] 屏幕截图失败:', err)
    return null
  }
}

/**
 * 显示 overlay 窗口，让用户框选区域
 *
 * @param screenshotDataUrl 截图的 data URL，作为背景显示
 * @param display 目标显示器
 * @returns 框选区域（已乘以 devicePixelRatio 的像素坐标），或 null（用户取消）
 */
function showOverlay(
  screenshotDataUrl: string,
  display: Electron.Display
): Promise<SelectionRect | null> {
  return new Promise((resolve) => {
    const { x, y, width, height } = display.bounds

    // 创建 overlay 窗口
    overlayWin = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      focusable: true,
      show: false,
      // 对于这个内部可信窗口，禁用 contextIsolation 以简化通信
      // 理由：这是主进程完全控制的窗口，只加载本地 HTML，无安全风险
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    })

    // 传递截图 data URL 作为查询参数
    const overlayUrl = path.join(__dirname, 'overlay.html')
    const url = new URL(overlayUrl)
    url.searchParams.set('screenshot', screenshotDataUrl)

    // 等待窗口加载完成后再显示
    overlayWin.once('ready-to-show', () => {
      overlayWin?.show()
      overlayWin?.focus()
    })

    // 处理框选结果
    function onCommit(_event: Electron.IpcMainEvent, rect: SelectionRect) {
      cleanup()
      resolve(rect)
    }

    // 处理取消
    function onCancel() {
      cleanup()
      resolve(null)
    }

    function cleanup() {
      ipcMain.removeListener(OVERLAY_COMMIT, onCommit)
      ipcMain.removeListener(OVERLAY_CANCEL, onCancel)
      // 必须用 destroy()，不能用 close()
      // 透明窗口在 Windows 上 close() 可能不会立即释放，导致崩溃
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.destroy()
      }
      overlayWin = null
    }

    ipcMain.on(OVERLAY_COMMIT, onCommit)
    ipcMain.on(OVERLAY_CANCEL, onCancel)

    // 窗口被意外关闭时也要清理
    overlayWin.on('closed', () => {
      cleanup()
      resolve(null)
    })

    // 加载 overlay HTML
    overlayWin.loadFile(overlayUrl, {
      search: url.searchParams.toString()
    })
  })
}

/**
 * 将原始截图裁剪为指定区域
 *
 * @param sourceImage 原始截图（nativeImage）
 * @param rect 框选区域（已乘以 devicePixelRatio 的像素坐标）
 * @returns 裁剪后的图片
 */
function cropImage(
  sourceImage: NativeImage,
  rect: SelectionRect
): NativeImage | null {
  // 过滤掉太小的选区（< 8px），视为无效
  if (rect.width < 8 || rect.height < 8) {
    return null
  }

  return sourceImage.crop({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  })
}

/**
 * 将图片保存到临时文件，并生成缩略图
 *
 * @param image 已裁剪的图片
 * @returns CapturePayload
 */
async function saveTempImage(image: NativeImage): Promise<CapturePayload> {
  // 确保临时目录存在
  const tmpDir = path.join(app.getPath('userData'), 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })

  // 生成唯一文件名
  const id = randomUUID()
  const imagePath = path.join(tmpDir, `${id}.png`)

  // 保存完整图片
  const pngBuffer = image.toPNG()
  fs.writeFileSync(imagePath, pngBuffer)

  // 生成缩略图（最大宽度 480px）
  const thumbImage = image.resize({ width: 480 })
  const thumbDataUrl = thumbImage.toDataURL()

  return {
    imageAbsPath: imagePath,
    thumbDataUrl
  }
}

/**
 * 启动一次截图流程
 *
 * 完整流程：截图 → 显示 overlay → 用户框选 → 裁剪 → 落盘
 *
 * 多次调用安全：如果已有进行中的截图，直接返回现有 Promise
 */
export async function startCapture(): Promise<CapturePayload | null> {
  // 防止多次同时触发
  if (inflight) {
    return inflight
  }

  inflight = (async () => {
    try {
      // 1. 截取屏幕
      const screenImage = await captureScreen()
      if (!screenImage) {
        console.error('[capture] 屏幕截图为空，取消流程')
        return null
      }

      // 2. 获取光标所在显示器信息
      const display = getCursorDisplay()

      // 3. 将截图转换为 data URL 传给 overlay
      const screenshotDataUrl = screenImage.toDataURL()

      // 4. 显示 overlay，等待用户框选
      const rect = await showOverlay(screenshotDataUrl, display)

      // 5. 用户取消
      if (!rect) {
        console.log('[capture] 用户取消截图')
        return null
      }

      // 6. 裁剪图片
      const croppedImage = cropImage(screenImage, rect)
      if (!croppedImage) {
        console.log('[capture] 选区过小，视为取消')
        return null
      }

      // 7. 保存到临时文件
      const payload = await saveTempImage(croppedImage)
      lastCapture = payload
      console.log('[capture] 截图完成:', payload.imageAbsPath)
      return payload
    } catch (err) {
      console.error('[capture] 截图流程失败:', err)
      return null
    } finally {
      // 确保 overlay 窗口被销毁，避免内存泄漏
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.destroy()
      }
      overlayWin = null
      inflight = null
    }
  })()

  return inflight
}

/**
 * 注册 IPC 处理器
 *
 * 处理渲染进程触发的截图请求
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.captureStart, async () => {
    const payload = await startCapture()
    return payload
  })
}
