/**
 * 复习页的回归检查。
 *
 * 专门盯两件容易坏的事：
 *  1. 「换一批」是不是真的换了一批（用户报的 bug：以前只是重查同一批并跳回第 1 题）
 *  2. fix-renderer 加的键盘能力有没有被 review-session 的改动弄坏
 *     （同一文件被两轮大改，最容易出这种整合问题）
 *
 * 用法：npx electron scripts/review-check.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (data) => ({ ok: true, data })
const fail = (error) => ({ ok: false, error })

/** 造 20 条错题，题面互不相同，便于判断「换了一批」 */
const ALL = Array.from({ length: 40 }, (_, i) => {
  const n = i + 1
  return {
    id: `m-${String(n).padStart(2, '0')}`,
    created: `2026-09-${String((n % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
    subject: '408',
    chapter: ['数据结构', '树'],
    points: [`知识点${n}`],
    type: '单选',
    errorType: '概念混淆',
    status: 'new',
    level: 3,
    confidence: 0.9,
    review: { round: 0 },
    questionHead: `第${n}题：这是一道测试题 $x_${n}$`,
    imagePath: undefined
  }
})

/** 按 limit/offset 切片，并模拟主进程的绕回行为 */
function pageOf(offset, limit) {
  const total = ALL.length
  const size = limit > 0 ? limit : total
  const start = total > 0 ? offset % total : 0
  const items = ALL.slice(start, start + size)
  return { items, total, from: items.length ? start + 1 : 0, to: start + items.length }
}

let lastQuery = null

ipcMain.handle('review:query', (_e, q) => {
  lastQuery = q
  // ids 路径：严格按给定 id 顺序取（这正是「再做一遍这批」依赖的行为）
  if (q?.ids?.length) {
    const byId = new Map(ALL.map((x) => [x.id, x]))
    const items = q.ids.map((id) => byId.get(id)).filter(Boolean)
    return ok({ items, total: items.length, from: items.length ? 1 : 0, to: items.length })
  }
  return ok(pageOf(q?.offset ?? 0, q?.limit ?? 0))
})
ipcMain.handle('review:grade', () => ok(null))
ipcMain.handle('mistake:get', (_e, id) => {
  const s = ALL.find((x) => x.id === id)
  return s ? ok({ ...s, body: { question: s.questionHead, myAnswer: 'A', rightAnswer: 'B' } }) : fail('not found')
})
ipcMain.handle('config:get', () =>
  ok({ providers: [], keysSet: {}, default: { provider: 'x', model: 'y' }, features: {} })
)
ipcMain.handle('settings:get', () => ok({ hotkey: 'Alt+Shift+A', statsWindowDays: 30 }))
ipcMain.handle('settings:set', (_e, p) => ok({ hotkey: 'Alt+Shift+A', statsWindowDays: 30, ...p }))
ipcMain.handle('vault:get', () => ok('D:/x/MistakeBook'))
ipcMain.handle('mistake:list', () => ok(ALL))
ipcMain.handle('stats:overview', () =>
  ok({ total: 40, bySubject: [], byErrorType: [], byPoint: [], byChapter: [], byStatus: [], daily: [], dueCount: 20 })
)
ipcMain.handle('llm:extract', () => fail('n/a'))

setTimeout(() => { console.log('[review] 兜底退出'); app.exit(9) }, 90000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1320, height: 880, show: true, backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(ROOT, 'out', 'preload', 'index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })

  const js = (code) =>
    Promise.race([
      win.webContents.executeJavaScript(code),
      new Promise((r) => setTimeout(() => r('__TIMEOUT__'), 8000))
    ])

  await win.loadFile(path.join(ROOT, 'out', 'renderer', 'index.html'))
  await wait(1500)

  await js(`(() => { const b=[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('复习')); if(b) b.click(); return !!b })()`)
  await wait(1800)

  const bodyText = () => js(`document.body.innerText`)
  const batch1 = await bodyText()
  const q1 = lastQuery ? JSON.stringify(lastQuery) : 'null'

  // 点「换一批」
  const clicked = await js(
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('换一批')); if(b) b.click(); return !!b })()`
  )
  await wait(1600)
  const batch2 = await bodyText()
  const q2 = lastQuery ? JSON.stringify(lastQuery) : 'null'

  console.log('[review] 首屏是否出现题面：', batch1.includes('第1题') ? '✓' : '✗')
  console.log('[review] 首次查询参数：', q1)
  console.log('[review] 找到「换一批」按钮：', clicked ? '✓' : '✗')
  console.log('[review] 换一批后查询参数：', q2)
  console.log('[review] 是否出现第 21 题（= 真的换了批）：', batch2.includes('第21题') ? '✓' : '✗')
  console.log('[review] 两批内容不同：', batch1 !== batch2 ? '✓' : '✗')

  // 再点一次 → offset 40 应绕回开头，并提示「已从头开始」
  await js(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('换一批')); if(b) b.click(); return !!b })()`)
  await wait(1600)
  const batch3 = await bodyText()
  const q3 = lastQuery ? JSON.stringify(lastQuery) : 'null'
  console.log('[review] 第三次查询参数：', q3)
  console.log('[review] 第三次是否含第1题：', batch3.includes('第1题') ? '✓' : '✗')
  console.log('[review] 是否含「已从头开始」：', batch3.includes('已从头开始') ? '✓' : '✗')
  const wrapped = batch3.includes('已从头开始')
  console.log('[review] 绕回开头并提示：', wrapped ? '✓' : '✗')

  // 键盘：空格显示答案
  await js(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})); return true })()`)
  await wait(800)
  const afterSpace = await bodyText()
  console.log('[review] 空格显示答案：', afterSpace.includes('我的答案') ? '✓' : '✗')

  // 做完这一批 → 应出现完成态 → 「再做一遍这批」应把同一批带回来
  // （这是用户报的 bug：做完后显示 0 题且不让重做）
  for (let i = 0; i < 20; i++) {
    await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))`)
    await wait(110)
    await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true}))`)
    await wait(240)
  }
  await wait(700)
  const doneText = await bodyText()
  const sawDone = /全部完成|已全部完成|太棒了/.test(doneText)
  console.log('[review] 做完一批后出现完成态：', sawDone ? '✓' : '✗')

  const redoClicked = await js(
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('再做一遍')); if(b) b.click(); return !!b })()`
  )
  await wait(1600)
  const afterRedo = await bodyText()
  const qRedo = lastQuery ? JSON.stringify(lastQuery) : 'null'
  const hasIds = /"ids":\[/.test(qRedo)
  console.log('[review] 找到「再做一遍」按钮：', redoClicked ? '✓' : '✗')
  console.log('[review] 重做查询带 ids：', hasIds ? '✓' : '✗', qRedo.slice(0, 90))
  console.log('[review] 重做后回到第 1 题：', afterRedo.includes('第1题') ? '✓' : '✗')

  try {
    win.show(); win.focus(); win.moveTop()
    await wait(300)
    const shot = await Promise.race([
      win.webContents.capturePage(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('capturePage 超时')), 8000))
    ])
    fs.writeFileSync(path.join(ROOT, 'docs', 'images', 'review.png'), shot.toPNG())
    console.log('[review] 已更新 docs/images/review.png')
  } catch (e) {
    console.log('[review] 截图失败（不影响断言）:', e && e.message)
  }

  const pass =
    batch1.includes('第1题') &&
    clicked &&
    batch2.includes('第21题') &&
    batch1 !== batch2 &&
    afterSpace.includes('我的答案') &&
    wrapped &&
    sawDone &&
    redoClicked &&
    hasIds &&
    afterRedo.includes('第1题')
  console.log('[review] 结论:', pass ? 'PASS' : 'FAIL')
  app.exit(pass ? 0 : 2)
})
