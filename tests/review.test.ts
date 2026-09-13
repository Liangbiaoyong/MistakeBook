import { describe, expect, it } from 'vitest'
import { isDue, nextReview } from '../src/main/review'
import type { ReviewState } from '../src/shared/types'

const DAY = 86_400_000

function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function isoPlus(days: number): string {
  const d = today()
  d.setTime(d.getTime() + days * DAY)
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
}

const fresh: ReviewState = { round: 0 }

describe('nextReview —— 间隔重复调度', () => {
  it('"良好"从第 0 轮起排到明天', () => {
    expect(nextReview(fresh, 'good').next).toBe(isoPlus(1))
  })

  it('轮次递增', () => {
    expect(nextReview(fresh, 'good').round).toBe(1)
    expect(nextReview({ round: 3 }, 'good').round).toBe(4)
  })

  it('间隔随轮次拉长（1→2→4→7→15→30 天）', () => {
    const days = [0, 1, 2, 3, 4, 5].map((r) =>
      Math.round((new Date(`${nextReview({ round: r }, 'good').next}T00:00:00`).getTime() - today().getTime()) / DAY)
    )
    expect(days).toEqual([1, 2, 4, 7, 15, 30])
  })

  it('间隔到顶后不再增长（考前不该把题推到无限远）', () => {
    const atTop = nextReview({ round: 5 }, 'good')
    const wayPast = nextReview({ round: 99 }, 'good')
    expect(wayPast.next).toBe(atTop.next)
  })

  it('"忘了"把轮次往回打并当天重来', () => {
    const r = nextReview({ round: 4 }, 'again')
    expect(r.round).toBe(2)
    expect(r.next).toBe(isoPlus(0))
  })

  it('"忘了"不会把轮次打成负数', () => {
    expect(nextReview({ round: 0 }, 'again').round).toBe(0)
    expect(nextReview({ round: 1 }, 'again').round).toBe(0)
  })

  it('"简单"比"良好"排得更远', () => {
    const good = new Date(`${nextReview({ round: 2 }, 'good').next}T00:00:00`).getTime()
    const easy = new Date(`${nextReview({ round: 2 }, 'easy').next}T00:00:00`).getTime()
    expect(easy).toBeGreaterThan(good)
  })

  it('"困难"比"良好"排得更近', () => {
    const good = new Date(`${nextReview({ round: 2 }, 'good').next}T00:00:00`).getTime()
    const hard = new Date(`${nextReview({ round: 2 }, 'hard').next}T00:00:00`).getTime()
    expect(hard).toBeLessThan(good)
  })

  describe('考试日期这道闸', () => {
    it('绝不把复习排到考试之后', () => {
      const exam = isoPlus(3)
      const r = nextReview(fresh, 'easy', exam)
      expect(new Date(`${r.next}T00:00:00`).getTime()).toBeLessThanOrEqual(
        new Date(`${exam}T00:00:00`).getTime()
      )
    })

    it('本来就在考试之前的正常间隔不受影响', () => {
      const exam = isoPlus(60)
      expect(nextReview(fresh, 'good', exam).next).toBe(isoPlus(1))
    })

    it('考试日期非法时忽略它，不崩', () => {
      expect(nextReview(fresh, 'good', '不是日期').next).toBe(isoPlus(1))
    })
  })

  it('每次都会记录 last', () => {
    expect(nextReview(fresh, 'good').last).toBe(isoPlus(0))
  })
})

describe('isDue —— 到期判断', () => {
  const t = isoPlus(0)

  it('没有 next 视为到期', () => {
    expect(isDue({ round: 0 }, t)).toBe(true)
  })

  it('next 是今天 → 到期', () => {
    expect(isDue({ round: 1, next: isoPlus(0) }, t)).toBe(true)
  })

  it('next 在过去 → 到期', () => {
    expect(isDue({ round: 2, next: isoPlus(-5) }, t)).toBe(true)
  })

  it('next 在将来 → 不到期', () => {
    expect(isDue({ round: 2, next: isoPlus(3) }, t)).toBe(false)
  })
})
