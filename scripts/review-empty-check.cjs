/**
 * 复习页「空态」的回归检查。
 *
 * 盯的是用户实际报的那个 bug：
 *   书库里有题，复习页却说「还没有错题」，而且筛选栏与「重做」按钮全都不见了。
 *
 * 根因有两个，都要靠断言钉住，不能再靠肉眼：
 *  1. 持久化偏好（mode=all）在**初次查询之后**才恢复，且恢复不重查 ——
 *     于是屏幕上是 due 的结果（0 条）、控件里是 all 的状态，空态照 all 选分支选错了。
 *  2. 筛选栏只写在「有题」那一支的 return 里 → 空态下无法自定义范围。
 *
 * 用法：npx electron scripts/review-empty-check.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (data) => ({ ok: true, data })

let failures = 0
const check = (name, pass, detail) => {
  console.log(`[empty] ${pass ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!pass) failures++
}

const summary = (i) => ({
  id: `m-${i}`, created: '2026-09-13T10:00:00.000Z', subject: '408', chapter: ['数据结构'],
  points: ['树的度'], type: '单选', errorType: '概念混淆', status: 'reviewing', level: 3,
  confidence: 0.9, review: { last: '2026-09-13', next: '2026-09-20', round: 2 },
  questionHead: `第 ${i} 题的题干`
})

/** 每个场景可以通过这里改桩的行为 */
const stub = {
  prefs: null,        // settings:get 里的 reviewPrefs
  libraryTotal: 5,    // 书库里有多少道
  dueItems: 0         // mode=due 时返回几道
}
const queries = []

ipcMain.handle('config:get', () => ok({ providers: [], keysSet: {}, default: { provider: 'x', model: 'y' }, features: {} }))
ipcMain.handle('vault:get', () => ok('D:/Documents/MistakeBook'))
ipcMain.handle('settings:get', () => ok({ hotkey: 'Alt+Shift+A', statsWindowDays: 30, reviewPrefs: stub.prefs }))
ipcMain.handle('settings:set', (_e, p) => { if (p && p.reviewPrefs) stub.prefs = p.reviewPrefs; return ok({ hotkey: 'Alt+Shift+A', statsWindowDays: 30, ...p }) })
ipcMain.handle('mistake:list', () => ok([]))
ipcMain.handle('mistake:get', () => ok(null))
ipcMain.handle('review:grade', () => ok(null))
ipcMain.handle('stats:overview', () =>
  ok({
    total: stub.libraryTotal, bySubject: [], byErrorType: [], byPoint: [], byChapter: [], byStatus: [],
    windowDays: 30, daily: [],
    trend: { days: 30, current: { added: 0, reviewed: 0, forgot: 0, forgotRate: null }, previous: { added: 0, reviewed: 0, forgot: 0, forgotRate: null } },
    reviewEvents: 0, dueCount: 0
  })
)
ipcMain.handle('review:query', (_e, q) => {
  queries.push(q.mode)
  // 书库里有题，但「只过到期的」可能一道都没有 —— 这正是用户遇到的情形
  const n = q.mode === 'all' ? stub.libraryTotal : stub.dueItems
  const items = Array.from({ length: n }, (_, i) => summary(i + 1))
  return ok({
    items,
    total: items.length,
    from: items.length ? 1 : 0,
    to: items.length,
    libraryTotal: stub.libraryTotal,
    librarySubjects: ['408', '数学二']
  })
})
ipcMain.handle('mistake:duplicates', () => ok([]))
ipcMain.handle('mistake:duplicateScan', () => ok([]))
ipcMain.handle('config:listModels', () => ok([]))

setTimeout(() => { console.log('[empty] 兜底退出'); app.exit(9) }, 120000)
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1320, height: 880, show: false,
    webPreferences: { preload: path.join(ROOT, 'out', 'preload', 'index.js'), contextIsolation: true, sandbox: false }
  })

  const snapshot = async () => {
    await win.webContents.executeJavaScript(
      `(() => { const b=[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('复习')); if(b) b.click(); return !!b })()`
    )
    await wait(1600)
    return win.webContents.executeJavaScript(`(() => {
      const t = document.body.innerText
      return {
        emptyTitles: ['还没有错题','今天没有到期的错题','这个范围里一道题都没有','这批题目已全部完成'].filter(s => t.includes(s)),
        hasFilterPanel: !!document.querySelector('[aria-label="按题型筛选"]'),
        hasSubjectOptions: (document.querySelector('[aria-label="按科目筛选"]')?.options.length ?? 0) > 1,
        hasStart: [...document.querySelectorAll('button')].some(b => b.textContent.includes('开始复习')),
        hasSwitchAll: [...document.querySelectorAll('button')].some(b => b.textContent.includes('全部范围内')),
        hasRedo: [...document.querySelectorAll('button')].some(b => b.textContent.includes('再做一遍')),
        hasCard: t.includes('显示答案')
      }
    })()`)
  }

  // ── 场景 1：偏好里 mode=all，书库有 5 道、没有一道到期 ──
  // 修复前：初次查询用默认的 due → 拿到 0 条 → 又说「还没有错题」，控件里却是 all
  stub.prefs = { mode: 'all', order: 'due', limit: 20 }
  stub.libraryTotal = 5
  stub.dueItems = 0
  queries.length = 0
  await win.loadFile(path.join(ROOT, 'out', 'renderer', 'index.html'))
  await wait(1400)
  const s1 = await snapshot()
  check('恢复偏好后第一次查询就用的是恢复出来的模式（不查 due）', !queries.includes('due'), `实际查询=${JSON.stringify(queries)}`)
  check('书库有题时直接出题，不再显示「还没有错题」', s1.hasCard && s1.emptyTitles.length === 0, `空态文案=${JSON.stringify(s1.emptyTitles)}`)
  check('科目下拉被真实科目填满（不是只剩「全部科目」）', s1.hasSubjectOptions)

  // ── 场景 2：mode=due，书库 5 道但今天没到期的 ──
  stub.prefs = { mode: 'due', order: 'due', limit: 20 }
  queries.length = 0
  await win.loadFile(path.join(ROOT, 'out', 'renderer', 'index.html'))
  await wait(1400)
  const s2 = await snapshot()
  check('空态说的是「今天没有到期的错题」，而不是「还没有错题」',
    s2.emptyTitles.includes('今天没有到期的错题') && !s2.emptyTitles.includes('还没有错题'),
    `空态文案=${JSON.stringify(s2.emptyTitles)}`)
  check('空态下筛选栏仍然在（这就是「不能自定义」的修复）', s2.hasFilterPanel && s2.hasStart)
  check('空态下给出「切到全部范围内」的出路', s2.hasSwitchAll)

  // ── 场景 3：书库真的是空的 ──
  stub.prefs = { mode: 'due', order: 'due', limit: 20 }
  stub.libraryTotal = 0
  queries.length = 0
  await win.loadFile(path.join(ROOT, 'out', 'renderer', 'index.html'))
  await wait(1400)
  const s3 = await snapshot()
  check('书库为空时才说「还没有错题」', s3.emptyTitles.includes('还没有错题'), `空态文案=${JSON.stringify(s3.emptyTitles)}`)

  console.log(`[empty] 断言结论: ${failures === 0 ? 'PASS' : `FAIL（${failures} 项）`}`)
  app.exit(failures === 0 ? 0 : 1)
})
