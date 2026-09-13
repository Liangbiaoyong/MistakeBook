import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import Empty from '../components/Empty'
import Spinner from '../components/Spinner'
import { Icon, cuCard, cuIconBox, cuCtaPrimary, cuNotice } from '../design/tokens'
import type { TopicRank } from '@shared/types'

export default function Forecast() {
  const [topics, setTopics] = useState<TopicRank[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analyzed, setAnalyzed] = useState(false)

  const handleForecast = async () => {
    setLoading(true)
    setError(null)
    const result = await window.api.forecast()
    setLoading(false)
    if (!result.ok) {
      setError(result.error ?? '分析考点失败')
    } else {
      setTopics(result.data ?? [])
      setAnalyzed(true)
    }
  }

  const maxScore = topics.length > 0 ? Math.max(...topics.map((t) => t.score)) : 0

  return (
    <div className="p-8">
      <PageHeader
        title="高频考点排行"
        subtitle="依据你自己的错题分布推算，不是押题"
      />

      {!analyzed && !loading && (
        <div className="mt-8">
          <Empty
            icon="trophy"
            title="开始分析你的高频考点"
            hint="基于你的错题分布与考纲权重，生成考点排行清单"
          />
          <button
            onClick={handleForecast}
            className={`${cuCtaPrimary} mt-6 px-6 py-3`}
          >
            <Icon name="spark" className="h-5 w-5" />
            开始分析
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-64">
          <Spinner label="正在分析考点排行..." />
        </div>
      )}

      {error && (
        <div className="mt-8">
          <div className={cuNotice('error')}>{error}</div>
          <button
            onClick={handleForecast}
            className={`${cuCtaPrimary} mt-4 px-5 py-2.5 text-sm`}
          >
            重试
          </button>
        </div>
      )}

      {analyzed && !loading && topics.length === 0 && (
        <div className="mt-8">
          <Empty
            icon="trophy"
            title="暂无足够数据"
            hint="多录入一些错题后再来分析，至少需要 3 道题"
          />
        </div>
      )}

      {analyzed && !loading && topics.length > 0 && (
        <div className="mt-6 space-y-4">
          {topics.map((topic, index) => {
            const barWidth = maxScore > 0 ? (topic.score / maxScore) * 100 : 0
            const isTop3 = index < 3
            return (
              <div
                key={topic.point}
                className={`${cuCard({ tight: true })} ${isTop3 ? 'border-l-4 border-l-coral' : ''}`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`${cuIconBox} h-10 w-10 shrink-0 ${
                      isTop3 ? 'bg-coral/20 text-coral' : ''
                    }`}
                  >
                    <span className="font-bold text-sm">{index + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-white/90 truncate">
                        {topic.point}
                      </h4>
                      <span className="text-white/60 text-xs ml-2 shrink-0">
                        错题 {topic.mistakes} 道
                      </span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2.5 mb-2">
                      <div
                        className="bg-gradient-to-r from-coral to-sun h-2.5 rounded-full transition-all duration-200 ease-out"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <p className="text-white/70 text-xs leading-relaxed">
                      {topic.reason}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {analyzed && !loading && topics.length > 0 && (
        <div className="mt-6 text-center">
          <button
            onClick={handleForecast}
            className={`${cuCtaPrimary} px-5 py-2.5 text-sm`}
          >
            <Icon name="refresh" className="h-4 w-4" />
            重新分析
          </button>
        </div>
      )}
    </div>
  )
}
