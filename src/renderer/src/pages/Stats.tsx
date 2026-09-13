import { useState, useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import PageHeader from '../components/PageHeader'
import Empty from '../components/Empty'
import Spinner from '../components/Spinner'
import Markdown from '../components/Markdown'
import { Icon, cuCard, cuIconBox, cuCtaPrimary, cuNotice } from '../design/tokens'
import type { StatsOverview } from '@shared/types'

export default function Stats() {
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [patternsLoading, setPatternsLoading] = useState(false)
  const [patterns, setPatterns] = useState<string | null>(null)
  const [patternsError, setPatternsError] = useState<string | null>(null)

  const dailyChartRef = useRef<HTMLDivElement>(null)
  const subjectChartRef = useRef<HTMLDivElement>(null)
  const errorTypeChartRef = useRef<HTMLDivElement>(null)
  const pointChartRef = useRef<HTMLDivElement>(null)

  const chartsRef = useRef<echarts.ECharts[]>([])

  useEffect(() => {
    const loadStats = async () => {
      setLoading(true)
      setError(null)
      const result = await window.api.stats()
      if (!result.ok) {
        setError(result.error ?? '加载统计数据失败')
      } else {
        setStats(result.data ?? null)
      }
      setLoading(false)
    }
    loadStats()
  }, [])

  useEffect(() => {
    if (!stats) return

    const initCharts = () => {
      chartsRef.current.forEach((c) => c.dispose())
      chartsRef.current = []

      const darkTheme = {
        backgroundColor: 'transparent',
        textStyle: { color: 'rgba(255,255,255,0.7)' },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
      }

      if (dailyChartRef.current && stats.daily.length > 0) {
        const chart = echarts.init(dailyChartRef.current)
        chartsRef.current.push(chart)
        chart.setOption({
          ...darkTheme,
          tooltip: { trigger: 'axis' },
          grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
          xAxis: {
            type: 'category',
            data: stats.daily.map((d) => d.date),
            axisLabel: { color: 'rgba(255,255,255,0.6)' },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: 'rgba(255,255,255,0.6)' },
          },
          series: [
            {
              data: stats.daily.map((d) => d.count),
              type: 'line',
              smooth: true,
              lineStyle: { color: '#ff6b6b', width: 2 },
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: 'rgba(255,107,107,0.3)' },
                  { offset: 1, color: 'rgba(255,107,107,0.05)' },
                ]),
              },
              itemStyle: { color: '#ff6b6b' },
            },
          ],
        })
      }

      if (subjectChartRef.current && stats.bySubject.length > 0) {
        const chart = echarts.init(subjectChartRef.current)
        chartsRef.current.push(chart)
        chart.setOption({
          ...darkTheme,
          tooltip: { trigger: 'item' },
          series: [
            {
              type: 'pie',
              radius: ['40%', '70%'],
              data: stats.bySubject.map((item, i) => ({
                name: item.key,
                value: item.count,
                itemStyle: { color: ['#ff6b6b', '#4ecdc4', '#ffe66d', '#6c5ce7'][i % 4] },
              })),
              label: { color: 'rgba(255,255,255,0.8)' },
              labelLine: { lineStyle: { color: 'rgba(255,255,255,0.3)' } },
            },
          ],
        })
      }

      if (errorTypeChartRef.current && stats.byErrorType.length > 0) {
        const chart = echarts.init(errorTypeChartRef.current)
        chartsRef.current.push(chart)
        chart.setOption({
          ...darkTheme,
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
          xAxis: {
            type: 'value',
            axisLabel: { color: 'rgba(255,255,255,0.6)' },
          },
          yAxis: {
            type: 'category',
            data: stats.byErrorType.map((item) => item.key),
            axisLabel: { color: 'rgba(255,255,255,0.7)' },
          },
          series: [
            {
              type: 'bar',
              data: stats.byErrorType.map((item, i) => ({
                value: item.count,
                itemStyle: { color: ['#ff6b6b', '#4ecdc4', '#ffe66d', '#6c5ce7'][i % 4] },
              })),
            },
          ],
        })
      }

      if (pointChartRef.current && stats.byPoint.length > 0) {
        const topPoints = stats.byPoint.slice(0, 10)
        const chart = echarts.init(pointChartRef.current)
        chartsRef.current.push(chart)
        chart.setOption({
          ...darkTheme,
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
          xAxis: {
            type: 'value',
            axisLabel: { color: 'rgba(255,255,255,0.6)' },
          },
          yAxis: {
            type: 'category',
            data: topPoints.map((item) => item.key).reverse(),
            axisLabel: { color: 'rgba(255,255,255,0.7)' },
          },
          series: [
            {
              type: 'bar',
              data: topPoints
                .map((item, i) => ({
                  value: item.count,
                  itemStyle: { color: ['#ff6b6b', '#4ecdc4', '#ffe66d', '#6c5ce7'][i % 4] },
                }))
                .reverse(),
            },
          ],
        })
      }
    }

    initCharts()

    const handleResize = () => {
      chartsRef.current.forEach((c) => c.resize())
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chartsRef.current.forEach((c) => c.dispose())
      chartsRef.current = []
    }
  }, [stats])

  const handleAnalyze = async () => {
    setPatternsLoading(true)
    setPatternsError(null)
    const result = await window.api.errorPatterns()
    setPatternsLoading(false)
    if (!result.ok) {
      setPatternsError(result.error ?? '错因分析失败')
    } else {
      setPatterns(result.data ?? '')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner label="加载统计数据..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className={cuNotice('error')}>{error}</div>
      </div>
    )
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="p-8">
        <PageHeader title="统计" />
        <Empty
          icon="stats"
          title="暂无错题数据"
          hint="先录入一些错题，才能看到统计分析"
        />
      </div>
    )
  }

  const masteredCount =
    stats.byStatus.find((s) => s.key === 'mastered')?.count ?? 0

  const kpis = [
    { label: '总错题', value: stats.total, icon: 'library' as const, color: 'text-white' },
    { label: '待复习', value: stats.dueCount, icon: 'clock' as const, color: 'text-sun' },
    { label: '已掌握', value: masteredCount, icon: 'check' as const, color: 'text-mint' },
    {
      label: '高频错因',
      value: stats.byErrorType[0]?.key ?? '-',
      icon: 'brain' as const,
      color: 'text-coral',
    },
  ]

  return (
    <div className="p-8">
      <PageHeader title="统计" subtitle="错题趋势与分布分析" />

      <div className="grid grid-cols-4 gap-4 mt-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={cuCard({ tight: true })}>
            <div className="flex items-center gap-3">
              <div className={`${cuIconBox} h-10 w-10`}>
                <Icon name={kpi.icon} className={`h-5 w-5 ${kpi.color}`} />
              </div>
              <div>
                <div className="text-white/60 text-xs">{kpi.label}</div>
                <div className="text-white font-bold text-lg">{kpi.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6 mt-8">
        {stats.daily.length > 0 && (
          <div className={cuCard({ tight: true })}>
            <h3 className="font-semibold text-white/90 mb-4">每日错题量</h3>
            <div ref={dailyChartRef} className="h-48" />
          </div>
        )}

        {stats.bySubject.length > 0 && (
          <div className={cuCard({ tight: true })}>
            <h3 className="font-semibold text-white/90 mb-4">按科目</h3>
            <div ref={subjectChartRef} className="h-48" />
          </div>
        )}

        {stats.byErrorType.length > 0 && (
          <div className={cuCard({ tight: true })}>
            <h3 className="font-semibold text-white/90 mb-4">按错因</h3>
            <div ref={errorTypeChartRef} className="h-48" />
          </div>
        )}

        {stats.byPoint.length > 0 && (
          <div className={cuCard({ tight: true })}>
            <h3 className="font-semibold text-white/90 mb-4">最常错知识点 Top 10</h3>
            <div ref={pointChartRef} className="h-48" />
          </div>
        )}
      </div>

      <div className={cuCard({ tight: true }) + ' mt-8'}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white/90">错因归纳</h3>
          <button
            onClick={handleAnalyze}
            disabled={patternsLoading}
            className={`${cuCtaPrimary} px-4 py-2 text-sm`}
          >
            {patternsLoading ? (
              <Spinner label="分析中..." />
            ) : (
              <>
                <Icon name="spark" className="h-4 w-4" />
                分析错因
              </>
            )}
          </button>
        </div>
        {patternsError && <div className={cuNotice('error') + ' mb-4'}>{patternsError}</div>}
        {patterns && (
          <div className="cu-prose mt-4">
            <Markdown source={patterns} />
          </div>
        )}
      </div>
    </div>
  )
}
