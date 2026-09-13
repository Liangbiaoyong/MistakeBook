import { useCallback, useEffect, useState } from 'react'
import { Icon, cuContainer, type IconName } from './design/tokens'
import Composer from './pages/Composer'
import Library from './pages/Library'
import Review from './pages/Review'
import Stats from './pages/Stats'
import Forecast from './pages/Forecast'
import Settings from './pages/Settings'
import Toast from './components/Toast'
import type { CapturePayload } from '@shared/ipc'

export type PageKey = 'library' | 'review' | 'stats' | 'forecast' | 'settings'

const NAV: { key: PageKey; label: string; icon: IconName; hint: string }[] = [
  { key: 'library', label: '书库', icon: 'library', hint: '全部错题' },
  { key: 'review', label: '复习', icon: 'review', hint: '今日到期' },
  { key: 'stats', label: '统计', icon: 'stats', hint: '分布与趋势' },
  { key: 'forecast', label: '考点', icon: 'trophy', hint: '高频考点排行' },
  { key: 'settings', label: '设置', icon: 'settings', hint: '模型与仓库' }
]

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<PageKey>('library')
  const [composer, setComposer] = useState<CapturePayload | null>(null)
  const hotkeyHint = 'Alt+Shift+A'

  // 主进程截完图就把 payload 推来，直接打开录入窗
  useEffect(() => {
    const offCaptured = window.api.onCaptured((p) => {
      setComposer(p)
    })
    const offOpen = window.api.onOpenComposer(() => {
      void window.api.captureStart()
    })
    return () => {
      offCaptured()
      offOpen()
    }
  }, [])

  const startCapture = useCallback(async () => {
    const r = await window.api.captureStart()
    if (!r.ok && r.error) window.alert(r.error)
  }, [])

  const closeComposer = useCallback(() => setComposer(null), [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* ── 侧边导航 ── */}
      <nav className="flex w-[212px] shrink-0 flex-col gap-1 border-r border-white/10 bg-black/60 px-3 pt-5 pb-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: 'linear-gradient(140deg, #ff6b6b 0%, #6c5ce7 100%)' }}
            aria-hidden="true"
          >
            <Icon name="brain" className="h-5 w-5 text-white" />
          </span>
          <span className="font-display text-lg font-bold leading-none tracking-tight">
            错题本
          </span>
        </div>

        {NAV.map((n) => {
          const active = page === n.key
          return (
            <button
              key={n.key}
              type="button"
              onClick={() => setPage(n.key)}
              aria-current={active ? 'page' : undefined}
              className={`cu-btn w-full justify-start gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-colors duration-200 ${
                active ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/90'
              }`}
            >
              <Icon name={n.icon} className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1 text-left">{n.label}</span>
              {active && <span className="h-1.5 w-1.5 rounded-full bg-coral" />}
            </button>
          )
        })}

        <div className="mt-auto flex flex-col gap-3 px-1.5">
          <button type="button" onClick={startCapture} className="cu-btn-primary w-full !px-4 !py-2.5 text-sm">
            <Icon name="camera" className="h-4 w-4" />
            截图录入
          </button>
          {/* 热键单独占一行：跟句子挤在一行会换行换得很难看，还会被窗口底边裁掉 */}
          <div className="text-center text-[11px] leading-relaxed text-white/40">
            <p>任意界面按此键框选</p>
            <kbd className="mt-1.5 inline-block rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[10px] text-white/70">
              {hotkeyHint}
            </kbd>
          </div>
        </div>
      </nav>

      {/* ── 主内容区 ── */}
      <main className="relative flex-1 overflow-y-auto">
        <div className={`${cuContainer} py-8`}>
          {page === 'library' && <Library onCapture={startCapture} />}
          {page === 'review' && <Review />}
          {page === 'stats' && <Stats />}
          {page === 'forecast' && <Forecast />}
          {page === 'settings' && <Settings />}
        </div>
      </main>

      {/* ── 录入确认窗（截图后弹出） ── */}
      {composer && <Composer payload={composer} onClose={closeComposer} />}

      {/* ── 通知提示 ── */}
      <Toast />
    </div>
  )
}
