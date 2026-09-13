/**
 * 错题卡片 — 用于书库网格展示
 */
import type { MistakeSummary } from '@shared/types'
import { statusLabel, statusTone, formatDate } from '../lib/format'
import { accentFor, cuCard, ACCENT } from '../design/tokens'

interface MistakeCardProps {
  item: MistakeSummary
  onClick?: () => void
}

export default function MistakeCard({ item, onClick }: MistakeCardProps): React.JSX.Element {
  const accent = accentFor(item.subject)
  const color = ACCENT[accent]
  const tone = statusTone(item.status)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cuCard({ interactive: true })} flex flex-col gap-3 text-left cursor-pointer`}
    >
      {/* 顶部：科目 + 状态 */}
      <div className="flex items-center justify-between">
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{
            background: `color-mix(in srgb, ${color} 20%, transparent)`,
            color: color
          }}
        >
          {item.subject}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium border-${tone}/40 text-${tone}`}
          style={{
            borderColor: `color-mix(in srgb, ${ACCENT[tone]} 40%, transparent)`,
            color: ACCENT[tone]
          }}
        >
          {statusLabel(item.status)}
        </span>
      </div>

      {/* 题目预览 */}
      <p className="line-clamp-3 text-sm leading-relaxed text-white/90">
        {item.questionHead}
      </p>

      {/* 底部：元数据 */}
      <div className="mt-auto flex flex-wrap gap-2 text-xs text-white/60">
        {item.chapter?.[0] && (
          <span className="cu-chip">{item.chapter[0]}</span>
        )}
        {item.type && (
          <span className="cu-chip">{item.type}</span>
        )}
        {item.errorType && (
          <span className="cu-chip">{item.errorType}</span>
        )}
        {item.level && (
          <span className="cu-chip">{'★'.repeat(item.level)}{'☆'.repeat(5 - item.level)}</span>
        )}
      </div>

      {/* 日期 */}
      <p className="text-xs text-white/40">{formatDate(item.created)}</p>
    </button>
  )
}
