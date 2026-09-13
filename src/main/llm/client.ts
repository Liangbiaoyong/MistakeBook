/**
 * OpenAI 兼容 LLM 客户端
 * 支持文本和视觉模型，带 Zod 验证和自动修复机制
 */
import { readFile } from 'node:fs/promises'
import type { ZodType } from 'zod'
import type { FeatureKey } from '@shared/types'
import { getFeatureModel, getProviderKey } from '../config'

// ── 自定义错误类 ──

/** API Key 未配置错误 */
export class MissingKeyError extends Error {
  constructor(providerId: string) {
    super(`未配置 ${providerId} 的 API Key。请在设置中配置。`)
    this.name = 'MissingKeyError'
  }
}

/** 模型不支持视觉功能错误 */
export class VisionUnsupportedError extends Error {
  constructor(model: string) {
    super(`模型 ${model} 不支持图片输入。请在设置中选择支持视觉的模型。`)
    this.name = 'VisionUnsupportedError'
  }
}

// ── 类型定义 ──

/** 解析后的 endpoint 信息 */
interface Endpoint {
  baseUrl: string
  apiKey: string | null
}

/** Chat completion 请求的消息格式 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}

/** OpenAI 兼容的 chat completion 响应 */
interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

// ── 核心函数 ──

/**
 * 解析 provider 的 endpoint 信息
 * @param providerId Provider ID
 * @returns 包含 baseUrl 和 apiKey 的对象
 */
export function resolveEndpoint(providerId: string): Endpoint {
  const key = getProviderKey(providerId)
  if (!key) {
    return { baseUrl: '', apiKey: null }
  }

  // 从 public config 获取 baseUrl
  const config = getPublicConfig()
  const provider = config.providers.find((p: { id: string }) => p.id === providerId)
  if (!provider) {
    return { baseUrl: '', apiKey: null }
  }

  return {
    baseUrl: provider.baseUrl,
    apiKey: key
  }
}

/**
 * 调用 chat completion API 并返回 JSON
 * 带自动修复机制：如果首次验证失败，会发送修复消息重试一次
 */
export async function chatJSON<T>(opts: {
  feature: FeatureKey
  system: string
  user: string
  schema: ZodType<T>
  temperature?: number
  signal?: AbortSignal
}): Promise<T> {
  const { feature, system, user, schema, temperature = 0.3, signal } = opts
  const modelChoice = getFeatureModel(feature)

  const { baseUrl, apiKey } = resolveEndpoint(modelChoice.provider)
  if (!apiKey) {
    throw new MissingKeyError(modelChoice.provider)
  }

  // 超时控制（如果没传 signal）
  const timeoutSignal = signal || AbortSignal.timeout(120_000)

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]

  let lastResponse: string | null = null
  let lastError: unknown = null

  // 最多尝试 2 次（首次 + 修复一次）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelChoice.model,
          messages,
          temperature,
          max_tokens: 4096
        }),
        signal: timeoutSignal
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`API 错误 ${response.status}: ${body.slice(0, 200)}`)
      }

      const data: ChatCompletionResponse = await response.json()
      if (!data.choices || data.choices.length === 0) {
        throw new Error('模型返回空结果')
      }

      lastResponse = data.choices[0].message.content

      // 清理可能的 markdown fence
      let cleaned = lastResponse.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()

      // JSON parse
      const parsed = JSON.parse(cleaned)

      // Zod 验证
      const result = schema.safeParse(parsed)
      if (result.success) {
        return result.data
      } else {
        // Zod 验证失败
        lastError = new Error(`Schema 验证失败: ${result.error.issues.map((e: { message: string }) => e.message).join(', ')}`)

        // 如果是第二次尝试，抛出错误
        if (attempt === 1) {
          break
        }

        // 构建修复消息
        messages.push({
          role: 'assistant',
          content: lastResponse
        })
        messages.push({
          role: 'user',
          content: `你上次的输出不是合法 JSON。请只返回 JSON 对象，不要包含其他文本。错误信息：${lastError instanceof Error ? lastError.message : String(lastError)}`
        })
      }
    } catch (error) {
      lastError = error

      // 如果是超时或中断，直接抛出
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      // 如果是第二次尝试，抛出
      if (attempt === 1) {
        break
      }

      // 构建修复消息
      messages.push({
        role: 'user',
        content: `上一次调用失败：${error instanceof Error ? error.message : '未知错误'}。请重新尝试，只返回有效的 JSON 对象。`
      })
    }
  }

  // 所有尝试都失败
  const errorMsg = lastError instanceof Error
    ? lastError.message
    : '未知错误'
  throw new Error(`无法生成有效输出。${errorMsg}`)
}

/**
 * 调用视觉模型并返回 JSON
 * 支持图片输入，带自动修复机制
 */
export async function chatVisionJSON<T>(opts: {
  system: string
  user: string
  imageAbsPath: string
  schema: ZodType<T>
  signal?: AbortSignal
}): Promise<T> {
  const { system, user, imageAbsPath, schema, signal } = opts
  const modelChoice = getFeatureModel('capture')

  // 检查模型是否支持视觉
  if (!modelChoice.vision) {
    throw new VisionUnsupportedError(modelChoice.model)
  }

  const { baseUrl, apiKey } = resolveEndpoint(modelChoice.provider)
  if (!apiKey) {
    throw new MissingKeyError(modelChoice.provider)
  }

  // 读取图片并转 base64
  const imageBuffer = await readFile(imageAbsPath)
  const base64 = imageBuffer.toString('base64')
  const dataUrl = `data:image/png;base64,${base64}`

  // 超时控制
  const timeoutSignal = signal || AbortSignal.timeout(120_000)

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: user },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ]

  let lastResponse: string | null = null
  let lastError: unknown = null

  // 最多尝试 2 次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelChoice.model,
          messages,
          temperature: 0.2,
          max_tokens: 4096
        }),
        signal: timeoutSignal
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`API 错误 ${response.status}: ${body.slice(0, 200)}`)
      }

      const data: ChatCompletionResponse = await response.json()
      if (!data.choices || data.choices.length === 0) {
        throw new Error('模型返回空结果')
      }

      lastResponse = data.choices[0].message.content

      // 清理可能的 markdown fence
      let cleaned = lastResponse.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()

      // JSON parse
      const parsed = JSON.parse(cleaned)

      // Zod 验证
      const result = schema.safeParse(parsed)
      if (result.success) {
        return result.data
      } else {
        lastError = new Error(`Schema 验证失败: ${result.error.issues.map((e: { message: string }) => e.message).join(', ')}`)

        if (attempt === 1) {
          break
        }

        // 构建修复消息
        messages.push({
          role: 'assistant',
          content: lastResponse
        })
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: `你上次的输出不是合法 JSON。请只返回 JSON 对象，不要包含其他文本。错误信息：${lastError instanceof Error ? lastError.message : String(lastError)}` }
          ]
        })
      }
    } catch (error) {
      lastError = error

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      if (attempt === 1) {
        break
      }

      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `上一次调用失败：${error instanceof Error ? error.message : '未知错误'}。请重新尝试，只返回有效的 JSON 对象。` }
        ]
      })
    }
  }

  const errorMsg = lastError instanceof Error
    ? lastError.message
    : '未知错误'
  throw new Error(`无法生成有效输出。${errorMsg}`)
}

/**
 * 调用 chat completion API 并返回纯文本
 * 用于分析报告等不需要结构化输出的场景
 */
export async function chatText(opts: {
  feature: FeatureKey
  system: string
  user: string
  signal?: AbortSignal
}): Promise<string> {
  const { feature, system, user, signal } = opts
  const modelChoice = getFeatureModel(feature)

  const { baseUrl, apiKey } = resolveEndpoint(modelChoice.provider)
  if (!apiKey) {
    throw new MissingKeyError(modelChoice.provider)
  }

  const timeoutSignal = signal || AbortSignal.timeout(120_000)

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelChoice.model,
      messages,
      temperature: 0.5,
      max_tokens: 4096
    }),
    signal: timeoutSignal
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`API 错误 ${response.status}: ${body.slice(0, 200)}`)
  }

  const data: ChatCompletionResponse = await response.json()
  if (!data.choices || data.choices.length === 0) {
    throw new Error('模型返回空结果')
  }

  return data.choices[0].message.content
}

// ── 辅助函数 ──

/**
 * 获取 public config（避免直接导入，便于测试）
 */
function getPublicConfig() {
  // 动态导入避免循环依赖
  const { getPublicConfig: getConfig } = require('../config')
  return getConfig()
}
