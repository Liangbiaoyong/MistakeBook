import { useState, useEffect, useCallback, useRef } from 'react'
import PageHeader from '../components/PageHeader'
import Empty from '../components/Empty'
import Spinner from '../components/Spinner'
import Markdown from '../components/Markdown'
import { Icon, cuCard, cuCtaPrimary, cuCtaGhost, cuNotice } from '../design/tokens'
import type { MistakeSummary, Mistake, Grade } from '@shared/types'

const GRADE_INFO: Record<Grade, { label: string; color: string }> = {
  again: { label: '忘了', color: 'bg-coral hover:bg-coral/80' },
  hard: { label: '困难', color: 'bg-sun hover:bg-sun/80' },
  good: { label: '良好', color: 'bg-mint hover:bg-mint/80' },
  easy: { label: '简单', color: 'bg-mint hover:bg-mint/80' },
}

export default function Review() {
  const [items, setItems] = useState<MistakeSummary[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadDue = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await window.api.due()
    if (!result.ok) {
      setError(result.error ?? '加载待复习错题失败')
      setItems([])
    } else {
      setItems(result.data ?? [])
      setCurrentIndex(0)
      setShowAnswer(false)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadDue()
  }, [loadDue])

  const handleGrade = async (grade: Grade) => {
    if (currentIndex >= items.length) return
    const item = items[currentIndex]
    const result = await window.api.grade(item.id, grade)
    if (!result.ok) {
      setError(result.error ?? '评分失败')
      return
    }
    setShowAnswer(false)
    setCurrentIndex((prev) => prev + 1)
  }

  const currentItem = items[currentIndex]
  const total = items.length
  const done = currentIndex

  // 待复习队列里只有摘要（不含题干与答案），当前这题按 id 拉完整记录
  const detailCache = useRef(new Map<string, Mistake>())
  const [detail, setDetail] = useState<Mistake | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner label="加载待复习错题..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className={cuNotice('error')}>{error}</div>
        <button onClick={loadDue} className={`mt-4 ${cuCtaGhost} px-4 py-2 text-sm`}>
          重试
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="p-8">
        <PageHeader title="今日复习" subtitle="0 道到期错题" />
        <Empty icon="review" title="今天没有到期的错题" hint="好好休息，明天继续加油" />
      </div>
    )
  }

  if (done >= total) {
    return (
      <div className="p-8">
        <PageHeader title="今日复习" subtitle={`全部完成 ${total} 道`} />
        <Empty
          icon="check"
          title="太棒了！今天的复习全部完成"
          hint="明天再来巩固记忆吧"
        />
        <button onClick={loadDue} className={`mt-6 ${cuCtaPrimary} px-5 py-2.5 text-sm`}>
          <Icon name="refresh" className="h-4 w-4" />
          换一批
        </button>
      </div>
    )
  }

  return (
    <div className="p-8 flex flex-col h-full">
      <PageHeader
        title="今日复习"
        subtitle={`第 ${done + 1} / ${total}`}
        actions={
          <button
            onClick={loadDue}
            className={`${cuCtaGhost} px-3.5 py-1.5 text-sm`}
          >
            <Icon name="refresh" className="h-4 w-4" />
            换一批
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto mt-6">
        {error && <div className={cuNotice('error') + ' mb-4'}>{error}</div>}

        <div className={cuCard()}>
          {currentItem.imagePath && (
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
              <Markdown source={detail?.body.question ?? currentItem.questionHead} />
            )}
          </div>

          {!showAnswer ? (
            <button
              onClick={() => setShowAnswer(true)}
              className={`${cuCtaPrimary} w-full py-3 text-base`}
            >
              <Icon name="check" className="h-5 w-5" />
              显示答案
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

              {currentItem.errorType && (
                <div className="cu-card-tight rounded-xl p-4">
                  <h4 className="font-semibold text-white/90 mb-2">错因</h4>
                  <div className="text-white/80">{currentItem.errorType}</div>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                {Object.entries(GRADE_INFO).map(([grade, info]) => (
                  <button
                    key={grade}
                    onClick={() => handleGrade(grade as Grade)}
                    className={`${cuCtaGhost} flex-1 py-2.5 text-sm ${info.color} text-black font-semibold`}
                  >
                    {info.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
