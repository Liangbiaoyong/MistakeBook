import { useState, useEffect, useCallback } from 'react'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import { Icon, cuCard, cuIconBox, cuCtaPrimary, cuCtaGhost, cuNotice } from '../design/tokens'
import type { PublicModelConfig, FeatureKey, ModelChoice, ProviderConfig } from '@shared/types'
import { FEATURE_KEYS } from '@shared/types'

const FEATURE_LABELS: Record<FeatureKey | 'default', string> = {
  capture: '采集识别（必须支持读图）',
  analyze: '错因分析',
  generate: '变式出题',
  forecast: '考点排行',
  default: '全局默认',
}

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
  const [planMsg, setPlanMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [savingPlan, setSavingPlan] = useState(false)

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
    }
    setLoading(false)
  }, [])

  const handleSavePlan = async () => {
    setSavingPlan(true)
    setPlanMsg(null)
    const result = await window.api.settingsSet({
      examDate: examDate || undefined,
      hotkey: hotkey.trim() || undefined
    })
    if (result.ok && result.data) {
      setHotkey(result.data.hotkey)
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

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white/90 mb-4">模型配置</h2>
        <div className={cuCard({ tight: true })}>
          <div className="space-y-4">
            {(['default', ...FEATURE_KEYS] as const).map((feature) => {
              const choice = resolveChoice(feature)
              const testKey = `test_${feature}`
              const test = testResults[testKey]
              const isTesting = testingKey === testKey
              return (
                <div key={feature} className="flex items-center gap-4">
                  <label className="w-36 text-white/70 text-sm shrink-0">
                    {FEATURE_LABELS[feature]}
                  </label>
                  <select
                    value={choice.provider}
                    onChange={(e) => {
                      const newChoice: ModelChoice = {
                        ...choice,
                        provider: e.target.value,
                      }
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
                    className="cu-input text-sm px-3 py-1.5 w-40"
                  >
                    {config.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={choice.model}
                    onChange={(e) => {
                      const newChoice: ModelChoice = {
                        ...choice,
                        model: e.target.value,
                      }
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
                    className="cu-input text-sm px-3 py-1.5 flex-1"
                    placeholder="模型名称"
                  />
                  <button
                    onClick={() => handleTest(testKey, choice)}
                    disabled={isTesting}
                    className={`${cuCtaGhost} px-3 py-1.5 text-xs`}
                  >
                    {isTesting ? <Spinner label="" /> : '测试'}
                  </button>
                  {test && (
                    <span className="text-xs text-white/60">
                      {test.latency !== undefined
                        ? `${test.latency}ms`
                        : test.error}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white/90 mb-4">Provider 与密钥</h2>
        <div className="space-y-4">
          {config.providers.map((p) => {
            const keyResult = testResults[`key_${p.id}`]
            const hasKey = config.keysSet[p.id] ?? false
            return (
              <div key={p.id} className={cuCard({ tight: true })}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`${cuIconBox} h-8 w-8`}>
                      <Icon name="settings" className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-white/90 text-sm">{p.label}</div>
                      <div className="text-white/50 text-xs">{p.baseUrl}</div>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      hasKey ? 'bg-mint/20 text-mint' : 'bg-white/10 text-white/50'
                    }`}
                  >
                    {hasKey ? '已配置' : '未配置'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="password"
                    value={providerKeys[p.id] ?? ''}
                    onChange={(e) =>
                      setProviderKeys((prev) => ({
                        ...prev,
                        [p.id]: e.target.value,
                      }))
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
                </div>
                {keyResult?.error && (
                  <div className={cuNotice('error') + ' mt-2 text-xs'}>
                    {keyResult.error}
                  </div>
                )}
                <p className="text-white/40 text-xs mt-2">
                  密钥通过操作系统凭证库加密存储，不会在界面上回显
                </p>
              </div>
            )
          })}

          <button
            onClick={() =>
              setEditingProvider({
                id: '',
                label: '',
                baseUrl: '',
              })
            }
            className={`${cuCtaGhost} px-4 py-2 text-sm`}
          >
            <Icon name="plus" className="h-4 w-4" />
            添加 Provider
          </button>

          {editingProvider && (
            <div className={cuCard({ tight: true }) + ' border-l-4 border-l-iris'}>
              <h4 className="font-semibold text-white/90 text-sm mb-3">添加/编辑 Provider</h4>
              <div className="space-y-3">
                <input
                  type="text"
                  value={editingProvider.id}
                  onChange={(e) =>
                    setEditingProvider({ ...editingProvider, id: e.target.value })
                  }
                  placeholder="ID（如 my-provider）"
                  className="cu-input text-sm px-3 py-1.5 w-full"
                />
                <input
                  type="text"
                  value={editingProvider.label}
                  onChange={(e) =>
                    setEditingProvider({ ...editingProvider, label: e.target.value })
                  }
                  placeholder="显示名称"
                  className="cu-input text-sm px-3 py-1.5 w-full"
                />
                <input
                  type="text"
                  value={editingProvider.baseUrl}
                  onChange={(e) =>
                    setEditingProvider({ ...editingProvider, baseUrl: e.target.value })
                  }
                  placeholder="Base URL（如 https://api.example.com）"
                  className="cu-input text-sm px-3 py-1.5 w-full"
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveProvider}
                    disabled={!editingProvider.id || !editingProvider.baseUrl}
                    className={`${cuCtaPrimary} px-4 py-1.5 text-xs`}
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingProvider(null)}
                    className={`${cuCtaGhost} px-4 py-1.5 text-xs`}
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}
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
