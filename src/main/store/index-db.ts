/**
 * SQLite 索引管理 —— 使用 Electron 44 内置的 node:sqlite。
 * 索引可从 vault 的 Markdown 文件重建。
 */
import { DatabaseSync } from 'node:sqlite'
import type { Mistake, MistakeSummary, ListFilter, StatsOverview, ReviewEvent } from '@shared/types'
import { getIndexPath } from './paths'
import { questionPreview } from './frontmatter'
import { fillDays, localDate, periodComparison } from './trend'
import type { DedupCandidate } from './dedup'

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

    -- 复习事件（派生自 vault 的 reviews.jsonl，重建索引时由它回填）。
    -- 这张表是唯一无法只靠 Markdown 重建的东西，所以真相源在 vault 里，见 reviews-log.ts。
    CREATE TABLE IF NOT EXISTS reviews (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      mistake_id TEXT NOT NULL,
      date TEXT NOT NULL,
      grade TEXT NOT NULL,
      round INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject);
    CREATE INDEX IF NOT EXISTS idx_mistakes_status ON mistakes(status);
    CREATE INDEX IF NOT EXISTS idx_mistakes_error_type ON mistakes(error_type);
    CREATE INDEX IF NOT EXISTS idx_points_point ON points(point);
    CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(date);
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

/* ────────────── 复习事件 ────────────── */

/** 追加一条评分事件 */
export function recordReview(db: DatabaseSync, e: ReviewEvent): void {
  db.prepare('INSERT INTO reviews (mistake_id, date, grade, round) VALUES (?, ?, ?, ?)').run(
    e.id,
    e.date,
    e.grade,
    e.round
  )
}

/** 重建索引用：清空后由 reviews.jsonl 回填 */
export function replaceReviews(db: DatabaseSync, events: ReviewEvent[]): void {
  db.exec('DELETE FROM reviews')
  const stmt = db.prepare(
    'INSERT INTO reviews (mistake_id, date, grade, round) VALUES (?, ?, ?, ?)'
  )
  for (const e of events) stmt.run(e.id, e.date, e.grade, e.round)
}

/** 统计概览 */
export function statsOverview(db: DatabaseSync, windowDaysRaw: number): StatsOverview {
  const windowDays = clampWindow(windowDaysRaw)
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

  // 一律用本地日期，不用 SQLite 的 date('now')（那是 UTC，凌晨会算到前一天）
  const today = getLocalDate()

  // 每天新增（本地日期）
  const addedRows = db.prepare(`
    SELECT date(created) as d, COUNT(*) as n
    FROM mistakes
    GROUP BY date(created)
  `).all() as Array<{ d: string; n: number }>

  // 每天复习量与其中「忘了」的次数。这里要跨两个窗口，所以不按窗口过滤，全量交给 JS 切。
  const reviewRows = db.prepare(`
    SELECT date as d, COUNT(*) as n,
           SUM(CASE WHEN grade = 'again' THEN 1 ELSE 0 END) as forgot
    FROM reviews
    GROUP BY date
  `).all() as Array<{ d: string; n: number; forgot: number }>

  const merged = new Map<string, { date: string; added: number; reviewed: number }>()
  for (const r of addedRows) {
    const cur = merged.get(r.d) ?? { date: r.d, added: 0, reviewed: 0 }
    cur.added += Number(r.n)
    merged.set(r.d, cur)
  }
  for (const r of reviewRows) {
    const cur = merged.get(r.d) ?? { date: r.d, added: 0, reviewed: 0 }
    cur.reviewed += Number(r.n)
    merged.set(r.d, cur)
  }

  const daily = fillDays([...merged.values()], windowDays, today)

  const forgotByDate = new Map<string, number>()
  for (const r of reviewRows) forgotByDate.set(r.d, Number(r.forgot))

  const trend = periodComparison(daily, forgotByDate, windowDays, today)

  const reviewEvents = (
    db.prepare('SELECT COUNT(*) as cnt FROM reviews').get() as { cnt: number }
  ).cnt

  // 待复习数量（本地日期）
  const dueCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM mistakes WHERE next_review IS NOT NULL AND next_review <= ?'
  ).get(today) as { cnt: number }).cnt

  return {
    total,
    bySubject,
    byErrorType: byErrorType as StatsOverview['byErrorType'],
    byPoint,
    byChapter,
    byStatus: byStatus as StatsOverview['byStatus'],
    windowDays,
    daily,
    trend,
    reviewEvents,
    dueCount
  }
}

/** 窗口天数收进合理区间，避免设置里手滑写成 0 或 99999 */
function clampWindow(n: number): number {
  if (!Number.isFinite(n)) return 30
  return Math.min(3650, Math.max(1, Math.round(n)))
}

/**
 * 获取本地日期 YYYY-MM-DD 格式
 */
function getLocalDate(): string {
  return localDate(new Date())
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

/* ────────────── 查重候选 ────────────── */

/**
 * 取出查重用的候选。
 *
 * 注意这里拿的是**完整题干** `question`，不是列表用的 `questionHead` ——
 * 后者被截断到几十个字，截断后的短句之间相似度会失真（这正是列表预览不能拿来查重的原因）。
 *
 * @param subject 限定科目。单条查重时按科目缩小范围；整库扫描时不传。
 */
export function duplicateCandidates(db: DatabaseSync, subject?: string): DedupCandidate[] {
  const base = `SELECT m.id, m.subject, m.created, m.question, m.status, m.review_round, m.image
    FROM mistakes m`
  const rows = (
    subject
      ? db.prepare(`${base} WHERE m.subject = ? ORDER BY m.created ASC`).all(subject)
      : db.prepare(`${base} ORDER BY m.subject ASC, m.created ASC`).all()
  ) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: row.id as string,
    subject: row.subject as string,
    created: row.created as string,
    question: (row.question as string) ?? '',
    status: row.status as DedupCandidate['status'],
    reviewRound: Number(row.review_round ?? 0),
    hasImage: Boolean(row.image)
  }))
}
