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
import type { CapturePayload } from '@shared/ipc'
import { logLine } from '../log'
// 必须用 ?asset 引入：out/ 只会带上被引用的资源，裸路径写 overlay.html 构建后就找不到了
import overlayHtmlPath from './overlay.html?asset'

/** 供自检使用：确认框选界面确实被打进了构建产物 */
export { overlayHtmlPath }

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
const OVERLAY_READY = 'overlay:ready'

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
      logLine('capture', 'desktopCapturer 未获取到任何屏幕源')
      return null
    }

    // 找到与显示器 ID 匹配的源（Electron 内部用 display_id 标识）
    // 如果找不到精确匹配，就用第一个（通常是主显示器）
    let source = sources.find(
      (s) => s.display_id === String(displayId)
    )
    if (!source) {
      // 备用：尝试按名称匹配（某些系统上 display_id 可能不匹配）
      logLine(
        'capture',
        `未找到匹配显示 ${displayId} 的源（共 ${sources.length} 个），回退到 sources[0]`
      )
      source = sources[0]
    } else {
      logLine(
        'capture',
        `匹配到显示 ${displayId}，源 ${source.id}，共 ${sources.length} 个源`
      )
    }

    return source.thumbnail
  } catch (err) {
    logLine('capture', `屏幕截图失败: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * 显示 overlay 窗口，让用户框选区域
 *
 * @param shotPath 整屏截图落盘后的路径（overlay 用 file:// 读它当背景）
 * @param display 目标显示器
 * @returns 框选区域（已乘以 devicePixelRatio 的像素坐标），或 null（用户取消）
 */
function showOverlay(
  shotPath: string,
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

    // 只把截图的**文件路径**传过去。
    // 别传 data URL：一张全屏图 base64 之后有好几 MB，塞进 URL 会直接把加载搞崩。
    const search = new URLSearchParams({ shot: shotPath }).toString()

    // 等 overlay 把背景图画出来再显示，否则会先闪一下桌面。
    // 兜底：万一 ready 信号没来（图片读失败等），1.2 秒后照样显示，不能让用户干等。
    const showNow = (): void => {
      if (overlayWin && !overlayWin.isDestroyed() && !overlayWin.isVisible()) {
        overlayWin.show()
        overlayWin.focus()
      }
    }
    const readyFallback = setTimeout(showNow, 1200)
    ipcMain.once(OVERLAY_READY, showNow)

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
      clearTimeout(readyFallback)
      ipcMain.removeListener(OVERLAY_READY, showNow)
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
    overlayWin.loadFile(overlayHtmlPath, { search }).catch((err) => {
      logLine('capture', `overlay 加载失败: ${err instanceof Error ? err.message : String(err)}`)
      cleanup()
      resolve(null)
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
    let shotPath: string | null = null
    try {
      logLine('capture', 'startCapture 开始')

      // 1. 截取屏幕
      const screenImage = await captureScreen()
      if (!screenImage) {
        logLine('capture', '屏幕截图为空，取消流程 (reason: screenImage=null)')
        return null
      }

      // 2. 获取光标所在显示器信息
      const display = getCursorDisplay()
      const imgSize = screenImage.getSize()
      logLine(
        'capture',
        `显示 ${display.size.width}x${display.size.height} @${display.scaleFactor}x，` +
          `截到 ${imgSize.width}x${imgSize.height}`
      )

      // 3. 整屏截图落盘，overlay 用 file:// 读它当背景
      shotPath = path.join(app.getPath('userData'), 'tmp', `overlay-${randomUUID()}.png`)
      fs.mkdirSync(path.dirname(shotPath), { recursive: true })
      fs.writeFileSync(shotPath, screenImage.toPNG())

      // 4. 显示 overlay，等待用户框选
      const rect = await showOverlay(shotPath, display)

      // 5. 用户取消
      if (!rect) {
        logLine('capture', '用户取消截图 (reason: user cancelled)')
        return null
      }
      logLine(
        'capture',
        `框选 ${rect.width}x${rect.height} @(${rect.x},${rect.y})，源图 ${imgSize.width}x${imgSize.height}`
      )

      // 6. 裁剪图片
      const croppedImage = cropImage(screenImage, rect)
      if (!croppedImage) {
        logLine('capture', '选区过小 (<8px)，视为取消 (reason: rect too small)')
        return null
      }

      // 7. 保存到临时文件
      const payload = await saveTempImage(croppedImage)
      lastCapture = payload
      logLine('capture', `截图完成: ${payload.imageAbsPath}`)
      return payload
    } catch (err) {
      logLine('capture', `截图流程失败: ${err instanceof Error ? err.message : String(err)}`)
      return null
    } finally {
      // 背景大图用完即删 —— 它只是给 overlay 看的，没有留存价值
      if (shotPath) fs.rmSync(shotPath, { force: true })
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
