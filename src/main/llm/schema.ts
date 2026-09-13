/**
 * Zod schema 定义 - 验证所有 LLM 输出
 * 模型返回的是不可信输入，必须经过 schema 验证后才能使用
 */
import { z } from 'zod'
import { ERROR_TYPES, QUESTION_TYPES, STATUSES } from '@shared/types'
import type { ErrorType, QuestionType } from '@shared/types'

// ── 基础 schema ──

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
  question: z.string().min(1),
  myThought: z.string().optional(),
  solution: z.string().optional(),
  cause: z.string().optional(),
  variant: z.string().optional()
})

// ── LLM 抽取结果 ──

/**
 * 视觉模型从截图中提取的结构化数据
 * confidence 为 0..1，chapter 和 points 默认空数组
 */
export const ExtractionSchema = z.object({
  subject: z.string().min(1),
  chapter: z.array(z.string()).default([]),
  points: z.array(z.string()).default([]),
  type: QuestionTypeSchema,
  level: z.number().min(1).max(5).optional(),
  myAnswer: z.string().optional(),
  rightAnswer: z.string().optional(),
  errorType: ErrorTypeSchema.optional(),
  confidence: z.number().min(0).max(1),
  source: z.string().optional(),
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
