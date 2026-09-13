/**
 * 后台识别浮动组件 —— 底部右下角显示正在进行的截图识别任务栈。
 * 每个任务独立管理状态：recognizing → ready → saving → saved / error
 */
import type { Extraction } from '@shared/types'
import type { CapturePayload } from '@shared/ipc'
import Markdown from './Markdown'
import { Icon, cuCtaPrimary, cuCtaGhost, cuNotice } from '../design/tokens'

export interface CaptureTask {
  id: string
  payload: CapturePayload
  status: 'recognizing' | 'ready' | 'saving' | 'saved' | 'error'
  extraction?: Extraction
  error?: string
  remaining?: number
  /** 保存成功后返回的错题 id，用于撤销 */
  savedId?: string
}

interface CaptureWidgetProps {
  tasks: CaptureTask[]
  onSave: (id: string) => void
  onEdit: (id: string) => void
  onDiscard: (id: string) => void
  onRetry: (id: string) => void
  onUndoSave: (taskId: string, savedId: string) => void
  onNavigateSettings: () => void
}

export default function CaptureWidget({ tasks, onSave, onEdit, onDiscard, onRetry, onUndoSave, onNavigateSettings }: CaptureWidgetProps): React.JSX.Element {
  if (tasks.length === 0) return <></>

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex w-[340px] flex-col gap-3">
      {tasks.map(task => (
        <TaskCard
          key={task.id}
          task={task}
          onSave={onSave}
          onEdit={onEdit}
          onDiscard={onDiscard}
          onRetry={onRetry}
          onUndoSave={onUndoSave}
          onNavigateSettings={onNavigateSettings}
        />
      ))}
    </div>
  )
}

function TaskCard({
  task,
  onSave,
  onEdit,
  onDiscard,
  onRetry,
  onUndoSave,
  onNavigateSettings
}: {
  task: CaptureTask
  onSave: (id: string) => void
  onEdit: (id: string) => void
  onDiscard: (id: string) => void
  onRetry: (id: string) => void
  onUndoSave: (taskId: string, savedId: string) => void
  onNavigateSettings: () => void
}): React.JSX.Element {
  const { id, status, extraction, error, remaining, payload, savedId } = task

  return (
    <div
      className="pointer-events-auto rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm transition-all duration-200 ease-out"
      role="status"
      aria-label={`截图任务：${status === 'recognizing' ? '正在识别' : status === 'ready' ? '识别完成' : status === 'saving' ? '正在保存' : status === 'saved' ? '已保存' : '出错'}`}
    >
      {/* 缩略图 */}
      <div className="mb-3 flex items-start gap-3">
        <img
          src={payload.thumbDataUrl}
          alt="截图预览"
          className="h-12 w-12 shrink-0 rounded-xl object-cover border border-white/10"
        />
        <div className="flex-1 min-w-0">
          {/* recognizing 状态 */}
          {status === 'recognizing' && (
            <RecognizingState />
          )}

          {/* ready 状态 */}
          {status === 'ready' && extraction && (
            <ReadyState
              extraction={extraction}
              remaining={remaining}
            />
          )}

          {/* saving 状态 */}
          {status === 'saving' && (
            <SavingState />
          )}

          {/* saved 状态 */}
          {status === 'saved' && savedId && (
            <SavedState onUndo={() => onUndoSave(id, savedId)} />
          )}

          {/* error 状态 */}
          {status === 'error' && error && (
            <ErrorState
              error={error}
              onRetry={() => onRetry(id)}
              onDiscard={() => onDiscard(id)}
              onNavigateSettings={onNavigateSettings}
            />
          )}
        </div>
      </div>

      {/* 操作按钮 —— ready 状态下显示 */}
      {status === 'ready' && (
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => onSave(id)}
            className={`${cuCtaPrimary} flex-1 !px-3 !py-1.5 text-xs`}
          >
            <Icon name="check" className="h-3 w-3" />
            保存
          </button>
          <button
            type="button"
            onClick={() => onEdit(id)}
            className={`${cuCtaGhost} flex-1 !px-3 !py-1.5 text-xs`}
          >
            <Icon name="edit" className="h-3 w-3" />
            编辑
          </button>
          <button
            type="button"
            onClick={() => onDiscard(id)}
            className={`${cuCtaGhost} !px-2 !py-1.5 text-xs text-white/60 hover:text-coral`}
            aria-label="丢弃"
          >
            <Icon name="trash" className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

/** 正在识别状态 */
function RecognizingState(): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded-full border-2 border-white/20 border-t-mint animate-spin" />
        <span className="text-xs text-white/70">正在识别…</span>
      </div>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 w-[60%] rounded-full bg-mint"
          style={{ animation: 'cu-progress-sweep 1.5s ease-in-out infinite' }}
        />
      </div>
    </div>
  )
}

/** 识别完成状态 */
function ReadyState({
  extraction,
  remaining
}: {
  extraction: Extraction
  remaining?: number
}): React.JSX.Element {
  const questionHead = extraction.body.question
    ? extraction.body.question.slice(0, 120)
    : ''

  const isLowConfidence = extraction.confidence < 0.75

  return (
    <div className="space-y-2">
      {/* 科目 · 章节 · 知识点 */}
      <div className="text-xs text-white/60">
        {[extraction.subject, ...extraction.chapter, ...extraction.points].filter(Boolean).join(' · ')}
      </div>

      {/* 题干预览 — 使用 Markdown 渲染，绝不能当纯文本显示 */}
      {questionHead && (
        <div className="text-sm text-white/90 line-clamp-2">
          <Markdown source={questionHead} className="!p-0 !bg-transparent !border-none" />
        </div>
      )}

      {/* 低置信度提示 */}
      {isLowConfidence && (
        <div className="text-xs text-sun">
          置信度 {Math.round(extraction.confidence * 100)}%，请核对后再保存
        </div>
      )}

      {/* 自动保存倒计时 */}
      {remaining !== undefined && remaining > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-mint">{remaining} 秒后自动保存</div>
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-mint transition-all duration-1000 ease-linear"
              style={{ width: `${(remaining / 30) * 100}%` }}
            />
          </div>
        </div>
      )}

      {remaining === 0 && (
        <div className="text-xs text-mint">正在保存…</div>
      )}
    </div>
  )
}

/** 正在保存状态 */
function SavingState(): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded-full border-2 border-white/20 border-t-white animate-spin" />
        <span className="text-xs text-white/70">正在保存…</span>
      </div>
    </div>
  )
}

/** 保存成功状态 — 带撤销按钮 */
function SavedState({ onUndo }: { onUndo: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon name="check" className="h-4 w-4 text-mint" />
        <span className="text-xs text-mint">已保存</span>
      </div>
      <button
        type="button"
        onClick={onUndo}
        className={`${cuCtaGhost} !px-2.5 !py-1 !text-[11px] !rounded-full`}
      >
        撤销
      </button>
    </div>
  )
}

/** 出错状态 */
function ErrorState({
  error,
  onRetry,
  onDiscard,
  onNavigateSettings
}: {
  error: string
  onRetry: () => void
  onDiscard: () => void
  onNavigateSettings: () => void
}): React.JSX.Element {
  const hasSettingsHint = error.includes('设置')

  return (
    <div className="space-y-3">
      <div className={`${cuNotice('error')} !px-3 !py-2 text-xs`}>
        <span>{error}</span>
        {hasSettingsHint && (
          <button
            type="button"
            onClick={onNavigateSettings}
            className="ml-2 underline text-white/80 hover:text-white"
          >
            去设置
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className={`${cuCtaPrimary} flex-1 !px-3 !py-1.5 text-xs`}
        >
          <Icon name="refresh" className="h-3 w-3" />
          重试
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className={`${cuCtaGhost} flex-1 !px-3 !py-1.5 text-xs`}
        >
          丢弃
        </button>
      </div>
    </div>
  )
}
