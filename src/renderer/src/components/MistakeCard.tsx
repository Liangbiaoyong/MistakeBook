/**
 * 错题卡片 — 用于书库网格展示
 */
import type { MistakeSummary } from '@shared/types'
import { statusLabel, statusTone, formatDate } from '../lib/format'
import { accentFor, cuCard, ACCENT } from '../design/tokens'
import Markdown from './Markdown'

interface MistakeCardProps {
  item: MistakeSummary
  onClick?: () => void
}

export default function MistakeCard({ item, onClick }: MistakeCardProps): React.JSX.Element {
  const accent = accentFor(item.subject)
  const color = ACCENT[accent]
  const tone = statusTone(item.status)

  return (
    // 用 div 而不是 button：题目预览必须走 Markdown（里面是 <div>/<p>），
    // 而 <button> 的内容模型只允许行内内容。键盘可达性用 role + onKeyDown 补回来。
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={`${cuCard({ interactive: true })} flex cursor-pointer flex-col gap-3 text-left`}
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

      {/* 题目预览 —— 必须走 Markdown。直接当纯文本渲染的话，$...$ 会原样显示出美元符号 */}
      <div className="min-h-[3.5rem]">
        <Markdown source={item.questionHead} />
      </div>

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
    </div>
  )
}
