/**
 * 复习事件日志 —— 追加写在 vault 里的 reviews.jsonl。
 *
 * 为什么它不是索引的一部分：索引可以从 Markdown 重建，而**复习历史重建不出来** ——
 * Markdown 里只留得下「上次复习」和「轮次」，中间的过程一旦覆盖就没了。
 * 所以这份日志必须和 Markdown 一样是**用户数据**，落在 vault 里，重建索引时由它回填。
 *
 * 用 JSONL（一行一条）而不是一个 JSON 数组：追加只写一行、不会重写整个文件，
 * 中途断电最多毁掉最后一行，前面的记录完好。
 */
import { appendFile, readFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { ReviewEvent, Grade } from '@shared/types'
import { GRADES } from '@shared/types'
import { getVaultDir } from './paths'

export function reviewLogPath(): string {
  return join(getVaultDir(), 'reviews.jsonl')
}

/** 追加一次评分。失败不抛 —— 统计丢一条也不能让评分本身失败 */
export async function appendReviewEvent(e: ReviewEvent): Promise<void> {
  const p = reviewLogPath()
  await mkdir(dirname(p), { recursive: true })
  await appendFile(p, `${JSON.stringify(e)}\n`, 'utf8')
}

/** 读回全部事件。坏行直接跳过（手改过、或被断电截断的最后一行） */
export async function readReviewEvents(): Promise<ReviewEvent[]> {
  let raw: string
  try {
    raw = await readFile(reviewLogPath(), 'utf8')
  } catch {
    return []
  }
  const out: ReviewEvent[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t) as Partial<ReviewEvent>
      if (typeof o.id !== 'string' || !o.id) continue
      if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) continue
      if (!GRADES.includes(o.grade as Grade)) continue
      out.push({
        id: o.id,
        date: o.date,
        grade: o.grade as Grade,
        round: Number.isFinite(o.round) ? Number(o.round) : 0
      })
    } catch {
      // 跳过无法解析的行
    }
  }
  return out
}
