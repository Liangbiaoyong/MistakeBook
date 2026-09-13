/**
 * 考点热度排行功能
 * 基于用户的错题分布数据，分析高频考点和高价值知识点
 */
import type { TopicRank } from '@shared/types'
import { allMistakes } from '../store/vault'
import { buildForecastPrompt } from '../llm/prompts'
import { chatJSON } from '../llm/client'
import { ForecastSchema, type ForecastResult } from '../llm/schema'

/**
 * 预测高频考点
 * @returns 按热度排序的考点列表
 */
export async function forecastTopics(): Promise<TopicRank[]> {
  // 获取所有错题
  const mistakes = await allMistakes()

  // 如果没有错题，返回空
  if (mistakes.length === 0) {
    return []
  }

  // 计算统计数据
  const stats = {
    total: mistakes.length,
    bySubject: computeSubjectStats(mistakes),
    byPoint: computePointStats(mistakes)
  }

  // 构建预测提示词
  const prompt = buildForecastPrompt(stats, mistakes.map(m => ({
    subject: m.subject,
    points: m.points,
    errorType: m.errorType
  })))

  // 调用 LLM
  const result = await chatJSON<ForecastResult>({
    feature: 'forecast',
    system: '你是一个专业的教育数据分析专家，能够基于学生的错题分布识别高价值考点。',
    user: prompt,
    schema: ForecastSchema,
    temperature: 0.3
  })

  // 按 score 降序排序
  const sortedTopics = result.topics
    .sort((a, b) => b.score - a.score)
    .slice(0, 15) // 只返回前 15 个

  return sortedTopics
}

/**
 * 计算科目统计
 */
function computeSubjectStats(mistakes: Array<{ subject: string }>) {
  const stats = new Map<string, number>()
  mistakes.forEach(m => {
    stats.set(m.subject, (stats.get(m.subject) || 0) + 1)
  })
  return Array.from(stats.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 计算知识点统计
 */
function computePointStats(mistakes: Array<{ points: string[] }>) {
  const stats = new Map<string, number>()
  mistakes.forEach(m => {
    m.points.forEach(point => {
      stats.set(point, (stats.get(point) || 0) + 1)
    })
  })
  return Array.from(stats.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}
