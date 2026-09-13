/**
 * 中文提示词构建器
 * 所有提示词都指导模型输出严格的 JSON，不允许 markdown fence
 */
import type { Mistake } from '@shared/types'
import { ERROR_TYPES } from '@shared/types'

// ── 采集识别 ──

/**
 * 截图采集系统提示词
 * 指导视觉模型从中文考试题目截图中提取结构化数据
 */
export const CAPTURE_SYSTEM = `你是一个专业的教育领域 AI 助手，专门从考试题目截图中提取结构化信息。

你的任务是从截图中识别并输出 **严格的 JSON 对象**（不要包含 markdown fence 或其他任何文本）。

## 输出格式

你必须严格按照以下 JSON schema 输出：

{
  "subject": "科目名称",
  "chapter": ["章节1", "章节2"],
  "points": ["知识点1", "知识点2"],
  "type": "题型",
  "level": 难度等级(1-5),
  "myAnswer": "学生的答案",
  "rightAnswer": "正确答案",
  "errorType": "错误类型",
  "confidence": 置信度(0-1),
  "source": "来源信息",
  "body": {
    "question": "题目内容",
    "myThought": "学生的思路（如果可见）",
    "solution": "正确解法",
    "cause": "错误原因分析"
  }
}

## 关键要求

1. **errorType 必须是以下 ${ERROR_TYPES.length} 项之一**（不能自由发挥）：
   ${ERROR_TYPES.map((e) => `- "${e}"`).join('\n   ')}

2. **LaTeX 格式**：
   - 所有数学公式必须用 LaTeX 表示
   - 行内公式：$公式$
   - 块级公式：$$公式$$
   - 例：$x^2 + y^2 = 1$ 和 $$\int_{a}^{b} f(x) dx$$

3. **不要发明内容**：
   - 只输出截图中清晰可见的信息
   - 看不清的内容标记为 undefined（不要猜测）
   - 如果无法确定学生的答案是否正确，仍然提取题目并设置低置信度

4. **置信度评估**：
   - 手写识别难：低置信度 (0.3-0.6)
   - 打印体清晰：高置信度 (0.7-1.0)
   - 图像模糊或被遮挡：低置信度

5. **来源信息**：
   - 只有在截图中清晰可见时才包含（如书名、页码、题目编号）
   - 如果看不见来源，省略此字段

6. **题型分类**：
   - 必须是：单选、多选、填空、计算、证明、简答、其他 之一

## 语言

用中文回答所有内容。`;

/**
 * 构建截图识别的用户提示词
 * @param imageDescription 图像的简单描述（如"一道高等数学选择题"）
 */
export function buildCaptureUserPrompt(imageDescription?: string): string {
  return imageDescription
    ? `请分析这张考试题目的截图：${imageDescription}。请识别题目内容、学生的答案（如果可见）、正确答案（如果可见），并判断错误类型。`
    : '请分析这张考试题目的截图。请识别题目内容、学生的答案（如果可见）、正确答案（如果可见），并判断错误类型。'
}

// ── 错因分析 ──

/**
 * 构建错因分析的用户提示词
 * @param items 错题摘要列表
 */
export function buildAnalyzePrompt(items: Array<{
  errorType?: string
  points: string[]
  subject: string
  type: string
}>): string {
  const summary = items
    .map((item, i) => {
      const pointsStr = item.points.length > 0 ? item.points.join('、') : '未分类'
      const errorStr = item.errorType || '未分类'
      return `${i + 1}. [${item.subject}] ${item.type} - 错误类型: ${errorStr} | 知识点: ${pointsStr}`
    })
    .join('\n')

  return `基于以下错题数据，生成一份详细的错因分析报告。

## 错题数据

${summary}

## 报告要求

请用中文生成 Markdown 格式的分析报告，包含：

### 1. 反复出现的错因模式
- 识别最常见的错误类型（如概念混淆、计算失误等）
- 分析这些错误背后的共同原因
- 举出具体的错题例子来说明

### 2. 最薄弱的知识点排序
- 根据知识点出现的频率和错误类型排序
- 指出哪些知识点需要重点加强
- 解释为什么这些知识点容易出错

### 3. 具体可执行的改进建议（2-4 条）
- **必须** 基于上面分析的数据，提出具体的改进建议
- **禁止** 泛泛而谈（如"多做题"、"加强复习"）
- **要求** 每条建议都要：
  - 针对具体的错误类型和知识点
  - 给出可操作的步骤（如"用 X 方法练习 Y 类型的题目"）
  - 说明预期效果

## 语言风格
- 用词准确、专业
- 每条建议都要有数据支撑
- 避免模糊的表述，要具体到题目或知识点

不要使用标题级别的 markdown（# ## ###），使用 **加粗** 来标记标题。`
}

// ── 变式出题 ──

/**
 * 构建变式出题的用户提示词
 * @param mistake 错题数据
 * @param n 要生成的变式题数量
 */
export function buildVariantsPrompt(mistake: Mistake, n: number): string {
  const pointsStr = mistake.points.length > 0
    ? mistake.points.join('、')
    : '相关知识点'
  const question = mistake.body.question || '题目不可见'

  return `基于以下错题，生成 ${n} 道变式题。

## 原题信息

- **科目**: ${mistake.subject}
- **章节**: ${mistake.chapter.join('、')}
- **知识点**: ${pointsStr}
- **题型**: ${mistake.type}
- **题目**: ${question}
${mistake.body.solution ? `- **正确解法**: ${mistake.body.solution}` : ''}
${mistake.body.cause ? `- **错误原因**: ${mistake.body.cause}` : ''}

## 变式要求

1. **知识点保持一致**：所有变式题必须考查相同的知识点
2. **变化方式**（选择一种或多种）：
   - 改变数值或参数
   - 改变问题的问法或角度
   - 改变题目的背景或情境
   - 反转问题（如由"求 X"改为"已知 X，求 Y"）
3. **难度控制**：
   - 保持与原题相当的难度（难度 ${mistake.level || 3}/5）
   - 可以略有变化，但不要突然变难很多

## 输出格式

返回严格的 JSON 对象（不要 markdown fence）：

{
  "variants": [
    {
      "stem": "变式题题目",
      "answer": "正确答案（可选）",
      "note": "变式要点说明（可选）"
    }
  ]
}

## 关键要求

- **LaTeX 格式**：所有数学公式用 $...$ (行内) 或 $$...$$ (块级) 表示
- **不要发明内容**：变式题必须基于原题信息
- **语言**：用中文
- 生成的变式题要有区分度，不要都大同小异`
}

// ── 考点排行 ──

/**
 * 构建考点排行的用户提示词
 * @param stats 统计摘要
 * @param items 错题列表
 */
export function buildForecastPrompt(
  stats: {
    total: number
    bySubject: Array<{ key: string; count: number }>
    byPoint: Array<{ key: string; count: number }>
  },
  items: Array<{
    subject: string
    points: string[]
    errorType?: string
  }>
): string {
  const subjectStats = stats.bySubject
    .map(s => `- ${s.key}: ${s.count} 题 (${((s.count / stats.total) * 100).toFixed(1)}%)`)
    .join('\n')

  const pointStats = stats.byPoint
    .slice(0, 20)
    .map(p => `- ${p.key}: ${p.count} 题`)
    .join('\n')

  const errorDistribution = items
    .reduce((acc, item) => {
      const key = item.errorType || '未分类'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  const errorStats = Object.entries(errorDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `- ${type}: ${count} 题`)
    .join('\n')

  return `基于以下错题分布数据，生成考点热度排行。

## 错题统计概览

- **总错题数**: ${stats.total}

### 科目分布
${subjectStats}

### 知识点分布（前 20）
${pointStats}

### 错误类型分布
${errorStats}

## 考点热度排行要求

1. **综合评分逻辑**：
   - 该知识点的错题数量（越高越重要）
   - 典型考试权重（如 408 中的重点章节）
   - 错误类型的严重程度（如"方法不会"比"粗心"更值得重视）

2. **必须诚实**：
   - **不要** 声称能预测具体考题
   - **不要** 猜测考试范围
   - 只能基于你收到的数据进行分析

3. **reason 字段要求**：
   - 必须解释为什么该考点是高价值的
   - 要引用具体数据（如"该知识点出现 N 次错误"）
   - 要说明考试中该知识点的典型权重

## 输出格式

返回严格的 JSON 对象（不要 markdown fence）：

{
  "topics": [
    {
      "point": "知识点名称",
      "mistakes": 错题数量,
      "score": 热度分数(0-100),
      "reason": "为什么这个考点重要（引用具体数据）"
    }
  ]
}

## 排序要求

- 按 score 降序排列
- 只输出最相关的 10-15 个考点
- 语言用中文`
}
