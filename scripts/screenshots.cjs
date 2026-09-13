/**
 * 为 README 生成截图。桩掉 IPC 喂示例数据，逐页 capturePage。
 *
 * 用法（SHOT 指向一张当作「抓取的截图」的图片，建议用一页真实资料）：
 *   SHOT=/path/to/page.png npx electron scripts/screenshots.cjs
 * 产物写到 docs/images/。
 */

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'images')
const SHOT_IMG = process.env.SHOT
const ok = (data) => ({ ok: true, data })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

protocol.registerSchemesAsPrivileged([
  { scheme: 'cuoti-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

/* ── 真实感的示例数据 ── */

const mk = (id, subject, chapter, points, type, errorType, status, level, head, answer, right, conf) => ({
  id, created: '2026-09-13T14:23:21+08:00', subject, chapter, points, type, errorType, status,
  level, confidence: conf, review: { round: 2, last: '2026-09-12', next: '2026-09-15' },
  questionHead: head, imagePath: 'assets/sample.png',
  myAnswer: answer, rightAnswer: right
})

const LIST = [
  mk('2026-09-13-a3f29c', '408', ['数据结构', '树'], ['树的度', '叶结点数'], '单选', '概念混淆', 'reviewing', 3,
    '设一棵 $m$ 叉树中有 $N_1$ 个度数为 1 的结点，$N_2$ 个度数为 2 的结点…', 'C', 'B', 0.94),
  mk('2026-09-12-7b41e0', '408', ['计算机组成原理', '存储系统'], ['Cache 映射'], '单选', '计算失误', 'new', 4,
    '某 Cache 采用 4 路组相联映射，主存块大小 64B，Cache 容量 16KB，则组数为（ ）。', 'B', 'D', 0.88),
  mk('2026-09-11-2c9d15', '408', ['计算机网络', '传输层'], ['TCP 拥塞控制', '慢开始'], '计算', '方法不会', 'new', 5,
    '发送方拥塞窗口初值为 1 MSS，慢开始门限为 8 MSS，经过 5 个 RTT 后拥塞窗口为多少？', '16', '20', 0.71),
  mk('2026-09-10-5e8a73', '数学二', ['高等数学', '定积分'], ['换元积分', '奇偶性'], '计算', '审题错误', 'reviewing', 3,
    '计算 $\\int_{-1}^{1} \\left( x^2 + \\sqrt{1-x^2} \\right)^2 dx$。', '$\\frac{23}{15}$', '$\\frac{22}{15}$', 0.83),
  mk('2026-09-09-9f0b62', '408', ['操作系统', '进程管理'], ['死锁', '银行家算法'], '单选', '记忆遗忘', 'mastered', 2,
    '系统中有 5 个进程共享 3 类资源，若每个进程最多申请 2 个同类资源，系统是否可能死锁？', 'B', 'B', 0.96),
  mk('2026-09-08-1d7c44', '408', ['数据结构', '图'], ['最短路径', 'Dijkstra'], '简答', '方法不会', 'new', 4,
    '说明 Dijkstra 算法为何不能处理含负权边的图，并给出一个反例。', '略', '略', 0.63)
]

const FULL = {
  ...LIST[0],
  source: '王道《数据结构》p.42 第 08 题',
  llm: { model: 'claude-sonnet-4-6', at: '2026-09-13T14:23:30+08:00' },
  body: {
    question: '设一棵 $m$ 叉树中有 $N_1$ 个度数为 1 的结点，$N_2$ 个度数为 2 的结点……$N_m$ 个度数为 $m$ 的结点，则该树中共有（　）个叶结点。\n\nA. $\\sum_{i=1}^{m}(i-1)N_i$　　B. $\\sum_{i=1}^{m} N_i$　　C. $\\sum_{i=2}^{m}(i-1)N_i$　　D. $\\sum_{i=2}^{m}(i-1)N_i + 1$',
    myThought: '直接用 $N_0 + N_1 + N_2 = n$ 列式，忽略了结点数与边数之间那个不变量。',
    solution: '设结点总数 $n=\\sum_{i=0}^{m}N_i$，边数 $n-1=\\sum_{i=1}^{m} i\\,N_i$。代入消去 $n$ 得\n\n$$N_0 = 1+\\sum_{i=2}^{m}(i-1)N_i$$\n\n故选 D。',
    cause: '把「结点数」和「边数」两个不变量混用了——树里 $n$ 个结点只有 $n-1$ 条边，这一步是破题点。',
    variant: '若把问题换成「求分支结点总数」，结论会怎么变？'
  }
}

const STATS = {
  total: 6,
  bySubject: [{ key: '408', count: 5 }, { key: '数学二', count: 1 }],
  byErrorType: [{ key: '方法不会', count: 2 }, { key: '概念混淆', count: 1 }, { key: '计算失误', count: 1 }, { key: '审题错误', count: 1 }, { key: '记忆遗忘', count: 1 }],
  byPoint: [{ key: '树的度', count: 1 }, { key: 'Cache 映射', count: 1 }, { key: 'TCP 拥塞控制', count: 1 }, { key: '定积分', count: 1 }, { key: '死锁', count: 1 }, { key: '最短路径', count: 1 }],
  byChapter: [{ key: '数据结构', count: 2 }, { key: '组成原理', count: 1 }, { key: '计算机网络', count: 1 }, { key: '操作系统', count: 1 }, { key: '高等数学', count: 1 }],
  byStatus: [{ key: 'new', count: 3 }, { key: 'reviewing', count: 2 }, { key: 'mastered', count: 1 }],
  daily: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    count: [2, 1, 3, 0, 4, 2, 1, 5, 3, 0, 2, 4, 1, 3][i]
  })),
  dueCount: 3
}

const EXTRACTION = {
  subject: '408', chapter: ['数据结构', '树'], points: ['树的度', '叶结点数'], type: '单选', level: 3,
  myAnswer: 'C', rightAnswer: 'B', errorType: '概念混淆', confidence: 0.94,
  source: '王道《数据结构》p.42 第 08 题',
  body: {
    question: FULL.body.question,
    myThought: FULL.body.myThought,
    solution: FULL.body.solution,
    cause: FULL.body.cause,
    variant: ''
  }
}

/* ── IPC 桩 ── */

ipcMain.handle('config:get', () => ok({
  providers: [
    { id: 'opencode-go', label: 'OpenCode Go（本地网关 · Anthropic 协议）', baseUrl: 'http://127.0.0.1:15721', format: 'anthropic', headers: { 'x-opencode-session': 'x' } },
    { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
    { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
    { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' }
  ],
  keysSet: { 'opencode-go': true },
  default: { provider: 'opencode-go', model: 'claude-sonnet-4-6', vision: true },
  features: {
    capture: { provider: 'opencode-go', model: 'claude-sonnet-4-6', vision: true },
    analyze: { provider: 'opencode-go', model: 'claude-sonnet-4-6' },
    generate: { provider: 'opencode-go', model: 'claude-sonnet-4-6' },
    forecast: { provider: 'opencode-go', model: 'claude-sonnet-4-6' }
  }
}))
ipcMain.handle('vault:get', () => ok('D:/Documents/MistakeBook'))
ipcMain.handle('settings:get', () => ok({ hotkey: 'Alt+Shift+A', statsWindowDays: 30, examDate: '2026-12-26' }))
ipcMain.handle('mistake:list', () => ok(LIST))
ipcMain.handle('mistake:get', () => ok(FULL))
ipcMain.handle('review:due', () => ok(LIST.slice(0, 3)))
ipcMain.handle('stats:overview', () => ok(STATS))
ipcMain.handle('config:listModels', () => ok([]))
let extractMode = 'slow'
ipcMain.handle('llm:extract', async () => {
  if (extractMode === 'hang') return new Promise(() => {})
  await wait(400)
  return ok(EXTRACTION)
})

/* ── 截图 ── */

setTimeout(() => { console.log('[shots] 兜底退出'); app.exit(9) }, 120000)

app.whenReady().then(async () => {
  protocol.handle('cuoti-asset', async () => {
    const buf = fs.readFileSync(SHOT_IMG)
    return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png' } })
  })
  fs.mkdirSync(OUT, { recursive: true })

  const win = new BrowserWindow({
    width: 1320, height: 880, show: true, backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(ROOT, 'out', 'preload', 'index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  await win.loadFile(path.join(ROOT, 'out', 'renderer', 'index.html'))
  await wait(1500)

  const click = (label) => win.webContents.executeJavaScript(
    `(() => { const b=[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes(${JSON.stringify(label)})); if(b) b.click(); return !!b })()`
  )
  const shoot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, name), img.toPNG())
    console.log(`[shots] 已保存 ${name}`)
  }

  // 1. 书库
  await wait(700)
  await shoot('library.png')

  // 2. 复习
  await click('复习'); await wait(900); await shoot('review.png')

  // 3. 统计
  await click('统计'); await wait(1400); await shoot('stats.png')

  // 4. 设置
  await click('设置'); await wait(1200); await shoot('settings.png')

  // 5. 录入窗（识别完成后）
  await click('书库'); await wait(500)
  extractMode = 'fast'
  const b64 = fs.readFileSync(SHOT_IMG).toString('base64')
  const payload = { imageAbsPath: SHOT_IMG, thumbDataUrl: `data:image/png;base64,${b64}` }
  win.webContents.send('capture:captured', payload)
  await wait(2400)
  await shoot('composer-filled.png')

  // 6. 录入窗（识别进行中 —— 最后拍，因为它会一直停在这个状态）
  await win.webContents.executeJavaScript(
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='取消'); if(b) b.click(); return !!b })()`
  )
  await wait(500)
  extractMode = 'hang'
  win.webContents.send('capture:captured', payload)
  await wait(1600)
  await shoot('composer-loading.png')

  console.log('[shots] 完成')
  app.exit(0)
})
