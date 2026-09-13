/**
 * 全局热键管理
 * 封装 electron 的 globalShortcut，提供统一的注册/注销接口
 */
import { globalShortcut } from 'electron'

/**
 * 默认热键: Alt+Shift+A
 * 选择理由：
 * - Alt+Shift 组合不易与常见应用冲突（避免 Alt+F4、Ctrl+C 等）
 * - A 代表 "Add"（添加错题）
 * - 这三个键在 Windows 键盘上位置舒适，可用单手操作
 */
export const DEFAULT_HOTKEY = 'Alt+Shift+A'

/** 已注册的热键列表，用于批量注销 */
const registeredAccels = new Set<string>()

/**
 * 注册全局热键
 * @param accel 加速器字符串，如 'Alt+Shift+A'
 * @param onTrigger 热键触发回调
 * @returns 是否成功绑定
 */
export function registerHotkey(
  accel: string,
  onTrigger: () => void
): boolean {
  // 先注销同名热键，避免重复注册
  if (registeredAccels.has(accel)) {
    globalShortcut.unregister(accel)
    registeredAccels.delete(accel)
  }

  const ok = globalShortcut.register(accel, onTrigger)
  if (ok) {
    registeredAccels.add(accel)
  }
  return ok
}

/**
 * 注销所有已注册的热键
 */
export function unregisterHotkeys(): void {
  for (const accel of registeredAccels) {
    globalShortcut.unregister(accel)
  }
  registeredAccels.clear()
}
