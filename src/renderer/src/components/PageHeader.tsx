/**
 * 页面标题 — 统一的标题/副标题/操作栏布局
 */
import { cuH1 } from '../design/tokens'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps): React.JSX.Element {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className={cuH1}>{title}</h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-white/60">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}
