/**
 * 全局共享类型 —— 主进程与渲染进程的唯一契约。
 * 改动此文件等于改接口，两边都要跟。
 */

/* ────────────── 错题记录 ────────────── */

export const QUESTION_TYPES = ['单选', '多选', '填空', '计算', '证明', '简答', '其他'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

/** 受控错因词表 —— 不允许模型自由发挥，否则统计会碎成几十种近义写法 */
export const ERROR_TYPES = [
  '概念混淆',
  '计算失误',
  '审题错误',
  '记忆遗忘',
  '方法不会',
  '粗心',
  '时间不够'
] as const
export type ErrorType = (typeof ERROR_TYPES)[number]

export const STATUSES = ['new', 'reviewing', 'mastered'] as const
export type Status = (typeof STATUSES)[number]

export interface ReviewState {
  /** 上次复习日期 YYYY-MM-DD */
  last?: string
  /** 下次到期日期 YYYY-MM-DD */
  next?: string
  /** 已复习轮次 */
  round: number
}

/** 正文各小节，均允许内联/块级 LaTeX */
export interface MistakeBody {
  question: string
  myThought?: string
  solution?: string
  cause?: string
  variant?: string
}

/** 一道错题的完整记录（不含原始截图二进制） */
export interface Mistake {
  id: string
  created: string
  updated?: string
  /** 来源描述，如「王道《数据结构》p.42 第08题」 */
  source?: string
  subject: string
  chapter: string[]
  points: string[]
  type: QuestionType
  /** 难度 1–5 */
  level?: number
  myAnswer?: string
  rightAnswer?: string
  errorType?: ErrorType
  status: Status
  /** 模型对本次识别的自评置信度 0–1；低值强制人工确认 */
  confidence: number
  review: ReviewState
  llm?: { model: string; at: string }
  /** 相对 vault 的图片路径，如 assets/2026-09-13-a3f2.png */
  imagePath?: string
  body: MistakeBody
  /** 未知的 frontmatter 键（往返保留用，不影响业务逻辑） */
  _extra?: Record<string, unknown>
  /** 未知的 body 节（往返保留用，不影响业务逻辑） */
  _extraBody?: string[]
}

/** 列表用的轻量视图 */
export type MistakeSummary = Pick<
  Mistake,
  | 'id'
  | 'created'
  | 'subject'
  | 'chapter'
  | 'points'
  | 'type'
  | 'errorType'
  | 'status'
  | 'level'
  | 'confidence'
  | 'review'
> & {
  /**
   * 题干预览。**是 Markdown 片段**（含 `$...$` 公式）——
   * 渲染时必须走 Markdown 组件，直接当纯文本显示会把美元符号原样露出来。
   */
  questionHead: string
  imagePath?: string
}

/* ────────────── LLM 抽取结果 ────────────── */

/** 视觉模型从截图里读出的结构化结果（未经人工确认） */
export interface Extraction {
  subject: string
  chapter: string[]
  points: string[]
  type: QuestionType
  level?: number
  myAnswer?: string
  rightAnswer?: string
  errorType?: ErrorType
  confidence: number
  source?: string
  body: MistakeBody
}

/** 保存新错题时提交的内容 */
export interface MistakeInput {
  extraction: Extraction
  /** 已落盘的图片绝对路径 */
  imageAbsPath?: string
}

/* ────────────── 模型配置 ────────────── */

/** 功能位：采集识别 / 错因分析 / 变式出题 / 考点排行 */
export const FEATURE_KEYS = ['capture', 'analyze', 'generate', 'forecast'] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

/** OpenAI 兼容协议 */
export type ApiFormat = 'openai' | 'anthropic'

export interface ProviderConfig {
  id: string
  label: string
  /**
   * 端点根地址。约定：
   * - format=openai    → 聊天走 `${baseUrl}/chat/completions`，模型列表走 `${baseUrl}/models`
   * - format=anthropic → 聊天走 `${baseUrl}/v1/messages`，模型列表走 `${baseUrl}/v1/models`
   * 所以有的厂商 baseUrl 要带 `/v1`，有的不要，取决于对方怎么挂的。
   */
  baseUrl: string
  /** 协议格式，缺省按 openai 兼容处理 */
  format?: ApiFormat
  /** 附加请求头，例如 OpenCode Go 要求的 x-opencode-session */
  headers?: Record<string, string>
}

export interface ModelInfo {
  id: string
  label?: string
}

export interface ModelChoice {
  provider: string
  model: string
  /** 该模型是否支持图片输入 */
  vision?: boolean
}

export interface PublicModelConfig {
  providers: ProviderConfig[]
  /** 哪些 provider 已配置 key（不回传 key 本身） */
  keysSet: Record<string, boolean>
  /** 全局默认 */
  default: ModelChoice
  /** 按功能覆盖，缺省则回落到 default */
  features: Partial<Record<FeatureKey, ModelChoice>>
}

/* ────────────── 统计 / 分析 ────────────── */

export interface CountItem {
  key: string
  count: number
}

export interface StatsOverview {
  total: number
  bySubject: CountItem[]
  byErrorType: CountItem[]
  byPoint: CountItem[]
  byChapter: CountItem[]
  byStatus: CountItem[]
  /** 最近 N 天每日新增，用于错误量时间曲线 */
  daily: { date: string; count: number }[]
  /** 待复习数量 */
  dueCount: number
}

export interface TopicRank {
  point: string
  /** 你的错题数 */
  mistakes: number
  /** 综合热度分（错题数 × 考纲/真题权重） */
  score: number
  reason: string
}

/* ────────────── 复习评分 ────────────── */

export const GRADES = ['again', 'hard', 'good', 'easy'] as const
export type Grade = (typeof GRADES)[number]

/* ────────────── 复习会话 ────────────── */

/** 出题顺序 */
export const REVIEW_ORDERS = ['due', 'random', 'created', 'difficulty'] as const
export type ReviewOrder = (typeof REVIEW_ORDERS)[number]

/** 复习模式：只过到期的，还是忽略到期日主动刷某个范围 */
export const REVIEW_MODES = ['due', 'all'] as const
export type ReviewMode = (typeof REVIEW_MODES)[number]

/**
 * 一次复习请求。
 *
 * 「换一批」之所以以前没用，是因为它没有"批"的概念 —— 每次都是把全部到期项
 * 重新查一遍再跳回第一题。这里用 limit/offset 把批次显式化。
 */
export interface ReviewQuery {
  /** 范围过滤，复用列表页的筛选结构 */
  scope?: ListFilter
  mode: ReviewMode
  order: ReviewOrder
  /** 一批多少题；0 表示不限 */
  limit: number
  /** 从第几题开始取（「换一批」就是 offset += limit） */
  offset: number
  /** 只看带原图的 */
  onlyWithImage?: boolean
  /**
   * 只做这些 id（按给定顺序）。
   * 「再做一遍这一批」靠它实现 —— 那批题刚评过分、已经不到期了，
   * 单靠 mode:'due' 重查只会拿到 0 条。
   */
  ids?: string[]
}

export interface ReviewBatch {
  items: MistakeSummary[]
  /** 命中范围的总数（不受 limit/offset 影响），用于「第 x–y 题 / 共 n 题」 */
  total: number
  /** 本批实际是第一题到第几题 */
  from: number
  to: number
}

/* ────────────── 分析记录 ────────────── */

export const ANALYSIS_KINDS = ['forecast', 'patterns'] as const
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number]

/** 一次分析的结果，落盘成 Markdown 存在 vault 的 analyses/ 下 */
export interface AnalysisRecord {
  id: string
  kind: AnalysisKind
  /** ISO 时间戳 */
  createdAt: string
  title: string
  markdown: string
}

/** 列表用的轻量视图 */
export type AnalysisSummary = Omit<AnalysisRecord, 'markdown'> & {
  /** 正文首行摘要 */
  head: string
  /** 当时有几道错题参与了分析 */
  mistakeCount?: number
}

/** 复习偏好，持久化到设置里，下次打开保持 */
export interface ReviewPrefs {
  scope?: ListFilter
  mode: ReviewMode
  order: ReviewOrder
  limit: number
  onlyWithImage?: boolean
}

/* ────────────── 通用 ────────────── */

/** 杂项应用设置（与模型配置分开） */
export interface AppSettings {
  /** 考试日期 YYYY-MM-DD。复习排程是"带 deadline 的调度"，不设它就退化成普通间隔重复 */
  examDate?: string
  /** 全局热键加速器，如 Alt+Shift+A */
  hotkey: string
  /** 统计曲线保留最近多少天 */
  statsWindowDays: number
  /** 识别成功后自动保存等待秒数（0 = 不自动保存） */
  autoSaveSeconds?: number
  /** 开机自启。默认 false，常驻托盘时应该允许用户设置为 true */
  autoStart?: boolean
  /** 复习偏好（范围 / 模式 / 顺序 / 批大小），下次打开保持 */
  reviewPrefs?: ReviewPrefs
}

export interface Result<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface ListFilter {
  subject?: string
  chapter?: string
  point?: string
  errorType?: ErrorType
  status?: Status
  /** 全文关键词 */
  q?: string
  limit?: number
  offset?: number
}
