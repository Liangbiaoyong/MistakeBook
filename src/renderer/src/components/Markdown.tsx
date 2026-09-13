/**
 * Markdown 渲染组件 — 支持 KaTeX 公式与暗底高对比排版
 */
import { useMemo } from 'react'
import { renderMarkdown } from '../lib/md'

interface MarkdownProps {
  source: string
  className?: string
}

export default function Markdown({ source, className = '' }: MarkdownProps): React.JSX.Element {
  const html = useMemo(() => renderMarkdown(source), [source])

  return (
    <div
      className={`cu-prose ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
