/**
 * 设计系统 token —— 供各页面复用，避免风格漂移。
 * 规则来源：Fullscreen Hero 风格包。改这里就等于改全站观感。
 */
import type { JSX } from 'react'

/** 风格包指定的强调色（与 styles.css 的 @theme 保持一致） */
export const ACCENT = {
  coral: '#ff6b6b',
  mint: '#4ecdc4',
  sun: '#ffe66d',
  iris: '#6c5ce7'
} as const

export type AccentKey = keyof typeof ACCENT

/** 图标容器色调：按科目/错因稳定取色，避免每次渲染跳色 */
export function accentFor(seed: string): AccentKey {
  const keys = Object.keys(ACCENT) as AccentKey[]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return keys[h % keys.length]
}

/**
 * 「浮空玻璃」卡片 —— 风格包要求卡片必须带 group 类，
 * 以便内部图标用 group-hover:scale-110 做微交互。
 */
export function cuCard(opts: { interactive?: boolean; tight?: boolean } = {}): string {
  const { interactive = false, tight = false } = opts
  return [
    'group',
    'bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20',
    tight ? 'p-5' : 'p-8 md:p-10',
    interactive
      ? 'transition-all duration-200 ease-out hover:-translate-y-2 hover:shadow-[0_16px_40px_rgba(0,0,0,0.5)] hover:bg-white/[0.14]'
      : '',
    'focus-within:ring-2 focus-within:ring-white/50'
  ]
    .filter(Boolean)
    .join(' ')
}

/** 图标容器：hover 时放大（依赖父级 group） */
export const cuIconBox =
  'flex items-center justify-center rounded-2xl bg-white/10 border border-white/15 transition-transform duration-300 ease-out group-hover:scale-110'

/** 主 CTA：重力浮起（风格包指定） */
export const cuCtaPrimary =
  'cu-btn-primary shadow-[0_4px_14px_rgba(0,0,0,0.3)] hover:-translate-y-1 hover:shadow-[0_8px_28px_rgba(0,0,0,0.5)] active:translate-y-0 active:shadow-[0_2px_8px_rgba(0,0,0,0.3)]'

export const cuCtaGhost =
  'cu-btn-ghost shadow-[0_4px_14px_rgba(0,0,0,0.3)] hover:-translate-y-1 hover:shadow-[0_8px_28px_rgba(0,0,0,0.5)] active:translate-y-0 active:shadow-[0_2px_8px_rgba(0,0,0,0.3)]'

/** 章节标题（字号刻度见风格包） */
export const cuH1 = 'font-display font-bold leading-tight text-3xl md:text-4xl'
export const cuH2 = 'font-display font-bold leading-tight text-2xl md:text-3xl'
export const cuH3 = 'font-display font-bold leading-tight text-xl md:text-2xl'

/** 页面容器 */
export const cuContainer = 'mx-auto w-full max-w-6xl px-6 lg:px-8'

/** 空状态 / 错误提示的统一样式 */
export function cuNotice(kind: 'info' | 'warn' | 'error'): string {
  const tone =
    kind === 'error'
      ? 'border-coral/50 bg-coral/10'
      : kind === 'warn'
        ? 'border-sun/50 bg-sun/10'
        : 'border-white/20 bg-white/5'
  return `rounded-2xl border ${tone} px-5 py-4 text-sm`
}

/** 简易图标（内联 SVG，避免引入图标库依赖） */
export function Icon({
  name,
  className = 'h-5 w-5'
}: {
  name: IconName
  className?: string
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

export type IconName =
  | 'library'
  | 'review'
  | 'stats'
  | 'spark'
  | 'settings'
  | 'camera'
  | 'check'
  | 'close'
  | 'refresh'
  | 'trash'
  | 'edit'
  | 'plus'
  | 'trophy'
  | 'brain'
  | 'clock'
  | 'folder'
  | 'export'

const PATHS: Record<IconName, JSX.Element> = {
  library: (
    <>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v14.5" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19" />
    </>
  ),
  review: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
    </>
  ),
  stats: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15v3M12 9v9M17 5v13" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8.5 13.6 12 12 15.5 10.4 12z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 2.6h.1A1.7 1.7 0 0 0 8.3 1V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 2.6" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h1.5l1.2-2h6.6l1.2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  check: <path d="m5 13 4 4L19 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L20 8l-4-4L4 16z" />
      <path d="m14 6 4 4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3" />
      <path d="M12 13v4M9 20h6" />
    </>
  ),
  brain: (
    <>
      <path d="M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.6A3 3 0 0 0 7 18a3 3 0 0 0 5 2.2V4.5A2.5 2.5 0 0 0 9.5 4z" />
      <path d="M14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.6A3 3 0 0 1 17 18a3 3 0 0 1-5 2.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  export: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  )
}
