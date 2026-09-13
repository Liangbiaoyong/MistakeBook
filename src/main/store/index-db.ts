/**
 * SQLite 索引管理 —— 使用 Electron 44 内置的 node:sqlite。
 * 索引可从 vault 的 Markdown 文件重建。
 */
import { DatabaseSync } from 'node:sqlite'
import type { Mistake, MistakeSummary, ListFilter, StatsOverview } from '@shared/types'
import { getIndexPath } from './paths'
import { questionPreview } from './frontmatter'

let dbInstance: DatabaseSync | null = null

/**
 * 打开或创建索引数据库
 * 遇到损坏时自动恢复：重命名旧文件，创建新数据库，返回标记告知需要重建
 */
export function openIndex(): { db: DatabaseSync; needsRebuild: boolean } {
  if (dbInstance) return { db: dbInstance, needsRebuild: false }

  const dbPath = getIndexPath()
  let needsRebuild = false

  try {
    // 尝试打开现有数据库
    dbInstance = new DatabaseSync(dbPath)
    // 尝试读取以验证数据库是否可访问
    dbInstance.prepare('SELECT 1 FROM mistakes LIMIT 1')
  } catch (e) {
    // 数据库损坏或不存在，创建新的
    if (dbInstance) {
      try { dbInstance.close() } catch {}
      dbInstance = null
    }

    // 如果旧文件存在，重命名以保留
    const { existsSync, renameSync } = require('node:fs')
    if (existsSync(dbPath)) {
      const timestamp = Date.now()
      renameSync(dbPath, `${dbPath}.bad-${timestamp}`)
    }

    // 创建新数据库
    dbInstance = new DatabaseSync(dbPath)
    needsRebuild = true
  }

  dbInstance.exec('PRAGMA journal_mode = WAL')
  initSchema(dbInstance)

  return { db: dbInstance, needsRebuild }
}

/**
 * 初始化数据库结构
 */
export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mistakes (
      id TEXT PRIMARY KEY,
      created TEXT NOT NULL,
      updated TEXT,
      source TEXT,
      subject TEXT NOT NULL,
      type TEXT NOT NULL,
      level INTEGER,
      my_answer TEXT,
      right_answer TEXT,
      error_type TEXT,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      last_review TEXT,
      next_review TEXT,
      review_round INTEGER NOT NULL,
      llm_model TEXT,
      llm_at TEXT,
      image TEXT,
      question TEXT NOT NULL,
      my_thought TEXT,
      solution TEXT,
      cause TEXT,
      variant TEXT,
      md_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS points (
      mistake_id TEXT NOT NULL,
      point TEXT NOT NULL,
      PRIMARY KEY (mistake_id, point),
      FOREIGN KEY (mistake_id) REFERENCES mistakes(id)
    );

    CREATE TABLE IF NOT EXISTS chapters (
      mistake_id TEXT NOT NULL,
      chapter TEXT NOT NULL,
      PRIMARY KEY (mistake_id, chapter),
      FOREIGN KEY (mistake_id) REFERENCES mistakes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject);
    CREATE INDEX IF NOT EXISTS idx_mistakes_status ON mistakes(status);
    CREATE INDEX IF NOT EXISTS idx_mistakes_error_type ON mistakes(error_type);
    CREATE INDEX IF NOT EXISTS idx_points_point ON points(point);
  `)
}

/**
 * 插入或更新单条记录
 */
export function upsertRow(db: DatabaseSync, m: Mistake, mdPath: string): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO mistakes (
      id, created, updated, source, subject, type, level,
      my_answer, right_answer, error_type, status, confidence,
      last_review, next_review, review_round,
      llm_model, llm_at, image,
      question, my_thought, solution, cause, variant,
      md_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    m.id,
    m.created,
    m.updated ?? null,
    m.source ?? null,
    m.subject,
    m.type,
    m.level ?? null,
    m.myAnswer ?? null,
    m.rightAnswer ?? null,
    m.errorType ?? null,
    m.status,
    m.confidence,
    m.review.last ?? null,
    m.review.next ?? null,
    m.review.round,
    m.llm?.model ?? null,
    m.llm?.at ?? null,
    m.imagePath ?? null,
    m.body.question,
    m.body.myThought ?? null,
    m.body.solution ?? null,
    m.body.cause ?? null,
    m.body.variant ?? null,
    mdPath
  )

  // 清理旧的 points 和 chapters 记录
  db.prepare('DELETE FROM points WHERE mistake_id = ?').run(m.id)
  db.prepare('DELETE FROM chapters WHERE mistake_id = ?').run(m.id)

  // 插入 points
  const pointStmt = db.prepare('INSERT INTO points (mistake_id, point) VALUES (?, ?)')
  for (const point of m.points) {
    pointStmt.run(m.id, point)
  }

  // 插入 chapters
  const chapterStmt = db.prepare('INSERT INTO chapters (mistake_id, chapter) VALUES (?, ?)')
  for (const chapter of m.chapter) {
    chapterStmt.run(m.id, chapter)
  }
}

/**
 * 删除记录
 */
export function deleteRow(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM points WHERE mistake_id = ?').run(id)
  db.prepare('DELETE FROM chapters WHERE mistake_id = ?').run(id)
  db.prepare('DELETE FROM mistakes WHERE id = ?').run(id)
}

/**
 * 根据过滤条件查询摘要列表
 */
export function querySummaries(db: DatabaseSync, filter?: ListFilter): MistakeSummary[] {
  let sql = `
    SELECT
      m.id, m.created, m.subject, m.type, m.error_type,
      m.status, m.level, m.confidence, m.last_review, m.next_review,
      m.review_round, m.question, m.image,
      GROUP_CONCAT(DISTINCT p.point) as points_str,
      GROUP_CONCAT(DISTINCT c.chapter) as chapters_str
    FROM mistakes m
    LEFT JOIN points p ON m.id = p.mistake_id
    LEFT JOIN chapters c ON m.id = c.mistake_id
  `

  const conditions: string[] = []
  const params: (string | number | null)[] = []

  if (filter?.subject) {
    conditions.push('m.subject = ?')
    params.push(filter.subject)
  }

  if (filter?.chapter) {
    conditions.push('EXISTS (SELECT 1 FROM chapters c WHERE c.mistake_id = m.id AND c.chapter LIKE ?)')
    params.push(`%${filter.chapter}%`)
  }

  if (filter?.point) {
    conditions.push('EXISTS (SELECT 1 FROM points p WHERE p.mistake_id = m.id AND p.point LIKE ?)')
    params.push(`%${filter.point}%`)
  }

  if (filter?.errorType) {
    conditions.push('m.error_type = ?')
    params.push(filter.errorType)
  }

  if (filter?.status) {
    conditions.push('m.status = ?')
    params.push(filter.status)
  }

  if (filter?.q) {
    conditions.push(`(
      m.question LIKE ? OR
      m.my_thought LIKE ? OR
      m.solution LIKE ? OR
      m.cause LIKE ? OR
      m.source LIKE ? OR
      EXISTS (SELECT 1 FROM points p WHERE p.mistake_id = m.id AND p.point LIKE ?) OR
      EXISTS (SELECT 1 FROM chapters c WHERE c.mistake_id = m.id AND c.chapter LIKE ?)
    )`)
    const likePattern = `%${filter.q}%`
    params.push(likePattern, likePattern, likePattern, likePattern, likePattern, likePattern, likePattern)
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }

  sql += ' GROUP BY m.id'
  sql += ' ORDER BY m.created DESC'

  if (filter?.limit) {
    sql += ' LIMIT ?'
    params.push(filter.limit)
  }

  if (filter?.offset) {
    sql += ' OFFSET ?'
    params.push(filter.offset)
  }

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>

  return rows.map(row => ({
    id: row.id as string,
    created: row.created as string,
    subject: row.subject as string,
    chapter: (row.chapters_str as string ?? '').split(',').filter(Boolean),
    points: (row.points_str as string ?? '').split(',').filter(Boolean),
    type: row.type as MistakeSummary['type'],
    errorType: row.error_type as MistakeSummary['errorType'],
    status: row.status as MistakeSummary['status'],
    level: row.level as MistakeSummary['level'],
    confidence: row.confidence as number,
    review: {
      last: row.last_review as string | undefined,
      next: row.next_review as string | undefined,
      round: row.review_round as number
    },
    questionHead: questionPreview(row.question as string),
    imagePath: row.image as string | undefined
  }))
}

/**
 * 统计概览
 */
export function statsOverview(db: DatabaseSync): StatsOverview {
  const total = (db.prepare('SELECT COUNT(*) as cnt FROM mistakes').get() as { cnt: number }).cnt

  const bySubject = (db.prepare(
    'SELECT subject as `key`, COUNT(*) as count FROM mistakes GROUP BY subject ORDER BY count DESC'
  ).all() as Array<Record<string, unknown>>).map(row => ({
    key: String(row.key),
    count: Number(row.count)
  }))

  const byErrorType = (db.prepare(
    'SELECT error_type as `key`, COUNT(*) as count FROM mistakes WHERE error_type IS NOT NULL GROUP BY error_type ORDER BY count DESC'
  ).all() as Array<Record<string, unknown>>).map(row => ({
    key: String(row.key),
    count: Number(row.count)
  }))

  const byPoint = (db.prepare(
    'SELECT point as `key`, COUNT(*) as count FROM points GROUP BY point ORDER BY count DESC'
  ).all() as Array<Record<string, unknown>>).map(row => ({
    key: String(row.key),
    count: Number(row.count)
  }))

  const byChapter = (db.prepare(
    'SELECT chapter as `key`, COUNT(*) as count FROM chapters GROUP BY chapter ORDER BY count DESC'
  ).all() as Array<Record<string, unknown>>).map(row => ({
    key: String(row.key),
    count: Number(row.count)
  }))

  const byStatus = (db.prepare(
    'SELECT status as `key`, COUNT(*) as count FROM mistakes GROUP BY status'
  ).all() as Array<Record<string, unknown>>).map(row => ({
    key: String(row.key),
    count: Number(row.count)
  }))

  // 使用JS获取本地日期，而不是SQLite的date('now')
  const localDate = getLocalDate()

  // 最近 7 天每日新增（使用本地日期）
  const daily = db.prepare(`
    SELECT date(created) as date, COUNT(*) as count
    FROM mistakes
    WHERE created >= date(?, '-7 days')
    GROUP BY date(created)
    ORDER BY date ASC
  `).all(localDate) as { date: string; count: number }[]

  // 待复习数量（使用本地日期）
  const dueCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM mistakes WHERE next_review IS NOT NULL AND next_review <= ?'
  ).get(localDate) as { cnt: number }).cnt

  return {
    total,
    bySubject,
    byErrorType: byErrorType as StatsOverview['byErrorType'],
    byPoint,
    byChapter,
    byStatus: byStatus as StatsOverview['byStatus'],
    daily,
    dueCount
  }
}

/**
 * 获取本地日期 YYYY-MM-DD 格式
 */
function getLocalDate(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 获取待复习的错题
 */
export function dueList(db: DatabaseSync, today: string): MistakeSummary[] {
  return querySummaries(db, {
    status: 'new', // new 和 reviewing 的都可以复习
    limit: 50 // 最多返回 50 条
  }).filter(m => {
    return !m.review.next || m.review.next <= today
  })
}

/**
 * 统计记录总数
 */
export function countRows(db: DatabaseSync): number {
  const result = db.prepare('SELECT COUNT(*) as cnt FROM mistakes').get() as { cnt: number }
  return result.cnt
}
