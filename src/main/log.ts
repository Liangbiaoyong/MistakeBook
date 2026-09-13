import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let logPath: string | null = null

/** Resolve the log file path lazily on first use */
function resolveLogPath(): string {
  if (!logPath) {
    logPath = path.join(app.getPath('userData'), 'mistakebook.log')
  }
  return logPath
}

/** Append a line to the log file. Never throws. */
export function logLine(tag: string, msg: string): void {
  try {
    const filePath = resolveLogPath()
    const now = new Date()
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`
    const line = `${ts} [${tag}] ${msg}\n`

    // Rotate if file exceeds ~1 MB
    try {
      const stat = fs.statSync(filePath)
      if (stat.size > 1024 * 1024) {
        const rotated = filePath + '.1'
        fs.copyFileSync(filePath, rotated)
        fs.writeFileSync(filePath, '')
      }
    } catch {
      // File doesn't exist yet — that's fine
    }

    fs.appendFileSync(filePath, line, 'utf-8')

    // Mirror to console for development
    console.log(`[${tag}] ${msg}`)
  } catch {
    // Logging must never break the app
  }
}
