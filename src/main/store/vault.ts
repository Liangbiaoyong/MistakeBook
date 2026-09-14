/**
 * vault 操作 —— Markdown 文件的 CRUD 与索引同步。
 *
 * 两条纪律：
 * 1. 文件是唯一真相源，索引只是派生物 —— 所以任何写入都必须先落盘。
 * 2. 写入必须原子：先写 .tmp 再 rename，绝不允许出现半截文件。
 */
import { readFile, writeFile, rename, copyFile, unlink, mkdir, readdir } from 'node:fs/promises'
import { join, dirname, relative, sep, extname } from 'node:path'
import type {
  Mistake,
  MistakeBody,
  MistakeInput,
  MistakeSummary,
  ListFilter,
  ErrorType
} from '@shared/types'
import { mistakesDir, assetsDir, getVaultDir, getVaultStatus } from './paths'
import { mistakeToMarkdown, markdownToMistake, pickUniqueId, mistakeRelPath } from './frontmatter'
import {
  openIndex,
  initSchema,
  upsertRow,
  deleteRow,
  querySummaries,
  replaceReviews,
  duplicateCandidates
} from './index-db'
import { readReviewEvents } from './reviews-log'
import type { DedupCandidate } from './dedup'
import { nextReview } from '../review'
import { getSettings } from '../settings'

/**
 * 检查 vault 是否可用，如果不可用则抛出清晰错误
 */
function assertVaultAvailable(): void {
  const status = getVaultStatus()
  if (!status.exists) {
    const configuredPath = status.configured || status.dir
    throw new Error(
      `「${configuredPath}」 不存在，可能是磁盘/移动硬盘没挂上。已停止写入，避免把错题写到别处。`
    )
  }
}

/* ────────────── 写入 ────────────── */

/** 原子写入：先写同目录的 .tmp，再 rename 覆盖 */
async function atomicWrite(absPath: string, content: string): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true })
  const tmp = `${absPath}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, absPath)
}

async function writeMistake(m: Mistake): Promise<string> {
  assertVaultAvailable()
  const absPath = join(getVaultDir(), mistakeRelPath(m))
  await atomicWrite(absPath, mistakeToMarkdown(m))
  const { db } = openIndex()
  initSchema(db)
  upsertRow(db, m, toRelPosix(absPath))
  return absPath
}

function toRelPosix(absPath: string): string {
  return relative(getVaultDir(), absPath).split(sep).join('/')
}

/**
 * 新建一道错题。
 * @param model 实际做识别的模型名，用于记录来源；不确定时不要传，宁缺毋滥。
 */
export async function createMistake(input: MistakeInput, model?: string): Promise<{ id: string }> {
  const id = await allocateId()
  const now = new Date().toISOString()

  const m: Mistake = {
    id,
    created: now,
    source: input.extraction.source,
    subject: input.extraction.subject,
    chapter: input.extraction.chapter ?? [],
    points: input.extraction.points ?? [],
    type: input.extraction.type,
    level: input.extraction.level,
    myAnswer: input.extraction.myAnswer,
    rightAnswer: input.extraction.rightAnswer,
    errorType: input.extraction.errorType,
    status: 'new',
    confidence: input.extraction.confidence,
    review: nextReview({ round: 0 }, 'good', getSettings().examDate),
    body: input.extraction.body
  }
  if (model) m.llm = { model, at: now }

  if (input.imageAbsPath) {
    const fileName = `${id}.png`
    await mkdir(assetsDir(), { recursive: true })
    await copyFile(input.imageAbsPath, join(assetsDir(), fileName))
    m.imagePath = `assets/${fileName}`
  }

  await writeMistake(m)
  return { id }
}

/** 生成一个当前仓库里没被占用的 id（随机 id 会碰撞，必须查重） */
async function allocateId(): Promise<string> {
  const taken = await collectExistingIds()
  return pickUniqueId((id) => taken.has(id))
}

/** 扫一次仓库收集已占用的 id —— 文件名（去掉 .md）就是 id */
async function collectExistingIds(): Promise<Set<string>> {
  const files = await findAllMarkdownFiles(mistakesDir())
  return new Set(files.map((f) => f.slice(f.lastIndexOf(sep) + 1, -'.md'.length)))
}

/**
 * 部分更新。补丁里没提到的字段一律保持原样 ——
 * 尤其是 review / status / created，它们承载复习进度，绝不能被写回默认值。
 */
export async function updateMistake(id: string, patch: Partial<Mistake>): Promise<void> {
  const existing = await readMistake(id)
  if (!existing) throw new Error(`找不到错题 ${id}`)

  const merged: Mistake = {
    ...existing,
    ...patch,
    id: existing.id,
    created: existing.created,
    updated: new Date().toISOString(),
    // 正文按小节合并，未提交的小节沿用旧值
    body: { ...existing.body, ...(patch.body ?? {}) }
  }

  const oldPath = join(getVaultDir(), mistakeRelPath(existing))
  const newPath = join(getVaultDir(), mistakeRelPath(merged))

  await writeMistake(merged)

  // 科目/章节改动会导致换目录，把旧文件清掉（索引已指向新路径）
  if (oldPath !== newPath) await unlink(oldPath).catch(() => {})
}

/** 兼容入口：给了 id 就是更新，没给就是新建 */
export async function saveMistake(
  input: MistakeInput,
  id?: string,
  model?: string
): Promise<{ id: string }> {
  if (id) {
    await updateMistake(id, {
      source: input.extraction.source,
      subject: input.extraction.subject,
      chapter: input.extraction.chapter ?? [],
      points: input.extraction.points ?? [],
      type: input.extraction.type,
      level: input.extraction.level,
      myAnswer: input.extraction.myAnswer,
      rightAnswer: input.extraction.rightAnswer,
      errorType: input.extraction.errorType,
      confidence: input.extraction.confidence,
      body: input.extraction.body
    })
    return { id }
  }
  return createMistake(input, model)
}

/* ────────────── 合并重复记录 ────────────── */

const keepStr = (old?: string, next?: string): string | undefined =>
  old && old.trim() ? old : next

const keepNum = (old?: number, next?: number): number | undefined => (old != null ? old : next)

const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])]

/**
 * 把新信息**补进空缺**，绝不覆盖已有内容。
 *
 * 合并的语义必须是「补全」而不是「覆盖」：已有那份是用户看过、很可能手改过、
 * 还带着复习进度的，用一次新识别的结果盖掉它，等于把用户的劳动抹掉。
 * 复习进度（review / status / created / id）一律以目标记录为准。
 */
function mergeInto(
  target: Mistake,
  income: {
    source?: string
    chapter?: string[]
    points?: string[]
    level?: number
    myAnswer?: string
    rightAnswer?: string
    errorType?: ErrorType
    confidence?: number
    body?: MistakeBody
  }
): Mistake {
  const tb = target.body
  const ib = income.body
  return {
    ...target,
    source: keepStr(target.source, income.source),
    // subject / type 是有默认值的必填项，目标一定非空 —— 题目归属以已有记录为准
    chapter: union(target.chapter ?? [], income.chapter ?? []),
    points: union(target.points ?? [], income.points ?? []),
    level: keepNum(target.level, income.level),
    myAnswer: keepStr(target.myAnswer, income.myAnswer),
    rightAnswer: keepStr(target.rightAnswer, income.rightAnswer),
    errorType: target.errorType ?? income.errorType,
    // 取更高的一次：两次识别里更自信的那个更可能是对的
    confidence: Math.max(target.confidence, income.confidence ?? 0),
    body: {
      question: keepStr(tb.question, ib?.question) ?? '',
      myThought: keepStr(tb.myThought, ib?.myThought),
      solution: keepStr(tb.solution, ib?.solution),
      cause: keepStr(tb.cause, ib?.cause),
      variant: keepStr(tb.variant, ib?.variant)
    },
    updated: new Date().toISOString()
  }
}

/** 目标没有原图时，把 sourceAbsPath 复制成以 target 命名的资源文件 */
async function adoptImage(target: Mistake, sourceAbsPath?: string, srcImagePath?: string): Promise<void> {
  if (target.imagePath) return

  if (sourceAbsPath) {
    const fileName = `${target.id}${extname(sourceAbsPath) || '.png'}`
    await mkdir(assetsDir(), { recursive: true })
    await copyFile(sourceAbsPath, join(assetsDir(), fileName))
    target.imagePath = `assets/${fileName}`
    return
  }

  if (srcImagePath) {
    // 目标是已有记录、源记录自带图片：复制一份，不能让目标继续指向将被移入 .trash 的文件
    const srcAbs = join(getVaultDir(), srcImagePath)
    const fileName = `${target.id}${extname(srcImagePath) || '.png'}`
    await mkdir(assetsDir(), { recursive: true })
    await copyFile(srcAbs, join(assetsDir(), fileName))
    target.imagePath = `assets/${fileName}`
  }
}

/**
 * 保存时选择「并入已有的那道题」：不新建记录，把这次的识别结果补进目标。
 * 走这条路就不会产生重复条目，目标的复习进度也原样保留。
 */
export async function mergeIntoExisting(
  targetId: string,
  input: MistakeInput,
  model?: string
): Promise<void> {
  const target = await readMistake(targetId)
  if (!target) throw new Error(`找不到要合并到的错题 ${targetId}`)

  const merged = mergeInto(target, input.extraction)
  await adoptImage(merged, input.imageAbsPath)
  if (model && !merged.llm) merged.llm = { model, at: new Date().toISOString() }

  await writeMistake(merged)
}

/**
 * 把书库里已有的两条重复记录合并成一条：保留 `targetId`，`sourceId` 移入回收站。
 * 保留目标而不是源，是为了保住复习进度 —— 那是攒出来的，重建不了。
 */
export async function mergeMistake(sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new Error('不能和自己合并')

  const [source, target] = await Promise.all([readMistake(sourceId), readMistake(targetId)])
  if (!source) throw new Error(`找不到错题 ${sourceId}`)
  if (!target) throw new Error(`找不到错题 ${targetId}`)

  const merged = mergeInto(target, {
    source: source.source,
    chapter: source.chapter,
    points: source.points,
    level: source.level,
    myAnswer: source.myAnswer,
    rightAnswer: source.rightAnswer,
    errorType: source.errorType,
    confidence: source.confidence,
    body: source.body
  })
  // 合并掉的是记录，不是历史 —— 记下它曾经是两道题
  merged.mergedFrom = [...(target.mergedFrom ?? []), ...(source.mergedFrom ?? []), source.id]

  await adoptImage(merged, undefined, source.imagePath)
  await writeMistake(merged)
  await deleteMistake(sourceId)
}

/** 删除错题及其图片 */
export async function deleteMistake(id: string): Promise<void> {
  const filePath = await findMistakeFile(id)

  if (filePath) {
    // 移动到回收站，而不是删除
    // 如果移动失败（比如文件系统问题），会抛出错误
    await moveToTrash(id, filePath)
  }

  const db = openIndex().db
  initSchema(db)
  deleteRow(db, id)
}

/**
 * 移动错题到回收站
 * .md移动失败会抛出错误，避免图片先消失
 */
async function moveToTrash(mistakeId: string, sourcePath: string): Promise<void> {
  const vaultDir = getVaultDir()
  const trashDir = join(vaultDir, '.trash', mistakeId)

  // 创建回收站目录
  await mkdir(trashDir, { recursive: true })

  // 先移动 .md 文件
  const destMd = join(trashDir, `${mistakeId}.md`)
  await rename(sourcePath, destMd)

  // 只有.md移动成功后才移动图片
  try {
    const imagePath = join(vaultDir, 'assets', `${mistakeId}.png`)
    const destImage = join(trashDir, `${mistakeId}.png`)
    await rename(imagePath, destImage)
  } catch {
    // 图片不存在，忽略
  }
}

/* ────────────── 读取 ────────────── */

export async function readMistake(id: string): Promise<Mistake | null> {
  const filePath = await findMistakeFile(id)
  if (!filePath) return null
  try {
    return markdownToMistake(await readFile(filePath, 'utf8'))
  } catch (e) {
    console.error(`[vault] 解析失败 ${filePath}：`, e)
    return null
  }
}

export async function listMistakes(filter?: ListFilter): Promise<MistakeSummary[]> {
  const { db } = openIndex()
  initSchema(db)
  return querySummaries(db, filter ?? {})
}

export async function allMistakes(): Promise<Mistake[]> {
  const files = await findAllMarkdownFiles(mistakesDir())
  const out: Mistake[] = []
  for (const f of files) {
    try {
      out.push(markdownToMistake(await readFile(f, 'utf8')))
    } catch (e) {
      console.error('[vault] 跳过无法解析的文件：', f, e)
    }
  }
  return out
}

/** 按 id 找文件。文件名是 `<id>.md`，所以按文件名递归即可 */
export async function findMistakeFile(id: string): Promise<string | null> {
  return findByName(mistakesDir(), `${id}.md`)
}

async function findByName(dir: string, fileName: string): Promise<string | null> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === fileName) return full
    if (entry.isDirectory()) {
      // 跳过 .trash 目录
      if (entry.name === '.trash') continue
      const found = await findByName(full, fileName)
      if (found) return found
    }
  }
  return null
}

async function findAllMarkdownFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    // 跳过 .trash 目录
    if (entry.isDirectory() && entry.name !== '.trash') {
      out.push(...(await findAllMarkdownFiles(full)))
    }
    // 忽略写入中途留下的临时文件
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

/* ────────────── 索引重建 ────────────── */

export async function rebuildIndex(): Promise<{ count: number; needsRebuild: boolean }> {
  const { db, needsRebuild } = openIndex()
  initSchema(db)
  db.exec('DELETE FROM points')
  db.exec('DELETE FROM chapters')
  db.exec('DELETE FROM mistakes')

  const files = await findAllMarkdownFiles(mistakesDir())
  let count = 0
  for (const filePath of files) {
    try {
      const m = markdownToMistake(await readFile(filePath, 'utf8'))
      upsertRow(db, m, toRelPosix(filePath))
      count++
    } catch (e) {
      console.error('[vault] 重建时跳过无法解析的文件：', filePath, e)
    }
  }

  // 复习历史重建不出来（Markdown 只留得下「上次复习」与轮次），
  // 所以必须从 vault 里的 reviews.jsonl 回填 —— 否则重建一次，趋势统计就全成 0 了
  replaceReviews(db, await readReviewEvents())

  return { count, needsRebuild }
}

/**
 * 查重候选。单条查重时传 subject 缩小范围；整库扫描不传。
 * 取的是索引里的**完整题干**，不是列表那种截断预览。
 */
export function dedupCandidates(subject?: string): DedupCandidate[] {
  const { db } = openIndex()
  initSchema(db)
  return duplicateCandidates(db, subject)
}
