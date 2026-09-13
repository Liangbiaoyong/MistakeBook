/**
 * 书库 — 错题列表主屏，支持筛选、详情叠加层、变式生成
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Mistake, MistakeSummary, MistakeBody, ListFilter, ErrorType } from '@shared/types'
import { STATUSES, ERROR_TYPES } from '@shared/types'
import PageHeader from '../components/PageHeader'
import MistakeCard from '../components/MistakeCard'
import Empty from '../components/Empty'
import Spinner from '../components/Spinner'
import Markdown from '../components/Markdown'
import { cuCard, cuCtaPrimary, cuCtaGhost, cuNotice, Icon } from '../design/tokens'
import { statusLabel, statusTone, relativeDay } from '../lib/format'
import { ACCENT } from '../design/tokens'

interface LibraryProps {
  onCapture: () => void
}

/**
 * 改写正文的某一个小节。
 * 用 switch 而不是 `{ ...b, [key]: value }`——后者在 TS 里会把所有字段推断成可选，
 * 于是不再满足 MistakeBody 的必填约束。
 */
function withSection(b: MistakeBody, key: keyof MistakeBody, value: string): MistakeBody {
  switch (key) {
    case 'question':
      return { ...b, question: value }
    case 'myThought':
      return { ...b, myThought: value }
    case 'solution':
      return { ...b, solution: value }
    case 'cause':
      return { ...b, cause: value }
    case 'variant':
      return { ...b, variant: value }
    default:
      return b
  }
}

export default function Library({ onCapture }: LibraryProps): React.JSX.Element {
  /* ── 数据 ──────────────────────────────────────────── */
  const [items, setItems] = useState<MistakeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* ── 筛选 ──────────────────────────────────────────── */
  const [subject, setSubject] = useState('')
  const [status, setStatus] = useState('')
  const [errorType, setErrorType] = useState('')
  const [chapter, setChapter] = useState('')
  const [q, setQ] = useState('')

  const filter: ListFilter = useMemo(() => ({
    ...(subject && { subject }),
    ...(status && { status: status as ListFilter['status'] }),
    ...(errorType && { errorType: errorType as ErrorType }),
    ...(chapter && { chapter }),
    ...(q && { q })
  }), [subject, status, errorType, chapter, q])

  const subjects = useMemo(() => {
    const set = new Set(items.map(i => i.subject))
    return Array.from(set).sort()
  }, [items])

  /* ── 详情叠加层 ──────────────────────────────────────── */
  const [detailId, setDetailId] = useState<string | null>(null)
  /** 详情里的原始截图默认只露一截：整页扫描图会把题目/答案全挤到折叠线以下 */
  const [imageExpanded, setImageExpanded] = useState(false)

  // 换一条错题就收起原图，免得上一张的展开状态被带过来
  useEffect(() => {
    setImageExpanded(false)
  }, [detailId])
  const [detailData, setDetailData] = useState<Mistake | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  /* ── 编辑状态 ──────────────────────────────────────── */
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState<Partial<Mistake>>({})
  const [variants, setVariants] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)

  /* ── 数据获取 ──────────────────────────────────────── */
  const fetchList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const r = await window.api.list(filter)
    if (r.ok) {
      setItems(r.data ?? [])
    } else {
      setError(r.error ?? '加载失败')
    }
    setLoading(false)
  }, [filter])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  /* ── 详情获取 ──────────────────────────────────────── */
  const fetchDetail = useCallback(async (id: string) => {
    setDetailId(id)
    setDetailLoading(true)
    setEditing(false)
    setVariants([])
    const r = await window.api.get(id)
    if (r.ok) {
      setDetailData(r.data ?? null)
    } else {
      setError(r.error ?? '加载详情失败')
    }
    setDetailLoading(false)
  }, [])

  const closeDetail = () => {
    setDetailId(null)
    setDetailData(null)
    setEditing(false)
    setVariants([])
  }

  /* ── 编辑 ──────────────────────────────────────── */
  const startEdit = () => {
    if (!detailData) return
    setEditDraft({ ...detailData })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!detailData || !editDraft) return
    const r = await window.api.update(detailData.id, editDraft)
    if (r.ok) {
      setEditing(false)
      await fetchDetail(detailData.id)
      await fetchList()
    } else {
      setError(r.error ?? '保存失败')
    }
  }

  /* ── 删除 ──────────────────────────────────────── */
  const handleDelete = async () => {
    if (!detailData) return
    if (!window.confirm('确定要删除这道错题吗？此操作不可撤销。')) return
    const r = await window.api.remove(detailData.id)
    if (r.ok) {
      closeDetail()
      await fetchList()
    } else {
      setError(r.error ?? '删除失败')
    }
  }

  /* ── 变式生成 ──────────────────────────────────────── */
  const handleVariants = async () => {
    if (!detailData) return
    setGenerating(true)
    const r = await window.api.variants(detailData.id)
    if (r.ok && r.data) {
      setVariants(prev => [...prev, r.data!])
    } else {
      setError(r.error ?? '生成变式失败')
    }
    setGenerating(false)
  }

  /* ── 渲染 ──────────────────────────────────────── */
  return (
    <div className="cu-enter">
      <PageHeader
        title="书库"
        subtitle={`共 ${items.length} 题`}
        actions={
          <button type="button" onClick={onCapture} className={`${cuCtaPrimary} !px-4 !py-2 text-sm`}>
            <Icon name="camera" className="h-4 w-4" />
            截图录入
          </button>
        }
      />

      {/* ── 筛选栏 ────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={subject}
          onChange={e => setSubject(e.target.value)}
          className="cu-input !rounded-full text-sm"
          aria-label="按科目筛选"
        >
          <option value="">全部科目</option>
          {subjects.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="cu-input !rounded-full text-sm"
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>

        <select
          value={errorType}
          onChange={e => setErrorType(e.target.value)}
          className="cu-input !rounded-full text-sm"
          aria-label="按错因筛选"
        >
          <option value="">全部错因</option>
          {ERROR_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <input
          type="text"
          value={chapter}
          onChange={e => setChapter(e.target.value)}
          placeholder="章节/知识点"
          className="cu-input !rounded-full text-sm"
          aria-label="按章节或知识点搜索"
        />

        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="关键词搜索"
          className="cu-input !rounded-full text-sm"
          aria-label="关键词搜索"
        />
      </div>

      {/* ── 错误横幅 ─────────────────────────────────── */}
      {error && (
        <div className={`${cuNotice('error')} mb-6 flex items-center justify-between`}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="cu-btn-sm"
            aria-label="关闭错误提示"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── 内容区 ──────────────────────────────────── */}
      {loading ? (
        <Spinner label="正在加载…" />
      ) : items.length === 0 ? (
        <Empty
          icon="library"
          title="还没有错题"
          hint="按 Alt+Shift+A 截图录入第一道错题，开始构建你的错题本"
          action={
            <button type="button" onClick={onCapture} className={`${cuCtaPrimary} !px-5 !py-2.5 text-sm`}>
              <Icon name="camera" className="h-4 w-4" />
              截图录入
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(item => (
            <MistakeCard
              key={item.id}
              item={item}
              onClick={() => void fetchDetail(item.id)}
            />
          ))}
        </div>
      )}

      {/* ── 详情叠加层 ────────────────────────────────── */}
      {detailId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur"
          onClick={closeDetail}
          role="dialog"
          aria-modal="true"
          aria-label="错题详情"
        >
          <div
            className={`${cuCard()} relative max-h-[85vh] w-full max-w-3xl overflow-y-auto p-8`}
            onClick={e => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              type="button"
              onClick={closeDetail}
              className="absolute right-4 top-4 cu-btn-sm text-white/60 hover:text-white"
              aria-label="关闭详情"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>

            {detailLoading ? (
              <Spinner label="正在加载…" />
            ) : detailData ? (
              <div className="space-y-6">
                {/* 原始截图 —— 默认只露顶部一截。整页扫描图不设限的话会占满整个面板，
                    把 chips 和题目全挤到折叠线以下，得先滚过一页图才看得到真正要看的东西。 */}
                {detailData.imagePath && (
                  <button
                    type="button"
                    onClick={() => setImageExpanded((v) => !v)}
                    aria-label={imageExpanded ? '收起原始截图' : '展开原始截图'}
                    className="relative block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-white/20 bg-black/30 transition-colors duration-200 hover:border-white/40"
                  >
                    <img
                      src={window.api.assetUrl(detailData.imagePath)}
                      alt="原始截图"
                      className={
                        imageExpanded
                          ? 'w-full'
                          : 'max-h-52 w-full object-cover object-top'
                      }
                    />
                    {!imageExpanded && (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent py-2 text-center text-xs text-white/80">
                        点击展开原图
                      </span>
                    )}
                  </button>
                )}

                {/* 元数据 chips */}
                <div className="flex flex-wrap gap-2">
                  <span className="cu-chip">{detailData.subject}</span>
                  <span className="cu-chip" style={{
                    borderColor: `color-mix(in srgb, ${ACCENT[statusTone(detailData.status)]} 40%, transparent)`,
                    color: ACCENT[statusTone(detailData.status)]
                  }}>
                    {statusLabel(detailData.status)}
                  </span>
                  <span className="cu-chip">{detailData.type}</span>
                  {detailData.errorType && <span className="cu-chip">{detailData.errorType}</span>}
                  {detailData.level && <span className="cu-chip">{'★'.repeat(detailData.level)}{'☆'.repeat(5 - detailData.level)}</span>}
                  {detailData.chapter?.map(c => <span key={c} className="cu-chip">{c}</span>)}
                  {detailData.points?.map(p => <span key={p} className="cu-chip">{p}</span>)}
                  {detailData.source && <span className="cu-chip">{detailData.source}</span>}
                  <span className="cu-chip">{relativeDay(detailData.created)}</span>
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-3">
                  {editing ? (
                    <>
                      <button type="button" onClick={() => void saveEdit()} className={`${cuCtaPrimary} !px-4 !py-2 text-sm`}>
                        <Icon name="check" className="h-4 w-4" />
                        保存
                      </button>
                      <button type="button" onClick={() => setEditing(false)} className={`${cuCtaGhost} !px-4 !py-2 text-sm`}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={startEdit} className={`${cuCtaGhost} !px-4 !py-2 text-sm`}>
                        <Icon name="edit" className="h-4 w-4" />
                        编辑
                      </button>
                      <button type="button" onClick={handleDelete} className={`${cuCtaGhost} !px-4 !py-2 text-sm !border-coral/50 !text-coral`}>
                        <Icon name="trash" className="h-4 w-4" />
                        删除
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleVariants()}
                        disabled={generating}
                        className={`${cuCtaPrimary} !px-4 !py-2 text-sm`}
                      >
                        {generating ? (
                          <span className="flex items-center gap-2">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                            生成中…
                          </span>
                        ) : (
                          <>
                            <Icon name="spark" className="h-4 w-4" />
                            生成变式
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>

                {/* 正文各节 */}
                <DetailSections data={detailData} editing={editing} draft={editDraft} onChange={setEditDraft} />

                {/* 变式 */}
                {variants.length > 0 && (
                  <div className="mt-6 space-y-4">
                    <h3 className="font-display font-bold text-lg text-white">变式题</h3>
                    {variants.map((v, i) => (
                      <Markdown key={i} source={v} className="rounded-2xl border border-iris/30 bg-iris/5 p-5" />
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── 详情正文分节渲染 ──────────────────────────────────── */
interface DetailSectionsProps {
  data: Mistake
  editing: boolean
  draft: Partial<Mistake>
  onChange: (patch: Partial<Mistake>) => void
}

const SECTION_KEYS = [
  { key: 'question', label: '题目' },
  { key: 'myThought', label: '我的思路' },
  { key: 'solution', label: '正确解法' },
  { key: 'cause', label: '错因' },
  { key: 'variant', label: '变式' }
] as const

function DetailSections({ data, editing, draft, onChange }: DetailSectionsProps): React.JSX.Element {
  return (
    <div className="space-y-5">
      {SECTION_KEYS.map(({ key, label }) => {
        const original = data.body[key]
        if (!original && !editing) return null

        return (
          <div key={key}>
            <h3 className="mb-2 font-display font-semibold text-sm text-white/70">{label}</h3>
            {editing ? (
              <textarea
                value={draft.body?.[key] ?? data.body[key] ?? ''}
                onChange={e =>
                  onChange({
                    ...draft,
                    body: withSection(draft.body ?? data.body, key, e.target.value)
                  })
                }
                className="cu-textarea w-full text-sm"
                rows={4}
                aria-label={`编辑${label}`}
              />
            ) : (
              <Markdown source={original ?? ''} />
            )}
          </div>
        )
      })}

      {/* 编辑模式下可修改元数据 */}
      {editing && (
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/60">科目</span>
            <input
              type="text"
              value={draft.subject ?? ''}
              onChange={e => onChange({ ...draft, subject: e.target.value })}
              className="cu-input text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/60">章节（逗号分隔）</span>
            <input
              type="text"
              value={draft.chapter?.join(', ') ?? ''}
              onChange={e => onChange({ ...draft, chapter: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              className="cu-input text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/60">知识点（逗号分隔）</span>
            <input
              type="text"
              value={draft.points?.join(', ') ?? ''}
              onChange={e => onChange({ ...draft, points: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              className="cu-input text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/60">来源</span>
            <input
              type="text"
              value={draft.source ?? ''}
              onChange={e => onChange({ ...draft, source: e.target.value })}
              className="cu-input text-sm"
            />
          </label>
        </div>
      )}
    </div>
  )
}
