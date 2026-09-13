/**
 * 录入确认窗 — 截图后确认并保存错题
 */
import { useCallback, useEffect, useState } from 'react'
import type { CapturePayload } from '@shared/ipc'
import type { Extraction, MistakeBody } from '@shared/types'
import { QUESTION_TYPES, ERROR_TYPES } from '@shared/types'
import Markdown from '../components/Markdown'
import { cuCard, cuCtaPrimary, cuCtaGhost, cuNotice, Icon } from '../design/tokens'
import { useModal } from '../lib/useModal'

interface ComposerProps {
  payload: CapturePayload
  initial?: Extraction
  onClose: () => void
}

interface FormState {
  subject: string
  chapter: string[]
  points: string[]
  type: string
  level: number
  myAnswer: string
  rightAnswer: string
  errorType: string
  source: string
  body: MistakeBody
}

export default function Composer({ payload, initial, onClose }: ComposerProps): React.JSX.Element {
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>({
    subject: '',
    chapter: [],
    points: [],
    type: '单选',
    level: 3,
    myAnswer: '',
    rightAnswer: '',
    errorType: '',
    source: '',
    body: { question: '', myThought: '', solution: '', cause: '' }
  })

  const [hasChanges, setHasChanges] = useState(false)

  const { containerRef, trapFocus } = useModal({
    open: true,
    onClose,
    confirmOnEsc: hasChanges
  })

  /* ── 调用 LLM 提取（仅在未提供 initial 时执行） ──────────────────────────────────── */
  useEffect(() => {
    if (initial) {
      setExtraction(initial)
      setForm({
        subject: initial.subject,
        chapter: initial.chapter ?? [],
        points: initial.points ?? [],
        type: initial.type,
        level: initial.level ?? 3,
        myAnswer: initial.myAnswer ?? '',
        rightAnswer: initial.rightAnswer ?? '',
        errorType: initial.errorType ?? '',
        source: initial.source ?? '',
        body: initial.body ?? { question: '' }
      })
      setLoading(false)
      setExtracting(false)
      return
    }

    let cancelled = false

    const run = async () => {
      setLoading(true)
      setExtracting(true)
      const r = await window.api.extract(payload.imageAbsPath)
      setExtracting(false)
      if (cancelled) return

      if (r.ok && r.data) {
        setExtraction(r.data)
        setForm({
          subject: r.data.subject,
          chapter: r.data.chapter ?? [],
          points: r.data.points ?? [],
          type: r.data.type,
          level: r.data.level ?? 3,
          myAnswer: r.data.myAnswer ?? '',
          rightAnswer: r.data.rightAnswer ?? '',
          errorType: r.data.errorType ?? '',
          source: r.data.source ?? '',
          body: r.data.body ?? { question: '' }
        })
      } else {
        setError(r.error ?? '识别失败，请手动填写')
      }
      setLoading(false)
    }

    void run()
    return () => { cancelled = true }
  }, [payload.imageAbsPath, initial])

  /* ── 更新表单 ──────────────────────────────────── */
  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm(prev => ({ ...prev, [key]: value }))
      setHasChanges(true)
    },
    []
  )

  const updateBody = useCallback(
    (key: keyof MistakeBody, value: string) => {
      setForm(prev => ({
        ...prev,
        body: { ...prev.body, [key]: value }
      }))
      setHasChanges(true)
    },
    []
  )

  /* ── 保存 ──────────────────────────────────────── */
  const handleSave = async () => {
    setSaving(true)
    const r = await window.api.save({
      extraction: {
        subject: form.subject,
        chapter: form.chapter,
        points: form.points,
        type: form.type as Extraction['type'],
        level: form.level,
        myAnswer: form.myAnswer || undefined,
        rightAnswer: form.rightAnswer || undefined,
        errorType: form.errorType as Extraction['errorType'] || undefined,
        source: form.source || undefined,
        confidence: extraction?.confidence ?? 1,
        body: form.body
      },
      imageAbsPath: payload.imageAbsPath
    })
    setSaving(false)
    if (r.ok) {
      onClose()
    } else {
      setError(r.error ?? '保存失败，请重试')
    }
  }

  /* ── 轻量预览用的 body 文本 ──────────────────────────── */
  const previewText = [
    form.body.question && `## 题目\n${form.body.question}`,
    form.body.myThought && `## 我的思路\n${form.body.myThought}`,
    form.body.solution && `## 正确解法\n${form.body.solution}`,
    form.body.cause && `## 错因\n${form.body.cause}`
  ].filter(Boolean).join('\n\n')

  /* ── 渲染 ──────────────────────────────────────── */
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="录入确认"
      onKeyDown={(e) => {
        trapFocus(e)
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault()
          if (!saving && !loading) void handleSave()
        }
      }}
    >
      <div className={`${cuCard()} relative max-h-[90vh] w-full max-w-3xl overflow-y-auto p-8`}>
        {/* 进度条（仅在识别中显示） */}
        {extracting && <div className="cu-progress-bar" />}

        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 cu-btn-sm text-white/60 hover:text-white"
          aria-label="关闭"
        >
          <Icon name="close" className="h-5 w-5" />
        </button>

        <h2 className="mb-6 font-display text-xl font-bold text-white">确认录入</h2>

        {/* 错误横幅 */}
        {error && (
          <div className={`${cuNotice('error')} mb-4`}>
            <span>{error}</span>
          </div>
        )}

        {/* 低信心度警告 — 强制显示 */}
        {extraction && extraction.confidence < 0.75 && (
          <div className={`${cuNotice('warn')} mb-4 flex items-start gap-3`}>
            <Icon name="brain" className="h-5 w-5 shrink-0 text-sun mt-0.5" />
            <p>
              模型对这次识别信心较低（{Math.round(extraction.confidence * 100)}%），请重点核对题干与答案
            </p>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* 左侧：缩略图 */}
          <div className="shrink-0 lg:w-1/3">
            <img
              src={payload.thumbDataUrl}
              alt="截图预览"
              className={`w-full rounded-2xl border border-white/20 ${extracting ? 'cu-thumbnail-loading' : ''}`}
            />
          </div>

          {/* 右侧：表单 / 骨架 */}
          <div className="flex-1 space-y-4 min-w-0">
            {loading ? (
              /* 骨架占位符 */
              <div className="space-y-4 animate-in">
                {/* 科目 */}
                <div className="flex flex-col gap-1.5">
                  <div className="cu-skeleton-block h-3 w-12" />
                  <div className="cu-skeleton-block h-10 w-full rounded-full" />
                </div>
                {/* 章节 + 知识点 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-20" />
                    <div className="cu-skeleton-block h-10 w-full rounded-full" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-20" />
                    <div className="cu-skeleton-block h-10 w-full rounded-full" />
                  </div>
                </div>
                {/* 题型 + 难度 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-10" />
                    <div className="cu-skeleton-block h-10 w-full rounded-full" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-16" />
                    <div className="cu-skeleton-block h-10 w-full rounded-full" />
                  </div>
                </div>
                {/* 答案 + 错因 */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-16" />
                    <div className="cu-skeleton-block h-10 w-full rounded-full" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-16" />
                    <div className="cu-skeleton-block h-10 w-full rounded-full" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-10" />
                    <div className="cu-skeleton-block h-10 w-full rounded-full" />
                  </div>
                </div>
                {/* 来源 */}
                <div className="flex flex-col gap-1.5">
                  <div className="cu-skeleton-block h-3 w-10" />
                  <div className="cu-skeleton-block h-10 w-full rounded-full" />
                </div>
                {/* 正文各节 */}
                <div className="space-y-3 pt-2">
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-10" />
                    <div className="cu-skeleton-block h-24 w-full rounded-2xl" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="cu-skeleton-block h-3 w-20" />
                    <div className="cu-skeleton-block h-20 w-full rounded-2xl" />
                  </div>
                </div>
              </div>
            ) : (
              /* 实际表单 */
              <>
                {/* 科目 */}
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs text-white/60">科目</span>
                  <input
                    type="text"
                    value={form.subject}
                    onChange={e => update('subject', e.target.value)}
                    className="cu-input text-sm"
                  />
                </label>

                {/* 章节 + 知识点 */}
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-white/60">章节（逗号分隔）</span>
                    <input
                      type="text"
                      value={form.chapter.join(', ')}
                      onChange={e => update('chapter', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      className="cu-input text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-white/60">知识点（逗号分隔）</span>
                    <input
                      type="text"
                      value={form.points.join(', ')}
                      onChange={e => update('points', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      className="cu-input text-sm"
                    />
                  </label>
                </div>

                {/* 题型 + 难度 */}
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-white/60">题型</span>
                    <select
                      value={form.type}
                      onChange={e => update('type', e.target.value)}
                      className="cu-input text-sm"
                    >
                      {QUESTION_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-white/60">难度（1–5）</span>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={form.level}
                      onChange={e => update('level', Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                      className="cu-input text-sm"
                    />
                  </label>
                </div>

                {/* 答案 + 错因 */}
                <div className="grid grid-cols-3 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-white/60">我的答案</span>
                    <input
                      type="text"
                      value={form.myAnswer}
                      onChange={e => update('myAnswer', e.target.value)}
                      className="cu-input text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-white/60">正确答案</span>
                    <input
                      type="text"
                      value={form.rightAnswer}
                      onChange={e => update('rightAnswer', e.target.value)}
                      className="cu-input text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-white/60">错因</span>
                    <select
                      value={form.errorType}
                      onChange={e => update('errorType', e.target.value)}
                      className="cu-input text-sm"
                    >
                      <option value="">请选择</option>
                      {ERROR_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* 来源 */}
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs text-white/60">来源</span>
                  <input
                    type="text"
                    value={form.source}
                    onChange={e => update('source', e.target.value)}
                    placeholder="如：王道《数据结构》p.42 第08题"
                    className="cu-input text-sm"
                  />
                </label>

                {/* 正文各节 */}
                <div className="space-y-3 pt-2">
                  {[
                    { key: 'question' as const, label: '题目', rows: 5 },
                    { key: 'myThought' as const, label: '我的思路', rows: 4 },
                    { key: 'solution' as const, label: '正确解法', rows: 4 },
                    { key: 'cause' as const, label: '错因', rows: 3 }
                  ].map(({ key, label, rows }) => (
                    <label key={key} className="flex flex-col gap-1.5">
                      <span className="text-xs text-white/60">{label}</span>
                      <textarea
                        value={form.body[key] ?? ''}
                        onChange={e => updateBody(key, e.target.value)}
                        rows={rows}
                        className="cu-textarea text-sm"
                      />
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* 状态行 */}
            <div className="flex items-center gap-2 text-xs text-white/60 pt-2">
              {extracting ? (
                <>
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>正在识别题目（通常 5–15 秒）…</span>
                </>
              ) : loading && !extracting ? (
                <span>正在读取截图…</span>
              ) : extraction ? (
                <>
                  <Icon name="check" className="h-3 w-3 text-mint" />
                  <span>识别完成，请核对</span>
                </>
              ) : (
                <span>请核对以下信息</span>
              )}
            </div>
          </div>
        </div>

        {/* 实时预览 */}
        {previewText && (
          <div className="mt-6 border-t border-white/10 pt-6">
            <h3 className="mb-3 text-sm font-semibold text-white/60">预览</h3>
            <Markdown source={previewText} className="rounded-2xl border border-white/10 bg-black/30 p-5" />
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mt-6 flex justify-end gap-3 border-t border-white/10 pt-5">
          <button type="button" onClick={onClose} className={`${cuCtaGhost} !px-5 !py-2.5 text-sm`}>
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className={`${cuCtaPrimary} !px-5 !py-2.5 text-sm`}
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                保存中…
              </span>
            ) : (
              <>
                <Icon name="check" className="h-4 w-4" />
                保存
              </>
            )}
          </button>
        </div>
        <div className="mt-2 text-right text-[11px] text-white/30">Ctrl+Enter 保存</div>
      </div>
    </div>
  )
}
