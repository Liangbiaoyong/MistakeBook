/**
 * 格式化工具 — 日期、状态显示
 */
import type { Status } from '@shared/types'

/**
 * 格式化 ISO 日期字符串为本地可读格式（YYYY-MM-DD）
 */
export function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).replace(/\//g, '-')
  } catch {
    return iso
  }
}

/**
 * 计算相对日期（今天/昨天/N 天前）
 */
export function relativeDay(iso: string): string {
  const now = new Date()
  const target = new Date(iso)

  // 只取日期部分
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate())

  const diffMs = todayStart.getTime() - targetStart.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays === -1) return '明天'
  if (diffDays > 0) return `${diffDays} 天前`
  return `${Math.abs(diffDays)} 天后`
}

/**
 * 格式化 ISO 日期字符串为本地可读格式（YYYY-MM-DD HH:mm）
 */
export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    const y = d.getFullYear()
    const m = pad(d.getMonth() + 1)
    const day = pad(d.getDate())
    const hh = pad(d.getHours())
    const mm = pad(d.getMinutes())
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch {
    return iso
  }
}

/**
 * 状态文本标签
 */
export function statusLabel(s: Status): string {
  const labels: Record<Status, string> = {
    new: '未复习',
    reviewing: '复习中',
    mastered: '已掌握'
  }
  return labels[s] ?? s
}

/**
 * 状态对应的颜色调性（匹配 design/tokens 的 ACCENT）
 */
export function statusTone(s: Status): 'coral' | 'sun' | 'mint' {
  const tones: Record<Status, 'coral' | 'sun' | 'mint'> = {
    new: 'coral',
    reviewing: 'sun',
    mastered: 'mint'
  }
  return tones[s] ?? 'coral'
}
