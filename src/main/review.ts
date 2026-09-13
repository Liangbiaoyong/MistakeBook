import type { Grade, ReviewState } from '@shared/types'

/**
 * 简化的间隔重复调度。
 *
 * 与标准 SM-2/FSRS 的差别是有意的：考研初试日期是固定的，
 * 目标是「在考试那天把预期得分最大化」，而不是「长期保持记忆」。
 * 所以间隔有个跳表上限，且**绝不排到考试日期之后**——考完的复习没有意义。
 *
 * 考试日期由调用方传入（而非在此读配置），使本模块保持纯函数、可单测。
 */
const LADDER_DAYS = [1, 2, 4, 7, 15, 30] as const
const DAY_MS = 86_400_000

function iso(d: Date): string {
  // 统一用本地日期的 YYYY-MM-DD，避免时区把"今天"算错
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(days: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setTime(d.getTime() + days * DAY_MS)
  return d
}

export function nextReview(state: ReviewState, grade: Grade, examDate?: string): ReviewState {
  const round = Math.max(0, state.round ?? 0)

  // 忘了：轮次回退，当天/次日再来
  if (grade === 'again') {
    return { last: iso(new Date()), next: iso(addDays(0)), round: Math.max(0, round - 2) }
  }

  const hardBump = grade === 'hard' ? -1 : grade === 'easy' ? 1 : 0
  const idx = Math.min(LADDER_DAYS.length - 1, Math.max(0, round + hardBump))
  let interval: number = LADDER_DAYS[idx]
  if (grade === 'easy') interval = Math.round(interval * 1.5)

  let next = addDays(interval)

  if (examDate) {
    const exam = new Date(`${examDate}T00:00:00`)
    if (!Number.isNaN(exam.getTime()) && next.getTime() > exam.getTime()) {
      next = exam
    }
  }

  return { last: iso(new Date()), next: iso(next), round: round + 1 }
}

/** 是否已到期（含今天） */
export function isDue(state: ReviewState, today = iso(new Date())): boolean {
  const next = state.next
  if (!next) return true
  return next <= today
}
