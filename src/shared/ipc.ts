/**
 * IPC 契约 —— 渲染进程通过 window.api 调用主进程。
 * 通道名集中在此，禁止在别处硬编码字符串。
 */
import type {
  AppSettings,
  Extraction,
  FeatureKey,
  Grade,
  ListFilter,
  Mistake,
  MistakeInput,
  MistakeSummary,
  ModelChoice,
  ProviderConfig,
  PublicModelConfig,
  Result,
  StatsOverview,
  TopicRank
} from './types'

export const IPC = {
  /** 触发框选截图（也会被全局热键触发） */
  captureStart: 'capture:start',
  /** 主进程 → 渲染进程：截图完成 */
  captureCaptured: 'capture:captured',
  /** 主进程 → 渲染进程：请求打开录入确认窗 */
  captureOpenComposer: 'capture:openComposer',

  extract: 'llm:extract',

  mistakeSave: 'mistake:save',
  mistakeList: 'mistake:list',
  mistakeGet: 'mistake:get',
  mistakeUpdate: 'mistake:update',
  mistakeDelete: 'mistake:delete',

  reviewDue: 'review:due',
  reviewGrade: 'review:grade',

  statsOverview: 'stats:overview',
  analysisErrorPatterns: 'analysis:errorPatterns',
  generateVariants: 'generate:variants',
  forecastTopics: 'forecast:topics',

  configGet: 'config:get',
  configSetChoice: 'config:setChoice',
  configSetProviderKey: 'config:setProviderKey',
  configUpsertProvider: 'config:upsertProvider',
  configTest: 'config:test',

  vaultGet: 'vault:get',
  vaultChoose: 'vault:choose',
  indexRebuild: 'index:rebuild',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  /** 取某张图片的可显示 URL（自定义协议） */
  assetUrl: 'asset:url'
} as const

export interface CapturePayload {
  /** 主进程已落盘的临时图片绝对路径 */
  imageAbsPath: string
  /** 便于立即预览的 data URL 缩略图 */
  thumbDataUrl: string
}

/** 暴露给渲染进程的 API（preload 实现，见 src/preload/index.ts） */
export interface Api {
  captureStart(): Promise<Result<null>>
  onCaptured(cb: (p: CapturePayload) => void): () => void
  onOpenComposer(cb: () => void): () => void

  extract(imageAbsPath: string): Promise<Result<Extraction>>
  extractFromClipboard(): Promise<Result<CapturePayload>>

  save(input: MistakeInput): Promise<Result<{ id: string }>>
  list(filter: ListFilter): Promise<Result<MistakeSummary[]>>
  get(id: string): Promise<Result<Mistake>>
  update(id: string, patch: Partial<Mistake>): Promise<Result<null>>
  remove(id: string): Promise<Result<null>>

  due(): Promise<Result<MistakeSummary[]>>
  grade(id: string, grade: Grade): Promise<Result<null>>

  stats(): Promise<Result<StatsOverview>>
  errorPatterns(filter?: ListFilter): Promise<Result<string>>
  variants(id: string, n?: number): Promise<Result<string>>
  forecast(): Promise<Result<TopicRank[]>>

  configGet(): Promise<Result<PublicModelConfig>>
  configSetChoice(feature: FeatureKey | 'default', choice: ModelChoice): Promise<Result<null>>
  configSetProviderKey(providerId: string, apiKey: string): Promise<Result<null>>
  configUpsertProvider(p: ProviderConfig): Promise<Result<null>>
  configTest(choice: ModelChoice): Promise<Result<{ latencyMs: number; echo: string }>>

  vaultGet(): Promise<Result<string>>
  vaultChoose(): Promise<Result<string>>
  indexRebuild(): Promise<Result<{ count: number }>>

  settingsGet(): Promise<Result<AppSettings>>
  settingsSet(patch: Partial<AppSettings>): Promise<Result<AppSettings>>

  assetUrl(relPath: string): string
}

declare global {
  interface Window {
    api: Api
  }
}
