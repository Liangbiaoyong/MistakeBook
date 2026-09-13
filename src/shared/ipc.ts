/**
 * IPC 契约 —— 渲染进程通过 window.api 调用主进程。
 * 通道名集中在此，禁止在别处硬编码字符串。
 */
import type {
  AnalysisRecord,
  AnalysisSummary,
  AppSettings,
  Extraction,
  FeatureKey,
  Grade,
  ListFilter,
  Mistake,
  MistakeInput,
  MistakeSummary,
  ModelChoice,
  ModelInfo,
  ProviderConfig,
  PublicModelConfig,
  Result,
  ReviewBatch,
  ReviewQuery,
  ReviewState,
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

  /** 主进程 → 渲染进程：用户可见的提示信息 */
  appNotify: 'app:notify',

  extract: 'llm:extract',

  mistakeSave: 'mistake:save',
  mistakeList: 'mistake:list',
  mistakeGet: 'mistake:get',
  mistakeUpdate: 'mistake:update',
  mistakeDelete: 'mistake:delete',
  /** 按当前筛选导出为一份 Markdown（考前打印/别的设备上翻） */
  mistakeExport: 'mistake:export',

  reviewQuery: 'review:query',
  reviewGrade: 'review:grade',

  statsOverview: 'stats:overview',
  analysisErrorPatterns: 'analysis:errorPatterns',
  generateVariants: 'generate:variants',
  forecastTopics: 'forecast:topics',

  /** 分析记录留档 */
  analysisList: 'analysis:list',
  analysisGet: 'analysis:get',
  analysisRemove: 'analysis:remove',

  configGet: 'config:get',
  configSetChoice: 'config:setChoice',
  configSetProviderKey: 'config:setProviderKey',
  configUpsertProvider: 'config:upsertProvider',
  configRemoveProviderKey: 'config:removeProviderKey',
  configTest: 'config:test',
  configListModels: 'config:listModels',

  vaultGet: 'vault:get',
  vaultChoose: 'vault:choose',
  indexRebuild: 'index:rebuild',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  /** 取某张图片的可显示 URL（自定义协议） */
  assetUrl: 'asset:url',

  /** 通知窗口：主进程 → 通知窗口，推送任务状态 */
  notifyState: 'notify:state',
  /** 通知窗口：通知窗口 → 主进程，用户点击按钮 */
  notifyAction: 'notify:action',
  /** 通知窗口：主窗口渲染进程 → 主进程，推送任务列表 */
  notifySync: 'notify:sync',
  /** 通知窗口：主进程 → 主窗口渲染进程，转发按钮操作 */
  notifyCommand: 'notify:command'
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
  /** 主进程推来的用户可见提示 */
  onNotify(cb: (msg: string) => void): () => void

  extract(imageAbsPath: string): Promise<Result<Extraction>>
  extractFromClipboard(): Promise<Result<CapturePayload>>

  save(input: MistakeInput): Promise<Result<{ id: string }>>
  list(filter: ListFilter): Promise<Result<MistakeSummary[]>>
  get(id: string): Promise<Result<Mistake>>
  update(id: string, patch: Partial<Mistake>): Promise<Result<null>>
  remove(id: string): Promise<Result<null>>
  /** 导出当前筛选下的错题为 Markdown；返回落盘路径与条数（取消时 count=0） */
  exportMarkdown(filter?: ListFilter): Promise<Result<{ path: string; count: number; canceled: boolean }>>

  /** 按范围 / 模式 / 顺序 / 批次取一组复习题目（「换一批」靠 offset 前进） */
  reviewQuery(query: ReviewQuery): Promise<Result<ReviewBatch>>
  grade(id: string, grade: Grade): Promise<Result<ReviewState>>

  stats(): Promise<Result<StatsOverview>>
  errorPatterns(filter?: ListFilter): Promise<Result<string>>
  variants(id: string, n?: number): Promise<Result<string>>
  /** 分析完成后会自动留档，saved 是这次记录（含分析时间） */
  forecast(): Promise<Result<{ topics: TopicRank[]; saved: AnalysisSummary | null }>>

  /** 历史分析记录 */
  analysisList(): Promise<Result<AnalysisSummary[]>>
  analysisGet(id: string): Promise<Result<AnalysisRecord>>
  analysisRemove(id: string): Promise<Result<null>>

  configGet(): Promise<Result<PublicModelConfig>>
  configSetChoice(feature: FeatureKey | 'default', choice: ModelChoice): Promise<Result<null>>
  configSetProviderKey(providerId: string, apiKey: string): Promise<Result<null>>
  configRemoveProviderKey(providerId: string): Promise<Result<null>>
  configUpsertProvider(p: ProviderConfig): Promise<Result<null>>
  configTest(choice: ModelChoice): Promise<Result<{ latencyMs: number; echo: string }>>
  /** 向厂商拉取可用模型列表；对方不支持时会返回错误说明 */
  configListModels(providerId: string): Promise<Result<ModelInfo[]>>

  vaultGet(): Promise<Result<string>>
  vaultChoose(): Promise<Result<string>>
  indexRebuild(): Promise<Result<{ count: number }>>

  settingsGet(): Promise<Result<AppSettings>>
  settingsSet(patch: Partial<AppSettings>): Promise<Result<AppSettings>>

  assetUrl(relPath: string): string

  /** 通知窗口：推送任务状态到主进程 */
  notifySync(tasks: Array<{
    id: string
    status: string
    extraction?: {
      subject?: string
      knowledgePoints?: string[]
    } | null
    remaining?: number
    error?: string
    payload?: {
      imageAbsPath: string
    }
  }>): Promise<Result<null>>

  /** 通知窗口：监听按钮操作命令 */
  onNotifyCommand(cb: (cmd: { taskId: string; action: string }) => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}
