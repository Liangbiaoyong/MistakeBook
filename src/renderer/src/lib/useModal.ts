/**
 * Modal 辅助 hook —— Esc 关闭、焦点陷阱、初始焦点、关闭时恢复焦点。
 * Composer 的未保存编辑走 window.confirm 二次确认。
 */
import { useEffect, useRef, useCallback } from 'react'

interface UseModalOptions {
  /** 模态是否打开 */
  open: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 是否在 Esc 时弹确认（Composer 有未保存编辑时设为 true） */
  confirmOnEsc?: boolean
  /** 初始焦点元素选择器（对话框内）。留空则聚焦第一个可交互元素 */
  initialFocusSelector?: string
}

/**
 * 返回一个 ref，挂到对话框的根容器（role="dialog"）上。
 * 焦点陷阱和 Esc 监听由 hook 自动管理。
 */
export function useModal({
  open,
  onClose,
  confirmOnEsc = false,
  initialFocusSelector
}: UseModalOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  /* ── 打开时：记录之前的焦点并设置初始焦点 ── */
  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement

    // 等 DOM 挂载后设置初始焦点
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return

      if (initialFocusSelector) {
        const el = container.querySelector<HTMLElement>(initialFocusSelector)
        if (el) { el.focus(); return }
      }

      // 找第一个可交互元素
      const first = container.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      first?.focus()
    })

    return () => cancelAnimationFrame(raf)
  }, [open, initialFocusSelector])

  /* ── 关闭时：恢复之前焦点 ── */
  useEffect(() => {
    if (open) return
    previousFocusRef.current?.focus()
  }, [open])

  /* ── Esc 关闭 ── */
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()

      if (confirmOnEsc) {
        if (!window.confirm('有未保存的修改，确定要关闭吗？')) return
      }
      onClose()
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose, confirmOnEsc])

  /* ── 焦点陷阱 ── */
  const trapFocus = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return

      const focusable = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    []
  )

  return { containerRef, trapFocus }
}
