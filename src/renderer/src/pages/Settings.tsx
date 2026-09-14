import { useState, useEffect, useCallback } from 'react'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import { Icon, cuCard, cuIconBox, cuCtaPrimary, cuCtaGhost, cuNotice } from '../design/tokens'
import type { PublicModelConfig, FeatureKey, ModelChoice, ProviderConfig, ModelInfo } from '@shared/types'
import { FEATURE_KEYS } from '@shared/types'

const FEATURE_LABELS: Record<FeatureKey | 'default', string> = {
  capture: '采集识别（必须支持读图）',
  analyze: '错因分析',
  generate: '变式出题',
  forecast: '考点排行',
  default: '全局默认',
}

const COMMON_BASEURLS = [
  'https://api.deepseek.com',
  'https://api.openai.com/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://open.bigmodel.cn/api/paas/v4',
  'https://api.siliconflow.cn/v1',
  'https://api.moonshot.cn/v1',
  'https://api.deepseek.com/anthropic',
  'http://127.0.0.1:15721',
]

export default function Settings() {
  const [config, setConfig] = useState<PublicModelConfig | null>(null)
  const [vaultPath, setVaultPath] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [testResults, setTestResults] = useState<Record<string, { latency?: number; error?: string }>>({})
  const [testingKey, setTestingKey] = useState<string | null>(null)
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({})
  const [savingKeyFor, setSavingKeyFor] = useState<string | null>(null)
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null)
  const [vaultCount, setVaultCount] = useState<number | null>(null)
  const [indexRebuilding, setIndexRebuilding] = useState(false)
  const [examDate, setExamDate] = useState('')
  const [hotkey, setHotkey] = useState('')
  const [autoSaveSeconds, setAutoSaveSeconds] = useState<number>(30)
  const [statsWindowDays, setStatsWindowDays] = useState<number>(30)
  const [planMsg, setPlanMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [savingPlan, setSavingPlan] = useState(false)
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({})
  const [modelLists, setModelLists] = useState<Record<string, ModelInfo[]>>({})
  const [modelListStatus, setModelListStatus] = useState<Record<string, string | null>>({})
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    const configResult = await window.api.configGet()
    const vaultResult = await window.api.vaultGet()
    const settingsResult = await window.api.settingsGet()
    if (!configResult.ok) {
      setError(configResult.error ?? '加载配置失败')
    } else {
      setConfig(configResult.data ?? null)
    }
    if (vaultResult.ok) {
      setVaultPath(vaultResult.data ?? '')
    }
    if (settingsResult.ok && settingsResult.data) {
      setExamDate(settingsResult.data.examDate ?? '')
      setHotkey(settingsResult.data.hotkey)
      setAutoSaveSeconds(settingsResult.data.autoSaveSeconds ?? 30)
      setStatsWindowDays(settingsResult.data.statsWindowDays ?? 30)
    }
    setLoading(false)
  }, [])

  const handleSavePlan = async () => {
    setSavingPlan(true)
    setPlanMsg(null)
    const result = await window.api.settingsSet({
      examDate: examDate || undefined,
      hotkey: hotkey.trim() || undefined,
      autoSaveSeconds: autoSaveSeconds,
      statsWindowDays: statsWindowDays
    })
    if (result.ok && result.data) {
      setHotkey(result.data.hotkey)
      setAutoSaveSeconds(result.data.autoSaveSeconds ?? 30)
      setStatsWindowDays(result.data.statsWindowDays ?? 30)
      setPlanMsg({ kind: 'ok', text: '已保存' })
    } else {
      setPlanMsg({ kind: 'error', text: result.error ?? '保存失败' })
    }
    setSavingPlan(false)
  }

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const handleTest = async (key: string, choice: ModelChoice) => {
    setTestingKey(key)
    const result = await window.api.configTest(choice)
    if (result.ok) {
      setTestResults((prev) => ({
        ...prev,
        [key]: { latency: result.data?.latencyMs },
      }))
    } else {
      setTestResults((prev) => ({
        ...prev,
        [key]: { error: result.error ?? '测试失败' },
      }))
    }
    setTestingKey(null)
  }

  const handleSaveKey = async (providerId: string) => {
    const key = providerKeys[providerId]
    if (!key) return
    setSavingKeyFor(providerId)
    const result = await window.api.configSetProviderKey(providerId, key)
    setSavingKeyFor(null)
    if (!result.ok) {
      setTestResults((prev) => ({
        ...prev,
        [`key_${providerId}`]: { error: result.error ?? '保存密钥失败' },
      }))
    } else {
      setProviderKeys((prev) => ({ ...prev, [providerId]: '' }))
      await loadConfig()
    }
  }

  const handleRemoveKey = async (providerId: string) => {
    const result = await window.api.configRemoveProviderKey(providerId)
    if (!result.ok) {
      setTestResults((prev) => ({
        ...prev,
        [`key_${providerId}`]: { error: result.error ?? '清除密钥失败' },
      }))
    } else {
      await loadConfig()
    }
  }

  const handleSaveProvider = async () => {
    if (!editingProvider) return
    const result = await window.api.configUpsertProvider(editingProvider)
    if (!result.ok) {
      setError(result.error ?? '保存 Provider 失败')
    } else {
      setEditingProvider(null)
      await loadConfig()
    }
  }

  const handleChooseVault = async () => {
    const result = await window.api.vaultChoose()
    if (result.ok && result.data) {
      setVaultPath(result.data)
    }
  }

  const handleRebuildIndex = async () => {
    setIndexRebuilding(true)
    const result = await window.api.indexRebuild()
    setIndexRebuilding(false)
    if (result.ok) {
      setVaultCount(result.data?.count ?? 0)
    } else {
      setError(result.error ?? '重建索引失败')
    }
  }

  const handleFetchModels = async (providerId: string) => {
    setFetchingModels((prev) => ({ ...prev, [providerId]: true }))
    setModelListStatus((prev) => ({ ...prev, [providerId]: null }))
    const result = await window.api.configListModels(providerId)
    if (!result.ok) {
      setModelListStatus((prev) => ({ ...prev, [providerId]: 'error' }))
      setTestResults((prev) => ({
        ...prev,
        [`models_${providerId}`]: { error: result.error ?? '拉取模型失败' },
      }))
    } else if (!result.data || result.data.length === 0) {
      setModelListStatus((prev) => ({ ...prev, [providerId]: 'empty' }))
    } else {
      setModelLists((prev) => ({ ...prev, [providerId]: result.data! }))
      setModelListStatus((prev) => ({ ...prev, [providerId]: 'ok' }))
    }
    setFetchingModels((prev) => ({ ...prev, [providerId]: false }))
  }

  const parseHeaders = (text: string): Record<string, string> => {
    const headers: Record<string, string> = {}
    text.split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) return
      const key = trimmed.slice(0, colonIndex).trim()
      const value = trimmed.slice(colonIndex + 1).trim()
      if (key && value) {
        headers[key] = value
      }
    })
    return headers
  }

  const formatHeaders = (headers: Record<string, string> | undefined): string => {
    if (!headers || Object.keys(headers).length === 0) return ''
    return Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  }

  const toggleExpandProvider = (providerId: string) => {
    if (expandedProviderId === providerId) {
      setExpandedProviderId(null)
      setEditingProvider(null)
    } else {
      const provider = config?.providers.find(p => p.id === providerId)
      if (provider) {
        setEditingProvider({
          id: provider.id,
          label: provider.label,
          baseUrl: provider.baseUrl,
          format: provider.format,
          headers: provider.headers,
        })
        setExpandedProviderId(providerId)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner label="加载设置..." />
      </div>
    )
  }

  if (error && !config) {
    return (
      <div className="p-8">
        <div className={cuNotice('error')}>{error}</div>
      </div>
    )
  }

  if (!config) return null

  const resolveChoice = (feature: FeatureKey | 'default'): ModelChoice => {
    if (feature === 'default') return config.default
    return config.features[feature] ?? config.default
  }

  return (
    <div className="p-8 overflow-y-auto h-full">
      <PageHeader title="设置" subtitle="模型配置与仓库管理" />

      {error && <div className={cuNotice('error') + ' mb-6'}>{error}</div>}

      {/* Provider 管理 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white/90 mb-2">Provider 管理</h2>
        <p className="text-white/50 text-xs mb-4">管理 API 服务商的连接信息、协议格式和密钥。点击行展开编辑。</p>
        <div className="space-y-4">
          {config.providers.map((p) => {
            const hasKey = config.keysSet[p.id] ?? false
            const isExpanded = expandedProviderId === p.id && editingProvider

            return (
              <div key={p.id} className={cuCard({ tight: true })}>
                {/* Collapsed row */}
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => toggleExpandProvider(p.id)}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`${cuIconBox} h-8 w-8`}>
                      <Icon name="settings" className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white/90 text-sm">{p.id}</span>
                        {p.label && <span className="text-white/60 text-xs">· {p.label}</span>}
                      </div>
                      <div className="text-white/50 text-xs truncate">{p.baseUrl || '未配置'}</div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50 shrink-0">
                      {p.format === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        hasKey ? 'bg-mint/20 text-mint' : 'bg-white/10 text-white/50'
                      } shrink-0`}
                    >
                      {hasKey ? '已配置密钥' : '未配置密钥'}
                    </span>
                    <Icon
                      name={isExpanded ? 'close' : 'edit'}
                      className="h-4 w-4 text-white/40 shrink-0"
                    />
                  </div>
                </div>

                {/* Expanded editor */}
                {isExpanded && editingProvider && (
                  <div className="mt-4 pt-4 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editingProvider.id}
                        onChange={(e) => setEditingProvider({ ...editingProvider, id: e.target.value })}
                        placeholder="ID（如 my-provider）"
                        className="cu-input text-sm px-3 py-1.5 w-full"
                        data-field="id"
                      />
                      <input
                        type="text"
                        value={editingProvider.label}
                        onChange={(e) => setEditingProvider({ ...editingProvider, label: e.target.value })}
                        placeholder="显示名称（可选）"
                        className="cu-input text-sm px-3 py-1.5 w-full"
                        data-field="label"
                      />
                      <div>
                        <input
                          type="text"
                          value={editingProvider.baseUrl}
                          onChange={(e) => setEditingProvider({ ...editingProvider, baseUrl: e.target.value })}
                          placeholder="Base URL"
                          className="cu-input text-sm px-3 py-1.5 w-full"
                          data-field="baseUrl"
                          list="cu-baseurls"
                        />
                        <datalist id="cu-baseurls">
                          {COMMON_BASEURLS.map((url) => (
                            <option key={url} value={url} />
                          ))}
                        </datalist>
                        <p className="text-white/40 text-xs mt-1">从常用列表中选择或自行输入</p>
                      </div>
                      <div>
                        <label className="block text-white/70 text-xs mb-1">协议格式</label>
                        <select
                          value={editingProvider.format ?? 'openai'}
                          onChange={(e) =>
                            setEditingProvider({
                              ...editingProvider,
                              format: e.target.value as 'openai' | 'anthropic',
                            })
                          }
                          className="cu-input text-sm px-3 py-1.5 w-full"
                        >
                          <option value="openai">OpenAI 兼容</option>
                          <option value="anthropic">Anthropic 兼容</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-white/70 text-xs mb-1">附加请求头</label>
                        <textarea
                          value={formatHeaders(editingProvider.headers)}
                          onChange={(e) =>
                            setEditingProvider({
                              ...editingProvider,
                              headers: parseHeaders(e.target.value),
                            })
                          }
                          placeholder="Key: Value（每行一个）"
                          className="cu-textarea text-sm px-3 py-1.5 w-full h-20"
                        />
                      </div>
                      <div className={cuNotice('info') + ' text-xs'}>
                        <p className="mb-1">
                          <strong>openai</strong> 格式：聊天走 baseUrl/chat/completions，模型列表走 baseUrl/models
                        </p>
                        <p>
                          <strong>anthropic</strong> 格式：聊天走 baseUrl/v1/messages，模型列表走 baseUrl/v1/models
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={providerKeys[p.id] ?? ''}
                          onChange={(e) =>
                            setProviderKeys((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          placeholder="输入 API Key"
                          className="cu-input text-sm px-3 py-1.5 flex-1"
                        />
                        <button
                          onClick={() => handleSaveKey(p.id)}
                          disabled={!providerKeys[p.id] || savingKeyFor === p.id}
                          className={`${cuCtaPrimary} px-4 py-1.5 text-xs`}
                        >
                          {savingKeyFor === p.id ? <Spinner label="" /> : '保存密钥'}
                        </button>
                        {hasKey && (
                          <button
                            onClick={() => handleRemoveKey(p.id)}
                            className={`${cuCtaGhost} px-2 py-1 text-xs text-coral`}
                            aria-label={`清除 ${p.id} 密钥`}
                          >
                            <Icon name="trash" className="h-4 w-4" />
                            清除
                          </button>
                        )}
                      </div>
                      <p className="text-white/40 text-xs">
                        密钥通过操作系统凭证库加密存储，不会在界面上回显
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={handleSaveProvider}
                          disabled={!editingProvider.id || !editingProvider.baseUrl}
                          className={`${cuCtaPrimary} px-4 py-1.5 text-xs`}
                        >
                          保存
                        </button>
                        <button
                          onClick={() => {
                            setEditingProvider(null)
                            setExpandedProviderId(null)
                          }}
                          className={`${cuCtaGhost} px-4 py-1.5 text-xs`}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <button
            onClick={() => {
              const newId = `provider-${Date.now()}`
              setEditingProvider({
                id: newId,
                label: '',
                baseUrl: '',
                format: 'openai',
                headers: {},
              })
              setExpandedProviderId(newId)
            }}
            className={`${cuCtaGhost} px-4 py-2 text-sm`}
          >
            <Icon name="plus" className="h-4 w-4" />
            新建 Provider
          </button>
        </div>
      </section>

      {/* 模型配置 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white/90 mb-2">模型配置</h2>
        <p className="text-white/50 text-xs mb-4">为每个功能选择要使用的模型。Provider 不限于预置的几个，任意填 id 即可。</p>
        <div className={cuCard({ tight: true })}>
          <div className="space-y-5">
            {/* Global datalist for provider suggestions */}
            <datalist id="cu-providers">
              {config.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label || p.id}</option>
              ))}
            </datalist>
            {(['default', ...FEATURE_KEYS] as const).map((feature) => {
              const choice = resolveChoice(feature)
              const testKey = `test_${feature}`
              const test = testResults[testKey]
              const isTesting = testingKey === testKey
              const isUnknownProvider = !config.providers.find(p => p.id === choice.provider)
              const provider = config.providers.find(p => p.id === choice.provider)

              return (
                <div key={feature}>
                  {/* Controls row */}
                  <div className="flex items-center gap-3">
                    <label className="w-36 text-white/70 text-sm shrink-0">
                      {FEATURE_LABELS[feature]}
                    </label>
                    <div className="w-44 shrink-0">
                      <input
                        type="text"
                        value={choice.provider}
                        onChange={(e) => {
                          const newChoice: ModelChoice = { ...choice, provider: e.target.value }
                          window.api.configSetChoice(feature, newChoice)
                          if (config) {
                            setConfig({
                              ...config,
                              ...(feature === 'default'
                                ? { default: newChoice }
                                : { features: { ...config.features, [feature]: newChoice } }),
                            })
                          }
                        }}
                        list="cu-providers"
                        className="cu-input text-sm px-3 py-1.5 w-full"
                        placeholder="Provider ID"
                      />
                    </div>
                    <div className="w-48 shrink-0 relative">
                      <input
                        type="text"
                        value={choice.model}
                        onChange={(e) => {
                          const newChoice: ModelChoice = { ...choice, model: e.target.value }
                          window.api.configSetChoice(feature, newChoice)
                          if (config) {
                            setConfig({
                              ...config,
                              ...(feature === 'default'
                                ? { default: newChoice }
                                : { features: { ...config.features, [feature]: newChoice } }),
                            })
                          }
                        }}
                        list={`models-${choice.provider}`}
                        className="cu-input text-sm px-3 py-1.5 w-full"
                        placeholder="模型名称"
                      />
                      {modelLists[choice.provider] && modelLists[choice.provider]!.length > 0 && (
                        <datalist id={`models-${choice.provider}`}>
                          {modelLists[choice.provider]!.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label || m.id}
                            </option>
                          ))}
                        </datalist>
                      )}
                    </div>
                    <button
                      onClick={() => handleFetchModels(choice.provider)}
                      disabled={fetchingModels[choice.provider]}
                      className={`${cuCtaGhost} px-3 py-1.5 text-xs shrink-0`}
                      aria-label={`拉取 ${choice.provider} 的模型列表`}
                    >
                      {fetchingModels[choice.provider] ? (
                        <Spinner label="" />
                      ) : (
                        <>
                          <Icon name="refresh" className="h-4 w-4" />
                          拉取模型
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleTest(testKey, choice)}
                      disabled={isTesting}
                      className={`${cuCtaGhost} px-3 py-1.5 text-xs shrink-0`}
                    >
                      {isTesting ? <Spinner label="" /> : '测试'}
                    </button>
                  </div>

                  {/* Status line below */}
                  <div className="mt-2 ml-36 text-xs space-y-1">
                    {/* Provider resolution summary */}
                    {provider ? (
                      <div className="text-white/60 flex items-center gap-2">
                        <span className="text-mint">⟶</span>
                        <span className="font-mono">{provider.baseUrl || '未配置URL'}</span>
                        <span>·</span>
                        <span>{provider.format === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
                        <span>·</span>
                        <span className={config.keysSet[provider.id] ? 'text-mint' : 'text-coral'}>
                          {config.keysSet[provider.id] ? '密钥已配置' : '未配置密钥'}
                        </span>
                      </div>
                    ) : isUnknownProvider && (
                      <div className={cuNotice('warn') + ' text-xs flex items-center gap-2'}>
                        <span>
                          还没有这个 provider：<code className="font-mono">{choice.provider}</code>。
                          可以先到上方「Provider 管理」把它建出来，或者直接保存——调用时会报错提示。
                        </span>
                        <button
                          onClick={() => {
                            setEditingProvider({
                              id: choice.provider,
                              label: '',
                              baseUrl: '',
                              format: 'openai',
                              headers: {},
                            })
                            setExpandedProviderId(choice.provider)
                          }}
                          className={`${cuCtaGhost} px-2 py-1 text-xs whitespace-nowrap`}
                        >
                          补建这个 Provider
                        </button>
                      </div>
                    )}

                    {/* Test results */}
                    {test && (
                      <div className={test.latency !== undefined ? 'text-mint' : 'text-coral'}>
                        {test.latency !== undefined ? `${test.latency}ms` : test.error}
                      </div>
                    )}

                    {/* Model list status */}
                    {modelListStatus[choice.provider] === 'ok' && modelLists[choice.provider] && (
                      <div className="text-mint">
                        已获取 {modelLists[choice.provider]!.length} 个模型
                      </div>
                    )}
                    {modelListStatus[choice.provider] === 'empty' && (
                      <div className="text-white/50">
                        该提供商未提供模型列表，请手动输入模型名称
                      </div>
                    )}
                    {modelListStatus[choice.provider] === 'error' && (
                      <div className="text-coral">
                        {testResults[`models_${choice.provider}`]?.error || '拉取失败'}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white/90 mb-4">学习计划</h2>
        <div className={cuCard({ tight: true })}>
          <div className="text-white/70 text-sm">考试日期</div>
          <p className="text-white/50 text-xs mt-1 mb-3">
            复习排程是「带 deadline 的调度」——间隔有上限，且不会把你推到考试之后。
            不填就退化成普通的间隔重复。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              aria-label="考试日期"
              className="cu-input w-[200px]"
            />
            <span className="text-white/40 text-xs">留空表示不设考试日期</span>
          </div>

          <div className="cu-divider my-4" />

          <div className="text-white/70 text-sm">全局热键</div>
          <p className="text-white/50 text-xs mt-1 mb-3">
            在任意界面按下即可框选截图。格式如 <code className="font-mono">Alt+Shift+A</code>。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={hotkey}
              onChange={(e) => setHotkey(e.target.value)}
              aria-label="全局热键"
              placeholder="Alt+Shift+A"
              className="cu-input w-[200px] font-mono"
            />
          </div>

          <div className="cu-divider my-4" />

          <div className="text-white/70 text-sm">识别后自动保存（秒）</div>
          <p className="text-white/50 text-xs mt-1 mb-3">
            0 表示不自动保存，等你手动确认
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="number"
              min={0}
              max={120}
              value={autoSaveSeconds}
              onChange={(e) => setAutoSaveSeconds(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
              aria-label="识别后自动保存秒数"
              className="cu-input w-[200px]"
            />
            <span className="text-white/40 text-xs">范围 0–120 秒</span>
          </div>

          <div className="cu-divider my-4" />

          <div className="text-white/70 text-sm">统计窗口</div>
          <p className="text-white/50 text-xs mt-1 mb-3">
            统计页的趋势曲线和「本周期 vs 上一周期」按这个天数计算。
            备考前期可以看长一点，冲刺阶段看短一点更能反映最近的状态。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="number"
              min={1}
              max={365}
              value={statsWindowDays}
              onChange={(e) =>
                setStatsWindowDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))
              }
              aria-label="统计窗口天数"
              className="cu-input w-[200px]"
            />
            <span className="text-white/40 text-xs">天 · 范围 1–365</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setStatsWindowDays(d)}
                className={`${cuCtaGhost} px-3 py-1.5 text-xs ${
                  statsWindowDays === d ? 'ring-1 ring-white/40' : ''
                }`}
              >
                近 {d} 天
              </button>
            ))}
          </div>

          <div className="mt-4">
            <button
              onClick={() => void handleSavePlan()}
              disabled={savingPlan}
              className={`${cuCtaPrimary} px-4 py-2 text-sm`}
            >
              {savingPlan ? (
                <Spinner label="保存中..." />
              ) : (
                <>
                  <Icon name="check" className="h-4 w-4" />
                  保存
                </>
              )}
            </button>
          </div>

          {planMsg && (
            <div className={`mt-4 ${cuNotice(planMsg.kind === 'ok' ? 'info' : 'error')}`}>
              {planMsg.text}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white/90 mb-4">仓库</h2>
        <div className={cuCard({ tight: true })}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-white/70 text-sm">错题库路径</div>
              <div className="text-white/90 text-sm font-mono mt-1">{vaultPath}</div>
            </div>
            <button
              onClick={handleChooseVault}
              className={`${cuCtaGhost} px-4 py-2 text-sm`}
            >
              <Icon name="folder" className="h-4 w-4" />
              更改目录
            </button>
          </div>
          <div className="cu-divider my-4" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-white/70 text-sm">重建索引</div>
              {vaultCount !== null && (
                <div className="text-white/50 text-xs mt-1">
                  已重建 {vaultCount} 条记录
                </div>
              )}
            </div>
            <button
              onClick={handleRebuildIndex}
              disabled={indexRebuilding}
              className={`${cuCtaPrimary} px-4 py-2 text-sm`}
            >
              {indexRebuilding ? (
                <Spinner label="重建中..." />
              ) : (
                <>
                  <Icon name="refresh" className="h-4 w-4" />
                  重建索引
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
