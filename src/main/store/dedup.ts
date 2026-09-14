/**
 * 错题查重 —— 纯函数，可单元测试（不碰 electron / 文件系统）。
 *
 * 为什么值得做：同一道题截两次就会存两条。两条会各自进复习队列、各自算进统计，
 * 于是「我到底错了几道题」「这个考点我错了几次」全部虚高，而这两个数字
 * 正是备考时最该可信的。所以这里宁可保守 —— 相似度不够高就不提示。
 */
import type { DuplicateHit, Status } from '@shared/types'
import { questionPreview } from './frontmatter'

/** 查重的输入：只要够判断「像不像」的字段 */
export interface DedupCandidate {
  id: string
  subject: string
  created: string
  /** 完整题干（不是列表那种截断预览） */
  question: string
  status: Status
  reviewRound: number
  hasImage: boolean
}

/**
 * 默认阈值：到这个相似度才值得打扰用户。
 *
 * 0.75 而不是更高：中文题的二元组 Jaccard 对**字符级 OCR 噪声**很敏感 ——
 * 一道 20 来字的题错一个字，相似度就掉到 0.8 出头。阈值定太高会把
 * 「同一道题、识别稍差」这种最常见的情况漏掉，而漏报等于这个功能白做。
 * 反过来也不用担心误报：不相关的两道中文题 Jaccard 通常在 0.1 上下，离 0.75 很远。
 */
export const DEFAULT_DUPLICATE_THRESHOLD = 0.75

/**
 * 归一化：只留「内容」。
 *
 * 去空白、去 LaTeX 定界符与反斜杠、去中英文标点、转小写。
 * 目的是让 `$n$ 个结点` 和 `n 个结点`、`（A）` 和 `(A)` 落到同一个形状上 ——
 * 否则同一道题因为 OCR 标点差异就会被判成两道。
 */
export function normalizeQuestion(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    // LaTeX 定界符与命令前缀：\frac、\times 这类命令名留下字母，但反斜杠本身要去掉
    .replace(/\$/g, '')
    .replace(/\\/g, '')
    // 括号（含全角）与书名/引号类成对符号
    .replace(/[()[\]{}<>《》「」『』【】（）]/g, '')
    .replace(/[，。、；：？！,.;:?!"'`~@#$%^&*_\-+=|/“”‘’…—]/g, '')
}

/** 字符二元组集合。中文不分词也能用它刻画「局部顺序」 */
export function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2))
  // 单字符串没有二元组，退化成它自己，否则空集合之间会算出 0
  if (out.size === 0 && s.length === 1) out.add(s)
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const x of small) if (big.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * 两道题的相似度 0–1。
 *
 * 短题干（归一化后不足 8 个字）不做模糊匹配，只认完全相同 ——
 * 二元组在短串上噪声极大，`求导` 和 `求积` 会长得很像。宁可漏报也不要误报：
 * 误报会让用户去合并两道**不同**的题，比重复更糟。
 */
export function similarity(a: string, b: string): number {
  const na = normalizeQuestion(a)
  const nb = normalizeQuestion(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (Math.min(na.length, nb.length) < 8) return 0
  return jaccard(bigrams(na), bigrams(nb))
}

/**
 * 在一批候选里找出和 `question` 疑似重复的。
 *
 * 性能上先用「长度比」粗筛：题干长度差三成以上，二元组 Jaccard 不可能高到阈值，
 * 直接跳过能免掉绝大多数无谓比较。
 */
export function findDuplicates(
  question: string,
  candidates: DedupCandidate[],
  threshold = DEFAULT_DUPLICATE_THRESHOLD,
  limit = 5
): DuplicateHit[] {
  const nq = normalizeQuestion(question)
  if (!nq) return []

  const hits: DuplicateHit[] = []
  for (const c of candidates) {
    const nc = normalizeQuestion(c.question)
    if (!nc) continue
    const maxLen = Math.max(nq.length, nc.length)
    if (maxLen > 0 && Math.abs(nq.length - nc.length) / maxLen > 0.3) continue
    const score = similarity(question, c.question)
    if (score < threshold) continue
    hits.push({
      id: c.id,
      score,
      subject: c.subject,
      created: c.created,
      status: c.status,
      reviewRound: c.reviewRound,
      questionHead: questionPreview(c.question),
      hasImage: c.hasImage
    })
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

/**
 * 整库查重：把候选按科目分组，组内两两比较，返回若干「互为重复」的组。
 *
 * 只比同科目：一道数学题和一道政治题不可能是同一题的两次截图，
 * 跨科目比较纯属浪费 —— 而且不同科目题干格式差异大，反而更容易误报。
 */
export function findDuplicateGroups(
  candidates: DedupCandidate[],
  threshold = DEFAULT_DUPLICATE_THRESHOLD
): DedupCandidate[][] {
  const bySubject = new Map<string, DedupCandidate[]>()
  for (const c of candidates) {
    const list = bySubject.get(c.subject) ?? []
    list.push(c)
    bySubject.set(c.subject, list)
  }

  const groups: DedupCandidate[][] = []
  for (const list of bySubject.values()) {
    // 并查集：A≈B、B≈C 时三道题应该在一组里，而不是两组
    const parent = list.map((_, i) => i)
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]]
        x = parent[x]
      }
      return x
    }
    const union = (x: number, y: number): void => {
      const rx = find(x)
      const ry = find(y)
      if (rx !== ry) parent[rx] = ry
    }

    const norm = list.map((c) => normalizeQuestion(c.question))
    for (let i = 0; i < list.length; i++) {
      if (norm[i].length < 8) continue
      for (let j = i + 1; j < list.length; j++) {
        if (norm[j].length < 8) continue
        const maxLen = Math.max(norm[i].length, norm[j].length)
        if (maxLen > 0 && Math.abs(norm[i].length - norm[j].length) / maxLen > 0.3) continue
        if (jaccard(bigrams(norm[i]), bigrams(norm[j])) >= threshold) union(i, j)
      }
    }

    const buckets = new Map<number, DedupCandidate[]>()
    for (let i = 0; i < list.length; i++) {
      const root = find(i)
      const b = buckets.get(root) ?? []
      b.push(list[i])
      buckets.set(root, b)
    }
    for (const b of buckets.values()) {
      if (b.length > 1) groups.push(b)
    }
  }

  // 组间按「重复最多的排前面」——用户最该先清掉这些
  groups.sort((a, b) => b.length - a.length)
  return groups
}

/** 把一个重复组转成界面用的命中列表；相似度以组内第一条为基准 */
export function groupToHits(group: DedupCandidate[]): DuplicateHit[] {
  const base = group[0]
  return group.map((c, i) => ({
    id: c.id,
    score: i === 0 ? 1 : similarity(base.question, c.question),
    subject: c.subject,
    created: c.created,
    status: c.status,
    reviewRound: c.reviewRound,
    questionHead: questionPreview(c.question),
    hasImage: c.hasImage
  }))
}
