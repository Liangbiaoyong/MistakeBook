import { useState, useEffect, useCallback, useRef } from 'react'
import PageHeader from '../components/PageHeader'
import Empty from '../components/Empty'
import Spinner from '../components/Spinner'
import Markdown from '../components/Markdown'
import { Icon, cuCard, cuCtaPrimary, cuCtaGhost, cuNotice } from '../design/tokens'
import type { MistakeSummary, Mistake, Grade, ReviewQuery, ReviewBatch, ListFilter, ErrorType, ReviewMode, ReviewOrder } from '@shared/types'
import { GRADES, ERROR_TYPES, QUESTION_TYPES, STATUSES, REVIEW_ORDERS, REVIEW_MODES } from '@shared/types'

const GRADE_INFO: Record<Grade, { label: string; color: string; key: string }> = {
  again: { label: '忘了', color: 'bg-coral hover:bg-coral/80', key: '1' },
  hard: { label: '困难', color: 'bg-sun hover:bg-sun/80', key: '2' },
  good: { label: '良好', color: 'bg-mint hover:bg-mint/80', key: '3' },
  easy: { label: '简单', color: 'bg-mint hover:bg-mint/80', key: '4' },
}

const GRADE_KEYS = GRADES as readonly Grade[]
const LIMIT_OPTIONS = [10, 20, 50, 0] as const
const LIMIT_LABELS: Record<number, string> = { 10: '10 题', 20: '20 题', 50: '50 题', 0: '全部' }

export default function Review() {
  const [items, setItems] = useState<MistakeSummary[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState(false)

  /* ── 批次状态 ────────────────────────────────────────── */
  const [batch, setBatch] = useState<ReviewBatch | null>(null)
  const [offset, setOffset] = useState(0)
  const [wrapNotice, setWrapNotice] = useState(false)

  /* ── 范围筛选状态 ────────────────────────────────────── */
  const [subject, setSubject] = useState('')
  const [chapterPoint, setChapterPoint] = useState('')
  const [errorType, setErrorType] = useState('')
  const [questionType, setQuestionType] = useState('')
  const [status, setStatus] = useState('')
  const [onlyWithImage, setOnlyWithImage] = useState(false)
  const [mode, setMode] = useState<ReviewMode>('due')
  const [order, setOrder] = useState<ReviewOrder>('due')
  const [limit, setLimit] = useState(20)

  /* ── UI 状态 ─────────────────────────────────────────── */
  const [filtersExpanded, setFiltersExpanded] = useState(true)
  const [pendingQuery, setPendingQuery] = useState<ReviewQuery | null>(null)

  const detailCache = useRef(new Map<string, Mistake>())
  const [detail, setDetail] = useState<Mistake | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const seqRef = useRef(0)

  const buildQuery = useCallback((): ReviewQuery => {
    const scope: ListFilter = {}
    if (subject) scope.subject = subject
    if (chapterPoint) {
      scope.chapter = chapterPoint
      scope.point = chapterPoint
    }
    if (errorType) scope.errorType = errorType as ErrorType
    if (status) scope.status = status as ListFilter['status']

    return {
      scope: Object.keys(scope).length > 0 ? scope : undefined,
      mode,
      order,
      limit,
      offset,
      onlyWithImage
    }
  }, [subject, chapterPoint, errorType, status, mode, order, limit, offset, onlyWithImage])

  const fetchBatch = useCallback(async (query: ReviewQuery, isInitial = false) => {
    if (isInitial) setLoading(true)
    setError(null)
    const seq = ++seqRef.current
    const result = await window.api.reviewQuery(query)
    if (seq !== seqRef.current) return
    // ⚠ 必须把这一批的位置写回 offset state。
    // 不写的话它永远是 0，「换一批」算出来永远是同一个 offset —— 第一次之后原地踏步。
    setOffset(query.offset)
    if (!result.ok) {
      setError(result.error ?? '加载待复习错题失败')
      setItems([])
      setBatch(null)
    } else {
      const data = result.data ?? null
      setBatch(data)
      setItems(data?.items ?? [])
      setCurrentIndex(0)
      setShowAnswer(false)
      setWrapNotice(data !== null && data.from === 1 && query.offset > 0)
      if (data !== null && data.from === 1 && query.offset > 0) {
        setTimeout(() => setWrapNotice(false), 3000)
      }
    }
    setLoading(false)
  }, [])

  /* ── 挂载时恢复偏好 ──────────────────────────────────── */
  useEffect(() => {
    void window.api.settingsGet().then(result => {
      if (result.ok && result.data?.reviewPrefs) {
        const prefs = result.data.reviewPrefs
        if (prefs.scope) {
          setSubject(prefs.scope.subject ?? '')
          setChapterPoint(prefs.scope.chapter ?? prefs.scope.point ?? '')
          setErrorType(prefs.scope.errorType ?? '')
          setStatus(prefs.scope.status ?? '')
        }
        setMode(prefs.mode)
        setOrder(prefs.order)
        setLimit(prefs.limit)
        setOnlyWithImage(prefs.onlyWithImage ?? false)
      }
    })
  }, [])

  /* ── 应用查询 ─────────────────────────────────────────── */
  useEffect(() => {
    if (!pendingQuery) return
    setOffset(0)
    fetchBatch(pendingQuery, true)
    setPendingQuery(null)
  }, [pendingQuery, fetchBatch])

  const applyFilters = useCallback(() => {
    setPendingQuery(buildQuery())
  }, [buildQuery])

  /* ── 持久化偏好 ───────────────────────────────────────── */
  const persistPrefs = useCallback(async () => {
    const scope: ListFilter = {}
    if (subject) scope.subject = subject
    if (chapterPoint) {
      scope.chapter = chapterPoint
      scope.point = chapterPoint
    }
    if (errorType) scope.errorType = errorType as ErrorType
    if (status) scope.status = status as ListFilter['status']

    await window.api.settingsSet({
      reviewPrefs: {
        scope: Object.keys(scope).length > 0 ? scope : undefined,
        mode,
        order,
        limit,
        onlyWithImage
      }
    })
  }, [subject, chapterPoint, errorType, status, mode, order, limit, onlyWithImage])

  useEffect(() => {
    void persistPrefs()
  }, [mode, order, limit, onlyWithImage, subject, chapterPoint, errorType, status, persistPrefs])

  /* ── 换一批 ────────────────────────────────────────────── */
  const nextBatch = useCallback(() => {
    if (!batch) return
    const newOffset = offset + limit
    setOffset(newOffset)
    setPendingQuery({ ...buildQuery(), offset: newOffset })
  }, [batch, offset, limit, buildQuery])

  /* ── 重新开始 ──────────────────────────────────────────── */
  const restart = useCallback(() => {
    setOffset(0)
    setPendingQuery({ ...buildQuery(), offset: 0 })
  }, [buildQuery])

  /* ── 初次加载 ──────────────────────────────────────────── */
  useEffect(() => {
    setPendingQuery(buildQuery())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 键盘快捷键 ────────────────────────────────────────── */
  const handleGrade = useCallback(async (grade: Grade) => {
    if (grading) return
    if (currentIndex >= items.length) return
    const item = items[currentIndex]
    setGrading(true)
    const result = await window.api.grade(item.id, grade)
    setGrading(false)
    if (!result.ok) {
      setError(result.error ?? '评分失败')
      return
    }
    setShowAnswer(false)
    setCurrentIndex((prev) => prev + 1)
  }, [grading, currentIndex, items])

  const handleRevealAnswer = useCallback(() => {
    setShowAnswer(true)
  }, [])

  useEffect(() => {
    if (loading || items.length === 0) return
    if (currentIndex >= items.length) return

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === ' ' || e.key === 'Enter') {
        if (!showAnswer) {
          e.preventDefault()
          handleRevealAnswer()
        }
      } else if (e.key === 'Backspace' || e.key === 'ArrowLeft') {
        if (currentIndex > 0) {
          e.preventDefault()
          setShowAnswer(false)
          setCurrentIndex((prev) => prev - 1)
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        nextBatch()
      } else {
        const num = parseInt(e.key, 10)
        if (num >= 1 && num <= 4 && showAnswer && !grading) {
          e.preventDefault()
          const grade = GRADE_KEYS[num - 1]
          if (grade) void handleGrade(grade)
        }
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [loading, items.length, currentIndex, showAnswer, grading, handleGrade, handleRevealAnswer, nextBatch])

  /* ── 详情获取 ────────────────────────────────────────────── */
  const currentItem = items[currentIndex]
  const currentId = currentItem?.id

  useEffect(() => {
    if (!currentId) {
      setDetail(null)
      return
    }
    const cached = detailCache.current.get(currentId)
    if (cached) {
      setDetail(cached)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    void window.api.get(currentId).then((r) => {
      if (cancelled) return
      if (r.ok && r.data) {
        detailCache.current.set(currentId, r.data)
        setDetail(r.data)
      } else {
        setDetail(null)
        setError(r.error ?? '加载题目详情失败')
      }
      setDetailLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [currentId])

  /* ── 渲染 ────────────────────────────────────────────────── */
  if (loading && !batch) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner label="加载待复习错题..." />
      </div>
    )
  }

  if (error && !batch) {
    return (
      <div className="p-8">
        <div className={cuNotice('error')}>{error}</div>
        <button onClick={applyFilters} className={`mt-4 ${cuCtaGhost} px-4 py-2 text-sm`}>
          重试
        </button>
      </div>
    )
  }

  if (items.length === 0 && batch) {
    const hasFilters = subject || chapterPoint || errorType || questionType || status
    return (
      <div className="p-8">
        <PageHeader title="复习" subtitle="0 道错题" />
        {hasFilters ? (
          <Empty
            icon="review"
            title="还没有错题"
            hint="当前筛选范围内没有匹配的错题"
            action={
              <button
                onClick={() => {
                  setSubject('')
                  setChapterPoint('')
                  setErrorType('')
                  setQuestionType('')
                  setStatus('')
                  setOnlyWithImage(false)
                }}
                className={`${cuCtaGhost} !px-5 !py-2.5 text-sm`}
              >
                清除筛选
              </button>
            }
          />
        ) : mode === 'due' ? (
          <Empty
            icon="review"
            title="这个范围内今天没有到期的错题"
            hint="切换到「全部范围内」模式可以主动复习"
            action={
              <button
                onClick={() => setMode('all')}
                className={`${cuCtaPrimary} !px-5 !py-2.5 text-sm`}
              >
                切到「全部范围内」
              </button>
            }
          />
        ) : (
          <Empty
            icon="review"
            title="还没有错题"
            hint="开始录入错题吧"
          />
        )}
      </div>
    )
  }

  if (currentIndex >= items.length && batch) {
    return (
      <div className="p-8">
        <PageHeader
          title="复习"
          subtitle={`全部完成 ${batch.total} 道`}
          actions={
            <button onClick={nextBatch} className={`${cuCtaGhost} px-3.5 py-1.5 text-sm`}>
              <Icon name="refresh" className="h-4 w-4" />
              换一批
            </button>
          }
        />
        <Empty
          icon="check"
          title="这批题目已全部完成"
          hint="可以开始新的一轮复习"
          action={
            <div className="flex gap-3">
              <button onClick={nextBatch} className={`${cuCtaPrimary} !px-5 !py-2.5 text-sm`}>
                <Icon name="refresh" className="h-4 w-4" />
                换一批
              </button>
              <button onClick={restart} className={`${cuCtaGhost} !px-5 !py-2.5 text-sm`}>
                重新开始
              </button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="p-8 flex flex-col h-full">
      <PageHeader
        title="复习"
        subtitle={batch ? `第 ${batch.from}–${batch.to} 题 · 共 ${batch.total} 题` : '加载中...'}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              className={`${cuCtaGhost} px-3.5 py-1.5 text-sm`}
              aria-label={filtersExpanded ? '收起筛选' : '展开筛选'}
            >
              <Icon name={filtersExpanded ? 'close' : 'plus'} className="h-4 w-4" />
            </button>
            <button onClick={nextBatch} className={`${cuCtaGhost} px-3.5 py-1.5 text-sm`}>
              <Icon name="refresh" className="h-4 w-4" />
              换一批
              <span className="ml-1 text-xs opacity-60">R</span>
            </button>
          </div>
        }
      />

      {/* ── 范围筛选栏 ──────────────────────────────────── */}
      {filtersExpanded && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <select
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="cu-input !rounded-full text-sm"
            aria-label="按科目筛选"
          >
            <option value="">全部科目</option>
          </select>

          <input
            type="text"
            value={chapterPoint}
            onChange={e => setChapterPoint(e.target.value)}
            placeholder="章节/知识点"
            className="cu-input !rounded-full text-sm"
            aria-label="按章节或知识点搜索"
          />

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

          <select
            value={questionType}
            onChange={e => setQuestionType(e.target.value)}
            className="cu-input !rounded-full text-sm"
            aria-label="按题型筛选"
          >
            <option value="">全部题型</option>
            {QUESTION_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
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
              <option key={s} value={s}>
                {s === 'new' ? '新题' : s === 'reviewing' ? '复习中' : '已掌握'}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithImage}
              onChange={e => setOnlyWithImage(e.target.checked)}
              className="cu-input !rounded-full"
            />
            只看有原图
          </label>

          <div className="flex items-center gap-1 border border-white/20 rounded-full p-0.5">
            {REVIEW_MODES.map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  mode === m
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-white/60 hover:text-white/80'
                }`}
              >
                {m === 'due' ? '只过到期的' : '全部范围内'}
              </button>
            ))}
          </div>

          <select
            value={order}
            onChange={e => setOrder(e.target.value as ReviewOrder)}
            className="cu-input !rounded-full text-sm"
            aria-label="按顺序筛选"
          >
            {REVIEW_ORDERS.map(o => (
              <option key={o} value={o}>
                {o === 'due' ? '按到期' : o === 'random' ? '随机' : o === 'created' ? '按录入时间' : '按难度'}
              </option>
            ))}
          </select>

          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="cu-input !rounded-full text-sm"
            aria-label="一批数量"
          >
            {LIMIT_OPTIONS.map(l => (
              <option key={l} value={l}>{LIMIT_LABELS[l]}</option>
            ))}
          </select>

          <button onClick={applyFilters} className={`${cuCtaPrimary} !px-5 !py-2 text-sm`}>
            开始复习
          </button>
        </div>
      )}

      {/* ── 换一批通知 ──────────────────────────────────── */}
      {wrapNotice && (
        <div className={`${cuNotice('info')} mb-4 text-center`}>
          已从头开始
        </div>
      )}

      {/* ── 错误横幅 ──────────────────────────────────── */}
      {error && (
        <div className={`${cuNotice('error')} mb-4 flex items-center justify-between`}>
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

      <div className="flex-1 overflow-y-auto mt-6">
        <div className={cuCard()}>
          {currentItem?.imagePath && (
            <div className="mb-4">
              <img
                src={window.api.assetUrl(currentItem.imagePath)}
                alt="错题截图"
                className="rounded-xl max-w-full max-h-64 object-contain mx-auto border border-white/20"
              />
            </div>
          )}

          <div className="cu-prose mb-6">
            {detailLoading && !detail ? (
              <Spinner label="加载题目..." />
            ) : (
              <Markdown source={detail?.body.question ?? currentItem?.questionHead ?? ''} />
            )}
          </div>

          {!showAnswer ? (
            <button
              onClick={handleRevealAnswer}
              className={`${cuCtaPrimary} w-full py-3 text-base`}
            >
              <Icon name="check" className="h-5 w-5" />
              显示答案
              <span className="ml-2 text-xs opacity-60">Space / Enter</span>
            </button>
          ) : (
            <div className="space-y-4">
              <div className="cu-card-tight rounded-xl p-4">
                <h4 className="font-semibold text-white/90 mb-2">我的答案</h4>
                <div className="text-white/80">{detail?.myAnswer ?? '未记录'}</div>
              </div>

              <div className="cu-card-tight rounded-xl p-4">
                <h4 className="font-semibold text-white/90 mb-2">正确答案</h4>
                <div className="text-white/80">{detail?.rightAnswer ?? '未记录'}</div>
              </div>

              {detail?.body.solution && (
                <div className="cu-card-tight rounded-xl p-4">
                  <h4 className="font-semibold text-white/90 mb-2">解析</h4>
                  <div className="cu-prose">
                    <Markdown source={detail.body.solution} />
                  </div>
                </div>
              )}

              {detail?.body.cause && (
                <div className="cu-card-tight rounded-xl p-4">
                  <h4 className="font-semibold text-white/90 mb-2">当时为什么错</h4>
                  <div className="cu-prose">
                    <Markdown source={detail.body.cause} />
                  </div>
                </div>
              )}

              {currentItem?.errorType && (
                <div className="cu-card-tight rounded-xl p-4">
                  <h4 className="font-semibold text-white/90 mb-2">错因</h4>
                  <div className="text-white/80">{currentItem.errorType}</div>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                {Object.entries(GRADE_INFO).map(([grade, info]) => (
                  <button
                    key={grade}
                    onClick={() => void handleGrade(grade as Grade)}
                    disabled={grading}
                    className={`${cuCtaGhost} flex-1 py-2.5 text-sm ${info.color} text-black font-semibold`}
                  >
                    {info.label}
                    <span className="ml-1 text-xs opacity-60">{info.key}</span>
                  </button>
                ))}
              </div>

              <p className="text-center text-[11px] text-white/30 pt-1">
                1 忘了 / 2 困难 / 3 良好 / 4 简单 · ← 返回上一题 · R 换一批
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
