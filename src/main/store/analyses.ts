/**
 * 分析记录 —— 把「考点排行 / 错因归纳」这类大模型分析的产物落盘留档。
 *
 * 与错题一样遵守同一条纪律：**文件是真相源**。
 * 存在 `<vault>/analyses/<id>.md`，frontmatter 记元信息，正文就是分析结果本身。
 *
 * 为什么要留档：这类分析一次要跑十几秒、还消耗 token，
 * 而且「上次分析说了什么」本身就是复习时要对着看的东西 ——
 * 只放在组件 state 里，切走页面就没了。
 */
import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import matter from 'gray-matter'
import type { AnalysisKind, AnalysisRecord, AnalysisSummary } from '@shared/types'
import { getVaultDir } from './paths'

const KINDS: readonly AnalysisKind[] = ['forecast', 'patterns']

function analysesDir(): string {
  return join(getVaultDir(), 'analyses')
}

function newAnalysisId(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0')
  return `${y}-${m}-${d}-${hh}${mm}-${rand}`
}

/** 原子写入：先写 .tmp 再 rename，绝不留半截文件 */
async function atomicWrite(absPath: string, content: string): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true })
  const tmp = `${absPath}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, absPath)
}

/** 存一份分析结果，返回落盘后的记录 */
export async function saveAnalysis(input: {
  kind: AnalysisKind
  title: string
  markdown: string
  mistakeCount?: number
}): Promise<AnalysisRecord> {
  const now = new Date()
  const record: AnalysisRecord = {
    id: newAnalysisId(now),
    kind: input.kind,
    createdAt: now.toISOString(),
    title: input.title,
    markdown: input.markdown
  }

  const data: Record<string, unknown> = {
    id: record.id,
    kind: record.kind,
    created: record.createdAt,
    title: record.title
  }
  if (input.mistakeCount != null) data.mistakes = input.mistakeCount

  await atomicWrite(join(analysesDir(), `${record.id}.md`), matter.stringify(`${input.markdown}\n`, data))
  return record
}

/** 列出历史分析，最新的在前（不含正文，只给摘要） */
export async function listAnalyses(): Promise<AnalysisSummary[]> {
  let files: string[]
  try {
    files = (await readdir(analysesDir())).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }

  const out: AnalysisSummary[] = []
  for (const file of files) {
    try {
      const parsed = matter(await readFile(join(analysesDir(), file), 'utf8'))
      const d = parsed.data as Record<string, unknown>
      const kind = String(d.kind ?? 'forecast')
      out.push({
        id: String(d.id ?? file.replace(/\.md$/, '')),
        kind: (KINDS as readonly string[]).includes(kind) ? (kind as AnalysisKind) : 'forecast',
        createdAt: String(d.created ?? ''),
        title: String(d.title ?? '分析'),
        mistakeCount: typeof d.mistakes === 'number' ? d.mistakes : undefined,
        head: firstLine(parsed.content)
      })
    } catch {
      // 单个文件坏了不该让整张列表挂掉
    }
  }

  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function readAnalysis(id: string): Promise<AnalysisRecord | null> {
  try {
    const parsed = matter(await readFile(join(analysesDir(), `${id}.md`), 'utf8'))
    const d = parsed.data as Record<string, unknown>
    return {
      id: String(d.id ?? id),
      kind: (String(d.kind ?? 'forecast') as AnalysisKind),
      createdAt: String(d.created ?? ''),
      title: String(d.title ?? '分析'),
      markdown: parsed.content.trim()
    }
  } catch {
    return null
  }
}

export async function deleteAnalysis(id: string): Promise<void> {
  await unlink(join(analysesDir(), `${id}.md`)).catch(() => {})
}

function firstLine(md: string): string {
  const line = md
    .split('\n')
    .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
    .find((l) => l.length > 0)
  return (line ?? '').slice(0, 80)
}
