/**
 * 错误模式分析功能
 * 基于用户的错题数据，调用 LLM 生成详细的错因分析报告
 */
import type { ListFilter } from '@shared/types'
import { allMistakes } from '../store/vault'
import { buildAnalyzePrompt } from '../llm/prompts'
import { chatText } from '../llm/client'

/**
 * 分析错误模式
 * @param filter 错题过滤器
 * @returns Markdown 格式的分析报告
 */
export async function analyzeErrorPatterns(filter?: ListFilter): Promise<string> {
  // 获取所有错题
  let mistakes = await allMistakes()

  // 应用过滤器
  if (filter) {
    if (filter.subject) {
      mistakes = mistakes.filter(m => m.subject === filter.subject)
    }
    if (filter.chapter) {
      mistakes = mistakes.filter(m => m.chapter.includes(filter.chapter!))
    }
    if (filter.point) {
      mistakes = mistakes.filter(m => m.points.includes(filter.point!))
    }
    if (filter.errorType) {
      mistakes = mistakes.filter(m => m.errorType === filter.errorType)
    }
    if (filter.status) {
      mistakes = mistakes.filter(m => m.status === filter.status)
    }
    if (filter.limit) {
      mistakes = mistakes.slice(0, filter.limit)
    }
  }

  // 检查是否有足够的错题
  if (mistakes.length < 3) {
    return `## 错误模式分析

当前只有 ${mistakes.length} 道错题，数据不足以进行有效的错因分析。

**建议**：继续积累错题数据，至少需要 3 道错题才能开始有意义的分析。

当前错题概况：
- 总数: ${mistakes.length}
${mistakes.length > 0 ? `- 科目: ${[...new Set(mistakes.map(m => m.subject))].join('、')}` : ''}

继续积累错题，你就能获得个性化的错因分析报告。`
  }

  // 构建分析提示词
  const prompt = buildAnalyzePrompt(
    mistakes.map(m => ({
      errorType: m.errorType,
      points: m.points,
      subject: m.subject,
      type: m.type
    }))
  )

  // 调用 LLM
  const report = await chatText({
    feature: 'analyze',
    system: '你是一个专业的教育数据分析专家，能够从错题数据中发现规律并提供改进建议。',
    user: prompt
  })

  return report
}
