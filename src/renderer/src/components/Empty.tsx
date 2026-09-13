/**
 * 空状态 — 用于无数据时的友好提示
 */
import { Icon, type IconName } from '../design/tokens'

interface EmptyProps {
  icon?: IconName
  title: string
  hint?: string
  action?: React.ReactNode
}

export default function Empty({ icon = 'library', title, hint, action }: EmptyProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/10 backdrop-blur-sm border border-white/20">
        <Icon name={icon} className="h-10 w-10 text-white/60" />
      </div>
      <h2 className="text-xl font-display font-bold text-white mb-2">{title}</h2>
      {hint && <p className="max-w-xs text-sm text-white/60 leading-relaxed mb-6">{hint}</p>}
      {action && <div>{action}</div>}
    </div>
  )
}
