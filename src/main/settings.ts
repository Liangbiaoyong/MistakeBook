import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '@shared/types'

const DEFAULTS: AppSettings = {
  hotkey: 'Alt+Shift+A',
  statsWindowDays: 30
}

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    const raw = fs.readFileSync(file(), 'utf8')
    cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  cache = next
  const tmp = `${file()}.tmp`
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(tmp, file())
  return next
}
