/**
 * frontmatter 序列化与反序列化 —— 纯函数，可单元测试。
 *
 * 用 gray-matter（底层 js-yaml）而不是自己搓解析器：
 * 用户会手改这些文件，YAML 的引号、转义、多行、特殊字符都得正确往返，
 * 手写解析器在这种地方一定会出洞。
 */
import matter from 'gray-matter'
import type { Mistake, MistakeBody, QuestionType, ErrorType, Status } from '@shared/types'
import { QUESTION_TYPES, ERROR_TYPES, STATUSES } from '@shared/types'

const DEFAULT_SUBJECT = '未分类'
const DEFAULT_TYPE: QuestionType = '其他'
const DEFAULT_STATUS: Status = 'new'

/** 生成唯一 ID：YYYY-MM-DD-xxxxxx（6 位小写 hex） */
export function newId(date?: Date): string {
  const d = date ?? new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const rand = Math.floor(Math.random() * 0x1000000)
    .toString(16)
    .padStart(6, '0')
  return `${y}-${m}-${day}-${rand}`
}

/**
 * 取一个未被占用的 id。
 * 纯函数，占用情况由调用方注入 —— 这样"查重"这个关键行为可以被确定性地测试，
 * 而不是靠抽样去赌随机数不碰撞。
 */
export function pickUniqueId(
  isTaken: (id: string) => boolean,
  make: () => string = newId,
  maxTries = 20
): string {
  for (let i = 0; i < maxTries; i++) {
    const id = make()
    if (!isTaken(id)) return id
  }
  // 极端情况（id 空间被占满或 isTaken 恒真）：拼一个几乎不可能重复的后缀，
  // 宁可 id 难看，也不能覆盖掉已有错题。
  return `${make()}-${Date.now().toString(36)}`
}

/** 清理路径段；空或全非法字符时返回「未分类」 */
export function sanitizeSegment(s: string): string {
  const cleaned = (s ?? '')
    // Windows 非法文件名字符 + 控制字符
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || DEFAULT_SUBJECT
}

/* ────────────── 序列化 ────────────── */

const BODY_SECTIONS: Array<{ header: string; key: keyof MistakeBody; label: string }> = [
  { header: '## 题目', key: 'question', label: '题目' },
  { header: '## 我的思路', key: 'myThought', label: '我的思路' },
  { header: '## 正确解法', key: 'solution', label: '正确解法' },
  { header: '## 错因', key: 'cause', label: '错因' },
  { header: '## 变式', key: 'variant', label: '变式' }
]

export function mistakeToMarkdown(m: Mistake): string {
  // 与设计文档 §5.2 的键名一一对应
  const data: Record<string, unknown> = {
    id: m.id,
    created: m.created
  }
  if (m.updated) data.updated = m.updated
  if (m.source) data.source = m.source
  data.subject = m.subject
  data.chapter = m.chapter ?? []
  data.points = m.points ?? []
  data.type = m.type
  if (m.level != null) data.level = m.level
  if (m.myAnswer) data.my_answer = m.myAnswer
  if (m.rightAnswer) data.right_answer = m.rightAnswer
  if (m.errorType) data.error_type = m.errorType
  data.status = m.status
  data.confidence = m.confidence
  data.review = {
    last: m.review?.last ?? null,
    next: m.review?.next ?? null,
    round: m.review?.round ?? 0
  }
  if (m.llm) data.llm = { model: m.llm.model, at: m.llm.at }
  if (m.imagePath) data.image = m.imagePath

  const body = BODY_SECTIONS.filter((s) => (m.body?.[s.key] ?? '').trim().length > 0)
    .map((s) => `${s.header}\n\n${(m.body[s.key] as string).trim()}`)
    .join('\n\n')

  return matter.stringify(body ? `${body}\n` : '', data)
}

/* ────────────── 反序列化 ────────────── */

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrontmatterError'
  }
}

function asString(v: unknown, fallback = ''): string {
  if (v == null) return fallback
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

function asOptionalString(v: unknown): string | undefined {
  const s = asString(v).trim()
  return s ? s : undefined
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => asString(x).trim()).filter((s) => s.length > 0)
  }
  // 手改文件时可能写成逗号分隔的裸字符串
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  return []
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = asString(v).trim()
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback
}

function asOptionalEnum<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  const s = asString(v).trim()
  return (allowed as readonly string[]).includes(s) ? (s as T) : undefined
}

function asLevel(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number.parseInt(asString(v), 10)
  if (!Number.isFinite(n)) return undefined
  return Math.min(5, Math.max(1, Math.round(n)))
}

function asConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(asString(v))
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

export function markdownToMistake(raw: string): Mistake {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(raw)
  } catch (e) {
    throw new FrontmatterError(`frontmatter 解析失败：${e instanceof Error ? e.message : String(e)}`)
  }

  const d = parsed.data as Record<string, unknown>
  if (!d || Object.keys(d).length === 0) {
    throw new FrontmatterError('文件缺少 frontmatter')
  }
  const id = asString(d.id).trim()
  if (!id) throw new FrontmatterError('frontmatter 缺少 id')

  const reviewRaw = (d.review ?? {}) as Record<string, unknown>

  return {
    id,
    created: asString(d.created, new Date().toISOString()),
    updated: asOptionalString(d.updated),
    source: asOptionalString(d.source),
    subject: asString(d.subject, DEFAULT_SUBJECT).trim() || DEFAULT_SUBJECT,
    chapter: asStringArray(d.chapter),
    points: asStringArray(d.points),
    type: asEnum<QuestionType>(d.type, QUESTION_TYPES, DEFAULT_TYPE),
    level: asLevel(d.level),
    myAnswer: asOptionalString(d.my_answer),
    rightAnswer: asOptionalString(d.right_answer),
    errorType: asOptionalEnum<ErrorType>(d.error_type, ERROR_TYPES),
    status: asEnum<Status>(d.status, STATUSES, DEFAULT_STATUS),
    confidence: asConfidence(d.confidence),
    review: {
      last: asOptionalString(reviewRaw.last),
      next: asOptionalString(reviewRaw.next),
      round: Math.max(0, Number.parseInt(asString(reviewRaw.round, '0'), 10) || 0)
    },
    llm: parseLlm(d.llm),
    imagePath: asOptionalString(d.image),
    body: parseBodySections(parsed.content)
  }
}

function parseLlm(v: unknown): Mistake['llm'] {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const model = asString(o.model).trim()
  const at = asString(o.at).trim()
  return model && at ? { model, at } : undefined
}

function parseBodySections(content: string): MistakeBody {
  const body: MistakeBody = { question: '' }
  const byHeader = new Map(BODY_SECTIONS.map((s) => [s.header, s.key]))

  let current: keyof MistakeBody | null = null
  const buf: string[] = []

  const flush = (): void => {
    if (current && buf.length) {
      const text = buf.join('\n').trim()
      if (text) body[current] = text
    }
    buf.length = 0
  }

  for (const line of content.split('\n')) {
    // 只认整行的二级标题，避免把正文里的 ## 当成小节
    const key = byHeader.get(line.trim())
    if (key) {
      flush()
      current = key
    } else if (current) {
      buf.push(line)
    }
  }
  flush()

  return body
}

/** 错题相对仓库根的路径 */
export function mistakeRelPath(m: Mistake): string {
  const subject = sanitizeSegment(m.subject)
  const chapters = (m.chapter ?? []).map(sanitizeSegment).filter(Boolean)
  const parts = ['mistakes', subject, ...chapters, `${sanitizeSegment(m.id)}.md`]
  return parts.join('/')
}
