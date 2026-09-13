/**
 * 桌面通知窗的回归检查：加载构建产物、喂四种任务状态、断言都渲染出来，
 * 并把结果叠在一张白底 PDF 页面上输出成 README 用的截图。
 *
 * 用法：PAGE_IMG=/path/to/page.png npx electron scripts/notify-check.cjs
 * 断言里专门盯了「知识点」—— 之前踩过 notify.html 读错字段名（knowledgePoints vs points），
 * 结果通知里那一段永远是空的。
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path'); const fs = require('fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const DISPLAY = process.env.DISPLAY_AS || 'x'

setTimeout(() => { console.log('[notify] 兜底退出'); app.exit(9) }, 40000)

app.whenReady().then(async () => {
  const dir = path.join(__dirname, '..', 'out', 'main', 'chunks')
  const file = fs.readdirSync(dir).find((f) => f.startsWith('notify-') && f.endsWith('.html'))
  if (!file) { console.log('[notify] 产物里没有 notify html'); return app.exit(1) }
  console.log('[notify] 加载', file)

  const win = new BrowserWindow({
    width: 360, height: 170, show: true, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
  })
  // 验证自动调整高度：内容报多高，窗口就该多高（否则第二张卡会被裁掉）
  let resized = 0
  ipcMain.on('notify:resize', (_e, h) => {
    resized = Number(h) || 0
    if (win && !win.isDestroyed()) {
      const b = win.getBounds()
      win.setBounds({ ...b, height: resized })
    }
  })

  await win.loadFile(path.join(dir, file))
  await wait(800)

  win.webContents.send('notify:state', [
    { id: 't1', status: 'recognizing', payload: { imageAbsPath: 'x' } },
    {
      id: 't2', status: 'ready', remaining: 28,
      extraction: { subject: '408', points: ['树的度', '叶结点数'], chapter: ['数据结构', '树'] },
      payload: { imageAbsPath: 'x' }
    },
    { id: 't3', status: 'saved', extraction: { subject: '数学二', points: ['定积分'] } },
    { id: 't4', status: 'error', error: '接口返回 401：API Key 无效' }
  ])
  await wait(1200)

  const text = await win.webContents.executeJavaScript('document.body.innerText')
  const flat = text.replace(/\s+/g, ' ')
  console.log('[notify] 渲染文本:', flat.slice(0, 200))

  const checks = [
    ['识别中', flat.includes('正在识别')],
    ['知识点（字段名修复）', flat.includes('树的度')],
    ['倒计时', /\d+\s*秒后自动保存/.test(flat)],
    ['已保存', flat.includes('已保存')],
    ['错误信息', flat.includes('401')]
  ]
  for (const [name, pass] of checks) console.log(`[notify] ${pass ? '✓' : '✗'} ${name}`)

  const allPass = checks.every(([, p]) => p)
  console.log('[notify] 断言结论:', allPass ? 'PASS' : 'FAIL')

  // 出一张能代表实际观感的图：只留两条任务，并把通知叠在一张白底 PDF 页面上
  // —— 顺便证明「白底也可读」不是空话。
  win.webContents.send('notify:state', [
    { id: 't1', status: 'recognizing', payload: { imageAbsPath: 'x' } },
    {
      id: 't2', status: 'ready', remaining: 24,
      extraction: { subject: '408', points: ['树的度'], chapter: ['数据结构', '树'] },
      payload: { imageAbsPath: 'x' }
    }
  ])
  const bg = (process.env.PAGE_IMG || '').replace(/\\/g, '/')
  await win.webContents.executeJavaScript(`(() => {
    document.body.style.backgroundImage = 'url("file:///${bg}")'
    document.body.style.backgroundSize = 'cover'
    document.body.style.backgroundPosition = 'top center'
    document.body.style.padding = '14px'
    return true
  })()`)
  await wait(1200)

  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'images', 'desktop-notify.png'), img.toPNG())
  console.log('[notify] 已保存 docs/images/desktop-notify.png')

  app.exit(allPass ? 0 : 2)
})
