/**
 * 变式出题功能
 * 基于错题生成相关的变式题目，用于举一反三
 */
import { readMistake } from '../store/vault'
import { buildVariantsPrompt } from '../llm/prompts'
import { chatJSON } from '../llm/client'
import { VariantsSchema, type VariantResult } from '../llm/schema'

/**
 * 生成变式题
 * @param id 错题 ID
 * @param n 生成的变式题数量（默认 3）
 * @returns Markdown 格式的变式题
 */
export async function generateVariants(id: string, n = 3): Promise<string> {
  // 读取原始错题
  const mistake = await readMistake(id)
  if (!mistake) {
    throw new Error(`错题 ${id} 不存在`)
  }

  // 构建提示词
  const prompt = buildVariantsPrompt(mistake, n)

  // 调用 LLM 生成变式题
  const result = await chatJSON<VariantResult>({
    feature: 'generate',
    system: '你是一个专业的出题专家，能够基于给定的知识点生成高质量的变式题目。',
    user: prompt,
    schema: VariantsSchema,
    temperature: 0.7
  })

  // 渲染为 Markdown
  let markdown = `## 变式题（${result.variants.length} 道）\n\n`

  result.variants.forEach((variant, i) => {
    markdown += `### 变式 ${i + 1}\n\n`
    markdown += `**题目**\n\n${variant.stem}\n\n`

    if (variant.answer) {
      markdown += `**答案**\n\n${variant.answer}\n\n`
    }

    if (variant.note) {
      markdown += `**变式要点**\n\n${variant.note}\n\n`
    }

    if (i < result.variants.length - 1) {
      markdown += `---\n\n`
    }
  })

  return markdown
}
