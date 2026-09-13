/**
 * vault 操作 —— Markdown 文件的 CRUD 与索引同步。
 *
 * 两条纪律：
 * 1. 文件是唯一真相源，索引只是派生物 —— 所以任何写入都必须先落盘。
 * 2. 写入必须原子：先写 .tmp 再 rename，绝不允许出现半截文件。
 */
import { readFile, writeFile, rename, copyFile, unlink, mkdir, readdir } from 'node:fs/promises'
import { join, dirname, relative, sep } from 'node:path'
import type { Mistake, MistakeInput, MistakeSummary, ListFilter } from '@shared/types'
import { mistakesDir, assetsDir, getVaultDir, getVaultStatus } from './paths'
import { mistakeToMarkdown, markdownToMistake, pickUniqueId, mistakeRelPath } from './frontmatter'
import { openIndex, initSchema, upsertRow, deleteRow, querySummaries } from './index-db'
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
  return { count, needsRebuild }
}
