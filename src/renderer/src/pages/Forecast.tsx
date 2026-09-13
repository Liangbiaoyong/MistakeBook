import { useState, useEffect } from 'react'
import PageHeader from '../components/PageHeader'
import Empty from '../components/Empty'
import Spinner from '../components/Spinner'
import Markdown from '../components/Markdown'
import { Icon, cuCard, cuIconBox, cuCtaPrimary, cuCtaGhost, cuNotice } from '../design/tokens'
import { formatDateTime } from '../lib/format'
import type { TopicRank, AnalysisSummary, AnalysisRecord } from '@shared/types'

interface ForecastProps {
  onStudyPoint?: (point: string) => void
}

export default function Forecast({ onStudyPoint }: ForecastProps) {
  const [topics, setTopics] = useState<TopicRank[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analyzed, setAnalyzed] = useState(false)
  const [savedRecord, setSavedRecord] = useState<AnalysisSummary | null>(null)

  /* ── 历史记录状态 ────────────────────────────────────── */
  const [history, setHistory] = useState<AnalysisSummary[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<AnalysisRecord | null>(null)
  const [selectedLoading, setSelectedLoading] = useState(false)

  /* ── 挂载时加载历史记录 ──────────────────────────────── */
  useEffect(() => {
    void loadHistory()
  }, [])

  const loadHistory = async () => {
    const result = await window.api.analysisList()
    if (result.ok && result.data) {
      setHistory(result.data)
    }
  }

  const handleForecast = async () => {
    setLoading(true)
    setError(null)
    setSelectedRecord(null)
    const result = await window.api.forecast()
    setLoading(false)
    if (!result.ok) {
      setError(result.error ?? '分析考点失败')
    } else {
      setTopics(result.data?.topics ?? [])
      setSavedRecord(result.data?.saved ?? null)
      setAnalyzed(true)
      // 刷新历史列表
      void loadHistory()
    }
  }

  const maxScore = topics.length > 0 ? Math.max(...topics.map((t) => t.score)) : 0

  const handleLoadRecord = async (summary: AnalysisSummary) => {
    setSelectedLoading(true)
    const result = await window.api.analysisGet(summary.id)
    if (result.ok && result.data) {
      setSelectedRecord(result.data)
    }
    setSelectedLoading(false)
  }

  const handleDeleteRecord = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定要删除这条分析记录吗？')) return
    const result = await window.api.analysisRemove(id)
    if (result.ok) {
      setHistory((prev) => prev.filter((r) => r.id !== id))
      if (selectedRecord?.id === id) {
        setSelectedRecord(null)
      }
    }
  }

  const handleStudyPoint = (point: string) => {
    if (onStudyPoint) {
      onStudyPoint(point)
    }
  }

  const kindLabel = (kind: 'forecast' | 'patterns') =>
    kind === 'forecast' ? '考点排行' : '错因归纳'

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
        <>
          {/* 分析时间 */}
          {savedRecord && (
            <div className="mt-6 mb-4 flex items-center gap-3 text-white/60 text-sm">
              <Icon name="clock" className="h-4 w-4" />
              <span>分析时间：{formatDateTime(savedRecord.createdAt)}</span>
              {savedRecord.mistakeCount != null && (
                <span className="text-white/40">· {savedRecord.mistakeCount} 道错题参与</span>
              )}
            </div>
          )}

          {/* 考点排行列表 */}
          <div className="mt-4 space-y-4">
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
                      <p className="text-white/70 text-xs leading-relaxed mb-3">
                        {topic.reason}
                      </p>
                      {onStudyPoint && (
                        <button
                          onClick={() => handleStudyPoint(topic.point)}
                          className={`${cuCtaGhost} px-4 py-1.5 text-xs`}
                          aria-label={`复习考点 ${topic.point}`}
                        >
                          <Icon name="review" className="h-3 w-3 mr-1" />
                          复习这个考点
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={handleForecast}
              className={`${cuCtaPrimary} px-5 py-2.5 text-sm`}
            >
              <Icon name="refresh" className="h-4 w-4" />
              重新分析
            </button>
          </div>
        </>
      )}

      {/* ── 历史记录区域 ──────────────────────────────────── */}
      {history.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className={`${cuCtaGhost} px-4 py-2 text-sm mb-4`}
          >
            <Icon name={historyExpanded ? 'close' : 'folder'} className="h-4 w-4 mr-2" />
            {historyExpanded ? '收起历史记录' : `查看历史记录 (${history.length})`}
          </button>

          {historyExpanded && (
            <div className="space-y-3">
              {history.map((summary) => (
                <div
                  key={summary.id}
                  className={`${cuCard({ tight: true })} cursor-pointer transition-colors duration-200 hover:bg-white/[0.14] ${
                    selectedRecord?.id === summary.id ? 'ring-2 ring-white/50' : ''
                  }`}
                  onClick={() => handleLoadRecord(summary)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          summary.kind === 'forecast' ? 'bg-coral/20 text-coral' : 'bg-sun/20 text-sun'
                        }`}>
                          {kindLabel(summary.kind)}
                        </span>
                        <span className="text-white/60 text-xs">
                          {formatDateTime(summary.createdAt)}
                        </span>
                        {summary.mistakeCount != null && (
                          <span className="text-white/40 text-xs">
                            · {summary.mistakeCount} 道错题
                          </span>
                        )}
                      </div>
                      <h5 className="font-semibold text-white/90 text-sm truncate">
                        {summary.title}
                      </h5>
                      <p className="text-white/50 text-xs mt-1 line-clamp-2">
                        {summary.head}
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteRecord(summary.id, e)}
                      className="p-2 text-white/40 hover:text-coral transition-colors duration-200"
                      aria-label={`删除 ${summary.title}`}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}

              {/* 展开的记录详情 */}
              {selectedLoading && (
                <div className="flex items-center justify-center py-8">
                  <Spinner label="加载记录..." />
                </div>
              )}

              {selectedRecord && !selectedLoading && (
                <div className={`${cuCard()} mt-4`}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      selectedRecord.kind === 'forecast' ? 'bg-coral/20 text-coral' : 'bg-sun/20 text-sun'
                    }`}>
                      {kindLabel(selectedRecord.kind)}
                    </span>
                    <h4 className="font-semibold text-white/90">{selectedRecord.title}</h4>
                  </div>
                  <div className="text-white/60 text-xs mb-4">
                    分析时间：{formatDateTime(selectedRecord.createdAt)}
                  </div>
                  <div className="cu-prose">
                    <Markdown source={selectedRecord.markdown} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
