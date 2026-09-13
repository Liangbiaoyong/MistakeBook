/**
 * Zod schema 定义 - 验证所有 LLM 输出
 * 模型返回的是不可信输入，必须经过 schema 验证后才能使用
 */
import { z } from 'zod'
import { ERROR_TYPES, QUESTION_TYPES, STATUSES } from '@shared/types'
import type { ErrorType, QuestionType } from '@shared/types'

// ── 基础 schema ──

/**
 * 模型常把「不知道」写成字符串 "undefined" / "null" / "N/A" / "无" 而不是 null。
 * 这类哨兵值必须在入库前清掉 —— 否则会原样存进 Markdown，界面上就显示成 "undefined"。
 * （实测就踩过：`source: undefined` 与正文里一整段 `undefined`。）
 */
const SENTINELS = new Set([
  'undefined', 'null', 'nil', 'none', 'nan', 'n/a', 'na', 'not available',
  '-', '--', '—', '无', '没有', '未知', '不知道', '不详', '空', 'null值'
])

export function cleanOptional(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'object') return undefined
  const s = String(v).trim()
  if (!s) return undefined
  if (SENTINELS.has(s.toLowerCase())) return undefined
  return s
}

/** 清洗后仍为空就丢掉的字符串字段 */
const OptionalText = z.preprocess(cleanOptional, z.string().optional())

/** 数组元素也逐个清洗，去掉模型塞进来的哨兵值 */
const TextArray = z.preprocess(
  (v) => {
    const arr = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : []
    return arr.map(cleanOptional).filter((x): x is string => !!x)
  },
  z.array(z.string())
)

/** 题干：清洗后若为空，给一个占位而不是让整次识别失败（截图别丢） */
const QuestionText = z.preprocess(
  (v) => cleanOptional(v) ?? '(未能识别题干，请手动补上)',
  z.string()
)

/** 题型枚举 - 模型返回值外的一律落到「其他」 */
export const QuestionTypeSchema = z.enum(QUESTION_TYPES).catch((): QuestionType => '其他')

/** 错因枚举 - 模型返回值外的一律落到「审题错误」 */
export const ErrorTypeSchema = z.enum(ERROR_TYPES).catch((): ErrorType => '审题错误')

/** 状态枚举 */
export const StatusSchema = z.enum(STATUSES)

/** 复习状态 */
export const ReviewStateSchema = z.object({
  last: z.string().optional(),
  next: z.string().optional(),
  round: z.number().min(0)
})

/** 错题正文各小节 */
export const MistakeBodySchema = z.object({
  question: QuestionText,
  myThought: OptionalText,
  solution: OptionalText,
  cause: OptionalText,
  variant: OptionalText
})

// ── LLM 抽取结果 ──

/**
 * 视觉模型从截图中提取的结构化数据
 * confidence 为 0..1，chapter 和 points 默认空数组
 */
export const ExtractionSchema = z.object({
  subject: z.preprocess((v) => cleanOptional(v) ?? '未分类', z.string()),
  chapter: TextArray,
  points: TextArray,
  type: QuestionTypeSchema,
  level: z.number().min(1).max(5).optional(),
  myAnswer: OptionalText,
  rightAnswer: OptionalText,
  errorType: ErrorTypeSchema.optional(),
  confidence: z.number().min(0).max(1),
  source: OptionalText,
  body: MistakeBodySchema
})

export type ExtractedQuestion = z.infer<typeof ExtractionSchema>

// ── 变式题 ──

/** 单个变式题 */
export const VariantItemSchema = z.object({
  stem: z.string().min(1),
  answer: z.string().optional(),
  note: z.string().optional()
})

/** 变式题输出 */
export const VariantsSchema = z.object({
  variants: z.array(VariantItemSchema)
})

export type VariantResult = z.infer<typeof VariantsSchema>

// ── 考点排行 ──

/** 单个考点热度 */
export const TopicRankItemSchema = z.object({
  point: z.string().min(1),
  mistakes: z.number().min(0),
  score: z.number().min(0),
  reason: z.string().min(1)
})

/** 考点排行输出 */
export const ForecastSchema = z.object({
  topics: z.array(TopicRankItemSchema)
})

export type ForecastResult = z.infer<typeof ForecastSchema>
