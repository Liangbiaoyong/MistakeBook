/**
 * 时间维度统计 —— 纯函数，可单元测试（不碰 electron / 文件系统）。
 *
 * 为什么值得单开一个模块：这一块全是「日期算术 + 窗口切分」，
 * 最容易出的是差一天、漏一天、把空窗口当成「没复习」这类静默错误。
 * 放在纯函数里就能把边界逐一钉死。
 */
import type { PeriodComparison, PeriodStats, TrendDay } from '@shared/types'

/** 本地日期 YYYY-MM-DD。绝不能用 toISOString()：那是 UTC，会把凌晨的题算到前一天 */
export function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 解析本地日期；非法输入返回 null（宁可跳过，也不要把 NaN 带进统计） */
export function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 往前/后推 n 天的本地日期 */
export function shiftDate(base: string, days: number): string {
  const d = parseLocalDate(base)
  if (!d) return base
  d.setDate(d.getDate() + days)
  return localDate(d)
}

/**
 * 把稀疏的按日数据补齐成连续 windowDays 天（含今天）。
 *
 * SQL 的 GROUP BY 只返回「有数据的那些天」，直接拿去画折线，
 * 没有复习的日子会被邻居连线跨过去 —— 看起来像那天有量，其实是没有。
 */
export function fillDays(
  rows: Array<{ date: string; added?: number; reviewed?: number }>,
  windowDays: number,
  today: string
): TrendDay[] {
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const out: TrendDay[] = []
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = shiftDate(today, -i)
    const r = byDate.get(date)
    out.push({ date, added: r?.added ?? 0, reviewed: r?.reviewed ?? 0 })
  }
  return out
}

/** 窗口内的天数（含今天） */
export function windowStart(today: string, days: number): string {
  return shiftDate(today, -(days - 1))
}

/**
 * 统计一段窗口内的量。窗口是**两端都算**的 [start, end]。
 */
export function sumPeriod(
  days: TrendDay[],
  start: string,
  end: string,
  forgotByDate: Map<string, number>
): PeriodStats {
  let added = 0
  let reviewed = 0
  let forgot = 0
  for (const d of days) {
    if (d.date < start || d.date > end) continue
    added += d.added
    reviewed += d.reviewed
    forgot += forgotByDate.get(d.date) ?? 0
  }
  return {
    added,
    reviewed,
    forgot,
    forgotRate: reviewed > 0 ? forgot / reviewed : null
  }
}

/**
 * 本窗口 vs 紧邻的上一个等长窗口。
 *
 * 窗口是「最近 days 天」与「再往前 days 天」—— 注意上一窗口的结束日是本窗口开始日的**前一天**，
 * 两个窗口不能重叠，否则同一批数据会被算两次，趋势被凭空抬高。
 */
export function periodComparison(
  days: TrendDay[],
  forgotByDate: Map<string, number>,
  windowDays: number,
  today: string
): PeriodComparison {
  const curStart = windowStart(today, windowDays)
  const prevEnd = shiftDate(curStart, -1)
  const prevStart = shiftDate(prevEnd, -(windowDays - 1))

  return {
    days: windowDays,
    current: sumPeriod(days, curStart, today, forgotByDate),
    previous: sumPeriod(days, prevStart, prevEnd, forgotByDate)
  }
}
