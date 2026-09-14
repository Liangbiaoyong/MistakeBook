import { describe, expect, it } from 'vitest'
import {
  fillDays,
  localDate,
  parseLocalDate,
  periodComparison,
  shiftDate,
  sumPeriod,
  windowStart
} from '../src/main/store/trend'

describe('localDate —— 必须用本地日期', () => {
  it('取的是本地年月日，不是 UTC', () => {
    // UTC+8 下 toISOString() 会把 01-01 00:30 算成 2025-12-31；
    // 这正是「凌晨记的错题跑到前一天」那个 bug 的根源
    expect(localDate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(localDate(new Date(2026, 8, 14, 23, 59))).toBe('2026-09-14')
  })

  it('月份和日期补零', () => {
    expect(localDate(new Date(2026, 2, 5))).toBe('2026-03-05')
  })
})

describe('parseLocalDate', () => {
  it('解析合法日期', () => {
    const d = parseLocalDate('2026-09-14')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(8)
    expect(d?.getDate()).toBe(14)
  })

  it('非法输入返回 null，不把 NaN 带进统计', () => {
    expect(parseLocalDate('不是日期')).toBeNull()
    expect(parseLocalDate('2026-9-14')).toBeNull()
    expect(parseLocalDate('')).toBeNull()
  })
})

describe('shiftDate —— 跨月跨年的边界', () => {
  it('月初往回一天要退到上个月，不是 0 号', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('闰年二月是 29 天', () => {
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29')
  })

  it('跨年', () => {
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2025-12-31', 1)).toBe('2026-01-01')
  })

  it('推 0 天不变', () => {
    expect(shiftDate('2026-09-14', 0)).toBe('2026-09-14')
  })
})

describe('windowStart', () => {
  it('7 天窗口含今天，所以起点是往前 6 天', () => {
    expect(windowStart('2026-09-14', 7)).toBe('2026-09-08')
  })

  it('1 天窗口就是今天本身', () => {
    expect(windowStart('2026-09-14', 1)).toBe('2026-09-14')
  })
})

describe('fillDays —— 补齐没有数据的日子', () => {
  const today = '2026-09-14'

  it('长度正好是窗口天数，且按日期升序', () => {
    const days = fillDays([], 7, today)
    expect(days).toHaveLength(7)
    expect(days[0].date).toBe('2026-09-08')
    expect(days[6].date).toBe(today)
  })

  it('没有数据的那天补 0，而不是被跳过', () => {
    const days = fillDays([{ date: '2026-09-12', added: 3, reviewed: 1 }], 7, today)
    expect(days.map((d) => d.added)).toEqual([0, 0, 0, 0, 3, 0, 0])
    expect(days.map((d) => d.reviewed)).toEqual([0, 0, 0, 0, 1, 0, 0])
  })

  it('窗口之外的数据被丢掉（不会画到图上）', () => {
    const days = fillDays([{ date: '2020-01-01', added: 99 }], 7, today)
    expect(days.every((d) => d.added === 0)).toBe(true)
  })

  it('同日多条会被调用方先合并；这里只认最后一条，故不做合并', () => {
    // 说明性断言：fillDays 不负责聚合，聚合在 SQL 侧完成
    const days = fillDays(
      [
        { date: today, added: 1 },
        { date: today, added: 2 }
      ],
      1,
      today
    )
    expect(days).toHaveLength(1)
  })
})

describe('sumPeriod —— 两端都算', () => {
  const days = fillDays(
    [
      { date: '2026-09-10', added: 1, reviewed: 2 },
      { date: '2026-09-12', added: 3, reviewed: 0 }
    ],
    5,
    '2026-09-14'
  )

  it('起点和终点当天的量都算进去', () => {
    const s = sumPeriod(days, '2026-09-10', '2026-09-12', new Map())
    expect(s.added).toBe(4)
    expect(s.reviewed).toBe(2)
  })

  it('起止之外的量不算', () => {
    const s = sumPeriod(days, '2026-09-11', '2026-09-12', new Map())
    expect(s.added).toBe(3)
    expect(s.reviewed).toBe(0)
  })

  it('没复习过时遗忘率是 null，不是 0 —— 「没复习」和「一道都没忘」是两回事', () => {
    const s = sumPeriod(days, '2026-09-11', '2026-09-11', new Map())
    expect(s.reviewed).toBe(0)
    expect(s.forgotRate).toBeNull()
  })

  it('遗忘率按复习次数算', () => {
    const s = sumPeriod(days, '2026-09-10', '2026-09-10', new Map([['2026-09-10', 1]]))
    expect(s.reviewed).toBe(2)
    expect(s.forgotRate).toBeCloseTo(0.5)
  })
})

describe('periodComparison —— 两个窗口不能重叠', () => {
  const today = '2026-09-14'
  const days = fillDays(
    [
      { date: '2026-09-14', added: 5, reviewed: 4 }, // 本窗口
      { date: '2026-09-08', added: 1, reviewed: 2 }, // 本窗口起点
      { date: '2026-09-07', added: 3, reviewed: 6 }, // 上窗口终点
      { date: '2026-09-01', added: 2, reviewed: 0 } // 上窗口起点
    ],
    14,
    today
  )

  it('本窗口是最近 7 天（含今天）', () => {
    const c = periodComparison(days, new Map(), 7, today)
    expect(c.current.added).toBe(6)
    expect(c.current.reviewed).toBe(6)
  })

  it('上一窗口紧接着本窗口之前，一天也不重叠', () => {
    const c = periodComparison(days, new Map(), 7, today)
    expect(c.previous.added).toBe(5)
    expect(c.previous.reviewed).toBe(6)
    // 两个窗口相加正好是全部数据 —— 若有重叠，同一批数据会被算两次
    const all = days.reduce((n, d) => n + d.added, 0)
    expect(c.current.added + c.previous.added).toBe(all)
  })

  it('遗忘率分别按各自窗口的复习次数算', () => {
    const forgot = new Map([['2026-09-14', 1]])
    const c = periodComparison(days, forgot, 7, today)
    expect(c.current.forgot).toBe(1)
    // 本窗口复习了 4 + 2 = 6 次，其中 1 次「忘了」
    expect(c.current.forgotRate).toBeCloseTo(1 / 6)
    expect(c.previous.forgot).toBe(0)
    expect(c.previous.forgotRate).toBeCloseTo(0)
  })

  it('上一窗口一次都没复习时遗忘率是 null', () => {
    const c = periodComparison(days, new Map(), 7, today)
    expect(c.previous.forgotRate).toBe(0) // 有复习（6 次）但没忘
    const empty = periodComparison(fillDays([], 7, today), new Map(), 7, today)
    expect(empty.previous.forgotRate).toBeNull()
    expect(empty.current.forgotRate).toBeNull()
  })

  it('days 字段如实回传窗口长度', () => {
    expect(periodComparison(days, new Map(), 30, today).days).toBe(30)
  })
})
