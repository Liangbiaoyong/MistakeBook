/**
 * LLM 客户端 —— 同时支持两种协议格式：
 *   - openai   : POST {baseUrl}/chat/completions
 *   - anthropic: POST {baseUrl}/v1/messages
 *
 * 所有模型输出都是**不可信输入**，必须过 Zod 才算数；
 * 校验失败会带着错误信息重试一次，仍失败就如实抛出，绝不写坏文件。
 */
import { readFile } from 'node:fs/promises'
import type { ZodType } from 'zod'
import type { ApiFormat, FeatureKey, ModelChoice, ModelInfo, ProviderConfig } from '@shared/types'
import { getFeatureModel, getProviderKey, getProviderById } from '../config'

/* ────────────── 错误类型 ────────────── */

export class MissingKeyError extends Error {
  constructor(providerId: string) {
    super(`未配置 ${providerId} 的 API Key。请在「设置」里填写。`)
    this.name = 'MissingKeyError'
  }
}

export class VisionUnsupportedError extends Error {
  constructor(model: string) {
    super(`模型 ${model} 不支持图片输入，请到「设置 → 采集识别」换一个能读图的模型。`)
    this.name = 'VisionUnsupportedError'
  }
}

/* ────────────── 内部模型 ────────────── */

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaType: string; base64: string }

interface Turn {
  role: 'system' | 'user' | 'assistant'
  blocks: Block[]
}

export function text(s: string): Block {
  return { kind: 'text', text: s }
}

interface Transport {
  chatUrl(baseUrl: string): string
  modelsUrl(baseUrl: string): string
  headers(apiKey: string, extra?: Record<string, string>): Record<string, string>
  /** 只负责构造请求体；URL 与请求头由这个 transport 的另外两个方法给出 */
  build(model: string, turns: Turn[], maxTokens: number, temperature: number): unknown
  extractText(json: unknown): string
}

/* ────────────── OpenAI 兼容 ────────────── */

const openai: Transport = {
  chatUrl: (b) => `${trimSlash(b)}/chat/completions`,
  modelsUrl: (b) => `${trimSlash(b)}/models`,
  headers: (key, extra) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${key}`,
    ...extra
  }),
  build: (model, turns, maxTokens, temperature) => ({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: turns.map((t) => ({
      role: t.role,
      content:
        t.blocks.length === 1 && t.blocks[0].kind === 'text'
          ? t.blocks[0].text
          : t.blocks.map((blk) =>
              blk.kind === 'text'
                ? { type: 'text', text: blk.text }
                : { type: 'image_url', image_url: { url: `data:${blk.mediaType};base64,${blk.base64}` } }
            )
    }))
  }),
  extractText: (json) => {
    const j = json as { choices?: Array<{ message?: { content?: unknown } }> }
    const c = j.choices?.[0]?.message?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return c
        .map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text?: string }).text ?? '') : ''))
        .join('')
    }
    return ''
  }
}

/* ────────────── Anthropic 兼容 ────────────── */

const anthropic: Transport = {
  chatUrl: (b) => `${trimSlash(b)}/v1/messages`,
  modelsUrl: (b) => `${trimSlash(b)}/v1/models`,
  headers: (key, extra) => ({
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': key,
    // 有些网关（如 OpenCode Go）只认 Bearer，两个都带上是无害的
    authorization: `Bearer ${key}`,
    ...extra
  }),
  build: (model, turns, maxTokens, temperature) => {
    // Anthropic 的 system 是顶层字段，不是一条消息
    const system = turns
      .filter((t) => t.role === 'system')
      .flatMap((t) => t.blocks)
      .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n\n')

    const messages = turns
      .filter((t) => t.role !== 'system')
      .map((t) => ({
        role: t.role,
        content: t.blocks.map((blk) =>
          blk.kind === 'text'
            ? { type: 'text', text: blk.text }
            : {
                type: 'image',
                source: { type: 'base64', media_type: blk.mediaType, data: blk.base64 }
              }
        )
      }))

    return {
      model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages
    }
  },
  extractText: (json) => {
    const j = json as { content?: Array<{ type?: string; text?: string }> }
    // 只取 text 块，忽略 thinking —— 有些网关默认开思考模式，会把预算吃光
    return (j.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
  }
}

function transportFor(format: ApiFormat | undefined): Transport {
  return format === 'anthropic' ? anthropic : openai
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

/* ────────────── 端点解析 ────────────── */

interface Resolved {
  provider: ProviderConfig
  apiKey: string
  transport: Transport
}

function resolve(choice: ModelChoice): Resolved {
  const provider = getProviderById(choice.provider)
  if (!provider) {
    // provider 不限于预置的那几个，用户可自由填；这里要说清怎么补，而不是干巴巴地报「未知」
    throw new Error(
      `还没配置名为「${choice.provider}」的 provider。请到「设置」把它补出来（填 id、baseUrl，可选协议格式与请求头），或改用一个已存在的 provider。`
    )
  }
  const apiKey = getProviderKey(choice.provider)
  if (!apiKey) throw new MissingKeyError(choice.provider)
  return { provider, apiKey, transport: transportFor(provider.format) }
}

/* ────────────── 请求 ────────────── */

async function callModel(
  r: Resolved,
  choice: ModelChoice,
  turns: Turn[],
  opts: { maxTokens: number; temperature: number; signal?: AbortSignal }
): Promise<string> {
  const body = r.transport.build(choice.model, turns, opts.maxTokens, opts.temperature)
  const res = await fetch(r.transport.chatUrl(r.provider.baseUrl), {
    method: 'POST',
    headers: r.transport.headers(r.apiKey, r.provider.headers),
    body: JSON.stringify(body),
    signal: opts.signal ?? AbortSignal.timeout(180_000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`接口返回 ${res.status}：${body.slice(0, 300)}`)
  }
  const json: unknown = await res.json()
  const out = r.transport.extractText(json)
  if (!out.trim()) {
    // 把返回了哪些块说清楚，排查时省得靠猜：
    // 有的是思考模型把预算全用在 reasoning 上，text 块就成了空的
    const kinds =
      (json as { content?: Array<{ type?: string }> })?.content?.map((b) => b.type).join(', ') ||
      Object.keys(json as object).join(', ')
    throw new Error(
      `模型没有返回文本内容（返回的块：${kinds || '未知'}）。可能是思考占满了输出预算，或该模型不支持图片输入。`
    )
  }
  return out
}

function stripFence(s: string): string {
  return s
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

/** 带「一次带错重试」的 JSON 调用共用心跳 */
async function runJSON<T>(
  r: Resolved,
  choice: ModelChoice,
  turns: Turn[],
  schema: ZodType<T>,
  opts: { maxTokens: number; temperature: number; signal?: AbortSignal }
): Promise<T> {
  let lastError = ''
  let maxTokens = opts.maxTokens
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string
    try {
      raw = await callModel(r, choice, turns, { ...opts, maxTokens })
    } catch (e) {
      // 传输层失败（网络、空内容、限流）也重试一次 —— 这类失败常常是偶发的
      lastError = e instanceof Error ? e.message : String(e)
      if (attempt === 1) break
      // 空内容多半是「思考」把输出预算吃光了（有的网关默认开思考模式，且忽略关闭参数）。
      // 重试时把预算翻倍，而不是原地撞同一堵墙。
      if (lastError.includes('没有返回文本内容')) {
        maxTokens = Math.min(maxTokens * 2, 16384)
      }
      turns = [
        ...turns,
        { role: 'user', blocks: [text(`上一次调用失败：${lastError}。请直接给出结果。`)] }
      ]
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stripFence(raw))
    } catch {
      lastError = '输出不是合法 JSON'
      if (attempt === 1) break
      turns = [
        ...turns,
        { role: 'assistant', blocks: [text(raw)] },
        { role: 'user', blocks: [text('你上次的输出不是合法 JSON。请只返回 JSON 对象本身，不要任何解释或代码围栏。')] }
      ]
      continue
    }
    const check = schema.safeParse(parsed)
    if (check.success) return check.data
    lastError = check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    if (attempt === 1) break
    turns = [
      ...turns,
      { role: 'assistant', blocks: [text(raw)] },
      {
        role: 'user',
        blocks: [text(`输出不符合约定结构，问题：${lastError}。请修正后只返回 JSON 对象。`)]
      }
    ]
  }
  throw new Error(`无法得到符合约定的输出（${lastError}）`)
}

/* ────────────── 对外 API ────────────── */

export interface ChatOpts {
  /** 按功能位取模型；与 choice 二选一 */
  feature?: FeatureKey
  /** 直接指定模型；与 feature 二选一（设置页的「测试」用它） */
  choice?: ModelChoice
  system?: string
  user: string
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
}

function pickChoice(o: ChatOpts): ModelChoice {
  if (o.choice) return o.choice
  if (o.feature) return getFeatureModel(o.feature)
  throw new Error('必须指定 feature 或 choice')
}

function baseTurns(o: ChatOpts, extra: Block[] = []): Turn[] {
  const turns: Turn[] = []
  if (o.system) turns.push({ role: 'system', blocks: [text(o.system)] })
  turns.push({ role: 'user', blocks: [...extra, text(o.user)] })
  return turns
}

/** 纯文本调用 */
export async function chatText(o: ChatOpts): Promise<string> {
  const choice = pickChoice(o)
  return callModel(resolve(choice), choice, baseTurns(o), {
    maxTokens: o.maxTokens ?? 4096,
    temperature: o.temperature ?? 0.4,
    signal: o.signal
  })
}

/** 结构化 JSON 调用 */
export async function chatJSON<T>(
  o: ChatOpts & { schema: ZodType<T> }
): Promise<T> {
  const choice = pickChoice(o)
  return runJSON(resolve(choice), choice, baseTurns(o), o.schema, {
    maxTokens: o.maxTokens ?? 4096,
    temperature: o.temperature ?? 0.2,
    signal: o.signal
  })
}

/** 带图片的结构化 JSON 调用 */
export async function chatVisionJSON<T>(o: {
  system?: string
  user: string
  imageAbsPath: string
  schema: ZodType<T>
  signal?: AbortSignal
  maxTokens?: number
}): Promise<T> {
  const choice = getFeatureModel('capture')
  if (choice.vision === false) throw new VisionUnsupportedError(choice.model)

  const buf = await readFile(o.imageAbsPath)
  const block: Block = {
    kind: 'image',
    mediaType: detectMediaType(buf),
    base64: buf.toString('base64')
  }
  return runJSON(resolve(choice), choice, baseTurns(o, [block]), o.schema, {
    maxTokens: o.maxTokens ?? 4096,
    temperature: 0.1,
    signal: o.signal
  })
}

/** 拉取模型列表。厂商支持就返回，不支持时抛错（由调用方展示原因） */
export async function listModels(providerId: string): Promise<ModelInfo[]> {
  const provider = getProviderById(providerId)
  if (!provider) {
    throw new Error(`还没配置名为「${providerId}」的 provider，先在「设置」里把它补出来。`)
  }
  const apiKey = getProviderKey(providerId)
  if (!apiKey) throw new MissingKeyError(providerId)

  const t = transportFor(provider.format)
  const res = await fetch(t.modelsUrl(provider.baseUrl), {
    method: 'GET',
    headers: t.headers(apiKey, provider.headers),
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`接口返回 ${res.status}：${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    data?: Array<{ id?: string; name?: string; display_name?: string }>
    models?: Array<{ id?: string; name?: string }>
  }
  // openai 是 data[]，有些网关用 models[]
  const list = json.data ?? json.models ?? []
  const out: ModelInfo[] = []
  for (const m of list) {
    const id = m.id ?? (m as { name?: string }).name ?? ''
    if (!id) continue
    const label = (m as { display_name?: string }).display_name
    out.push(label ? { id, label } : { id })
  }
  return out
}

function detectMediaType(buf: Buffer): string {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (buf.length > 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  // 扫描件常见情况：按 PNG 报，比报错让用户困惑要好
  return 'image/png'
}
