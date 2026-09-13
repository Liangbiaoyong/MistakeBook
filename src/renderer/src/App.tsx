import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, cuContainer, type IconName } from './design/tokens'
import Composer from './pages/Composer'
import CaptureWidget, { type CaptureTask } from './components/CaptureWidget'
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

let taskCounter = 0

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<PageKey>('library')
  const [tasks, setTasks] = useState<CaptureTask[]>([])
  const [editingTask, setEditingTask] = useState<CaptureTask | null>(null)
  const hotkeyHint = 'Alt+Shift+A'
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  /* ── 清理单个任务的定时器 ──────────────────────────────────── */
  const clearTimer = useCallback((taskId: string) => {
    const t = timersRef.current.get(taskId)
    if (t) {
      clearInterval(t)
      timersRef.current.delete(taskId)
    }
  }, [])

  /* ── 组件卸载时清理所有定时器 ──────────────────────────────────── */
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearInterval(t))
      timersRef.current.clear()
    }
  }, [])

  /* ── 启动自动保存倒计时 ──────────────────────────────────── */
  const startCountdown = useCallback(
    (taskId: string, delaySeconds: number) => {
      if (delaySeconds <= 0) return

      clearTimer(taskId)
      let remaining = delaySeconds

      const tick = () => {
        remaining -= 1
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, remaining } : t
          )
        )

        if (remaining <= 0) {
          clearTimer(taskId)
          // 触发自动保存
          setTasks((prev) => {
            const task = prev.find((t) => t.id === taskId)
            if (task && task.status === 'ready' && task.extraction) {
              // 异步保存
              void saveTask(taskId, task)
              return prev.map((t) =>
                t.id === taskId ? { ...t, status: 'saving' as const } : t
              )
            }
            return prev
          })
        }
      }

      const timer = setInterval(tick, 1000)
      timersRef.current.set(taskId, timer)
    },
    [clearTimer]
  )

  /* ── 保存任务 ──────────────────────────────────── */
  const saveTask = useCallback(async (taskId: string, task: CaptureTask) => {
    if (!task.extraction) return

    clearTimer(taskId)
    const r = await window.api.save({
      extraction: task.extraction,
      imageAbsPath: task.payload.imageAbsPath
    })

    if (r.ok) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'saved' as const } : t
        )
      )
      // 2.5s 后自动移除
      setTimeout(() => {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      }, 2500)
    } else {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'error' as const, error: r.error ?? '保存失败' } : t
        )
      )
    }
  }, [clearTimer])

  /* ── 处理截图完成回调 ──────────────────────────────────── */
  const handleCaptured = useCallback(
    (payload: CapturePayload) => {
      const id = `task-${++taskCounter}`
      const newTask: CaptureTask = {
        id,
        payload,
        status: 'recognizing'
      }

      setTasks((prev) => [...prev, newTask])

      // 读取自动保存延迟设置后开始识别
      void (async () => {
        const settings = await window.api.settingsGet()
        const autoSaveDelay = (settings.ok && settings.data?.autoSaveSeconds) || 30

        const r = await window.api.extract(payload.imageAbsPath)
        if (r.ok && r.data) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id ? { ...t, status: 'ready' as const, extraction: r.data!, remaining: autoSaveDelay } : t
            )
          )
          // 启动倒计时
          startCountdown(id, autoSaveDelay)
        } else {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id ? { ...t, status: 'error' as const, error: r.error ?? '识别失败' } : t
            )
          )
        }
      })()
    },
    [startCountdown]
  )

  /* ── 挂载热键与菜单回调 ──────────────────────────────────── */
  useEffect(() => {
    const offCaptured = window.api.onCaptured(handleCaptured)
    const offOpen = window.api.onOpenComposer(() => {
      void window.api.captureStart()
    })
    return () => {
      offCaptured()
      offOpen()
    }
  }, [handleCaptured])

  /* ── 截图录入按钮（与热键行为一致） ──────────────────────────────────── */
  const startCapture = useCallback(async () => {
    const r = await window.api.captureStart()
    if (!r.ok && r.error) window.alert(r.error)
  }, [])

  /* ── 任务操作：保存、编辑、丢弃、重试 ──────────────────────────────────── */
  const handleSave = useCallback(
    (taskId: string) => {
      setTasks((prev) => {
        const task = prev.find((t) => t.id === taskId)
        if (task && task.status === 'ready' && task.extraction) {
          void saveTask(taskId, task)
          return prev.map((t) =>
            t.id === taskId ? { ...t, status: 'saving' as const } : t
          )
        }
        return prev
      })
    },
    [saveTask]
  )

  const handleEdit = useCallback((taskId: string) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId)
      if (task) {
        setEditingTask(task)
      }
      return prev
    })
  }, [])

  const handleDiscard = useCallback(
    (taskId: string) => {
      clearTimer(taskId)
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
    },
    [clearTimer]
  )

  const handleRetry = useCallback(
    (taskId: string) => {
      clearTimer(taskId)
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'recognizing' as const, error: undefined } : t
        )
      )

      // 重新开始识别
      const task = tasks.find((t) => t.id === taskId)
      if (task) {
        void (async () => {
          const r = await window.api.extract(task.payload.imageAbsPath)
          if (r.ok && r.data) {
            const settings = await window.api.settingsGet()
            const autoSaveDelay = (settings.ok && settings.data?.autoSaveSeconds) || 30

            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: 'ready' as const, extraction: r.data!, remaining: autoSaveDelay } : t
              )
            )
            startCountdown(taskId, autoSaveDelay)
          } else {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: 'error' as const, error: r.error ?? '识别失败' } : t
              )
            )
          }
        })()
      }
    },
    [clearTimer, startCountdown, tasks]
  )

  /* ── 编辑完成回调 ──────────────────────────────────── */
  const handleComposerClose = useCallback(() => {
    if (editingTask) {
      // 编辑完成，移除该任务
      setTasks((prev) => prev.filter((t) => t.id !== editingTask.id))
      setEditingTask(null)
    }
  }, [editingTask])

  /* ── 同步任务状态到通知窗口 ──────────────────────────────────── */
  useEffect(() => {
    void window.api.notifySync(tasks)
  }, [tasks])

  /* ── 监听通知窗口的按钮操作 ──────────────────────────────────── */
  useEffect(() => {
    const offCommand = window.api.onNotifyCommand(({ taskId, action }) => {
      switch (action) {
        case 'save':
          handleSave(taskId)
          break
        case 'edit':
          handleEdit(taskId)
          break
        case 'discard':
          handleDiscard(taskId)
          break
        case 'retry':
          handleRetry(taskId)
          break
      }
    })
    return () => {
      offCommand()
    }
  }, [handleSave, handleEdit, handleDiscard, handleRetry])

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

      {/* ── 编辑确认窗（从 CaptureWidget 打开） ── */}
      {editingTask && editingTask.extraction && (
        <Composer
          payload={editingTask.payload}
          initial={editingTask.extraction}
          onClose={handleComposerClose}
        />
      )}

      {/* ── 后台识别浮动组件 ── */}
      <CaptureWidget
        tasks={tasks}
        onSave={handleSave}
        onEdit={handleEdit}
        onDiscard={handleDiscard}
        onRetry={handleRetry}
      />

      {/* ── 通知提示 ── */}
      <Toast />
    </div>
  )
}
