/**
 * 模型与 provider 配置 —— API key 使用 safeStorage 加密。
 */
import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { getConfigPath, getKeysPath } from './store/paths'
import type { ProviderConfig, ModelChoice, PublicModelConfig, FeatureKey } from '@shared/types'

interface ConfigData {
  providers: ProviderConfig[]
  default: ModelChoice
  features: Partial<Record<FeatureKey, ModelChoice>>
  vaultDir?: string
}

// 首次运行时的默认 provider
const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' }
]

const DEFAULT_CHOICE: ModelChoice = {
  provider: 'deepseek',
  model: 'deepseek-flash',
  vision: true
}

const DEFAULT_FEATURES: Partial<Record<FeatureKey, ModelChoice>> = {
  capture: { ...DEFAULT_CHOICE },
  analyze: { provider: 'deepseek', model: 'deepseek-flash' },
  generate: { provider: 'deepseek', model: 'deepseek-flash' },
  forecast: { provider: 'deepseek', model: 'deepseek-flash' }
}

/**
 * 读取配置文件
 */
function readConfig(): ConfigData {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return {
      providers: DEFAULT_PROVIDERS,
      default: DEFAULT_CHOICE,
      features: DEFAULT_FEATURES
    }
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
