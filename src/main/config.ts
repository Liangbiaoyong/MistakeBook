/**
 * 模型与 provider 配置 —— API key 使用 safeStorage 加密。
 */
import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getConfigPath, getKeysPath } from './store/paths'
import type { ProviderConfig, ModelChoice, PublicModelConfig, FeatureKey } from '@shared/types'

interface ConfigData {
  providers: ProviderConfig[]
  default: ModelChoice
  features: Partial<Record<FeatureKey, ModelChoice>>
  vaultDir?: string
}

/** OpenCode Go 需要 x-opencode-session 头，进程内保持稳定即可 */
const OPENCODE_SESSION = randomUUID()

// 首次运行时的默认 provider
const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'opencode-go',
    label: 'OpenCode Go（本地网关 · Anthropic 协议）',
    baseUrl: 'http://127.0.0.1:15721',
    format: 'anthropic',
    headers: { 'x-opencode-session': OPENCODE_SESSION }
  },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' }
]

/**
 * 默认模型选择。
 *
 * ⚠ 这里之所以是 `claude-sonnet-4-6` 这种看着不相干的模型名：OpenCode Go 网关是
 * **按模型名决定路由**的，实测只有这个名字会被路由到支持读图的视觉模型；填别的
 * （gpt-4o / qwen-vl-max / glm-4v / deepseek-flash…）会落到看不到图的模型上。
 * 换句话说这是个网关侧的别名，不是我们真的在调 Claude。
 */
const DEFAULT_CHOICE: ModelChoice = {
  provider: 'opencode-go',
  model: 'claude-sonnet-4-6',
  vision: true
}

// 四个功能默认走同一个 provider / 模型，用户只配一把 key 就能全跑通
const DEFAULT_FEATURES: Partial<Record<FeatureKey, ModelChoice>> = {
  capture: { ...DEFAULT_CHOICE },
  analyze: { ...DEFAULT_CHOICE },
  generate: { ...DEFAULT_CHOICE },
  forecast: { ...DEFAULT_CHOICE }
}

/**
 * 读取配置文件。首次运行时把默认值落盘 ——
 * 否则每次启动都会重新生成 OpenCode 的 session ID，也跟着漂。
 */
function readConfig(): ConfigData {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    const defaults: ConfigData = {
      providers: DEFAULT_PROVIDERS,
      default: DEFAULT_CHOICE,
      features: DEFAULT_FEATURES
    }
    try {
      writeConfig(defaults)
    } catch {
      // 落盘失败不该阻塞启动，内存里用默认值就行
    }
    return defaults
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content)

    return {
      providers: config.providers ?? DEFAULT_PROVIDERS,
      default: config.default ?? DEFAULT_CHOICE,
      features: config.features ?? DEFAULT_FEATURES,
      vaultDir: config.vaultDir
    }
  } catch {
    return {
      providers: DEFAULT_PROVIDERS,
      default: DEFAULT_CHOICE,
      features: DEFAULT_FEATURES
    }
  }
}

/**
 * 写入配置文件（原子化）
 */
function writeConfig(config: ConfigData): void {
  const configPath = getConfigPath()
  const tmpPath = configPath + '.tmp'

  writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
  renameSync(tmpPath, configPath)
}

/**
 * 获取公开的模型配置（不包含 API keys）
 */
export function getPublicConfig(): PublicModelConfig {
  const config = readConfig()
  const keys = readKeys()

  const keysSet: Record<string, boolean> = {}
  for (const provider of config.providers) {
    keysSet[provider.id] = !!keys[provider.id]
  }

  return {
    providers: config.providers,
    keysSet,
    default: config.default,
    features: config.features
  }
}

/**
 * 获取指定功能的模型配置（含 default 回落）
 */
export function getFeatureModel(feature: FeatureKey | 'default'): ModelChoice {
  const config = readConfig()

  if (feature === 'default') {
    return config.default
  }

  return config.features[feature] ?? config.default
}

/**
 * 设置指定功能的模型选择
 */
export function setChoice(feature: FeatureKey | 'default', choice: ModelChoice): void {
  const config = readConfig()

  if (feature === 'default') {
    config.default = choice
  } else {
    config.features[feature] = choice
  }

  writeConfig(config)
}

/**
 * 读取加密的 API keys
 */
function readKeys(): Record<string, string> {
  const keysPath = getKeysPath()

  if (!existsSync(keysPath)) {
    return {}
  }

  try {
    const encrypted = readFileSync(keysPath)
    const decrypted = safeStorage.decryptString(encrypted)
    return JSON.parse(decrypted)
  } catch {
    return {}
  }
}

/**
 * 写入加密的 API keys
 */
function writeKeys(keys: Record<string, string>): void {
  const keysPath = getKeysPath()
  const json = JSON.stringify(keys)
  const encrypted = safeStorage.encryptString(json)

  const tmpPath = keysPath + '.tmp'
  writeFileSync(tmpPath, encrypted)
  renameSync(tmpPath, keysPath)
}

/**
 * 设置 provider 的 API key（加密存储）
 */
export function setProviderKey(providerId: string, apiKey: string): void {
  const keys = readKeys()
  keys[providerId] = apiKey
  writeKeys(keys)
}

/**
 * 获取 provider 的 API key（解密）
 */
export function getProviderKey(providerId: string): string | null {
  const keys = readKeys()
  return keys[providerId] ?? null
}

/** 取完整的 provider 配置（含 format 与附加请求头） */
export function getProviderById(providerId: string): ProviderConfig | null {
  return readConfig().providers.find((p) => p.id === providerId) ?? null
}

/**
 * 新增或更新 provider 配置
 */
export function upsertProvider(p: ProviderConfig): void {
  const config = readConfig()

  const existingIndex = config.providers.findIndex(pr => pr.id === p.id)
  if (existingIndex !== -1) {
    config.providers[existingIndex] = p
  } else {
    config.providers.push(p)
  }

  writeConfig(config)
}

/**
 * 移除 provider（同时删除其 API key）
 */
export function removeProviderKey(providerId: string): void {
  const keys = readKeys()
  delete keys[providerId]
  writeKeys(keys)
}
