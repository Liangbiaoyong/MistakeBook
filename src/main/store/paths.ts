/**
 * 路径管理 —— vault 布局与 userData 下的辅助目录。
 */
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'

let cachedVaultDir: string | null = null

export function getUserDataDir(): string {
  return app.getPath('userData')
}

export function getIndexPath(): string {
  return join(getUserDataDir(), 'index.db')
}

export function getConfigPath(): string {
  return join(getUserDataDir(), 'config.json')
}

export function getKeysPath(): string {
  return join(getUserDataDir(), 'keys.bin')
}

export function getTempDir(): string {
  return join(getUserDataDir(), 'tmp')
}

export interface VaultStatus {
  dir: string
  configured: string
  exists: boolean
}

/**
 * 获取 vault 状态。
 * 如果配置了自定义路径但不存在，返回该路径（exists=false）
 * 这样调用方可以清楚地知道问题所在
 */
export function getVaultStatus(): VaultStatus {
  const defaultDir = join(app.getPath('documents'), 'MistakeBook')

  try {
    const configPath = getConfigPath()
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (config.vaultDir) {
        return {
          dir: config.vaultDir,
          configured: config.vaultDir,
          exists: existsSync(config.vaultDir)
        }
      }
    }
  } catch {
    // 忽略配置读取错误，使用默认值
  }

  return {
    dir: defaultDir,
    configured: '',
    exists: existsSync(defaultDir)
  }
}

export function getVaultDir(): string {
  if (cachedVaultDir) return cachedVaultDir

  const defaultDir = join(app.getPath('documents'), 'MistakeBook')

  try {
    const configPath = getConfigPath()
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (config.vaultDir) {
        cachedVaultDir = config.vaultDir
        return config.vaultDir
      }
    }
  } catch {
    // 忽略配置读取错误，使用默认值
  }

  cachedVaultDir = defaultDir
  return defaultDir
}

export function setVaultDir(dir: string): void {
  cachedVaultDir = dir

  const configPath = getConfigPath()

  let config: Record<string, unknown> = {}
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    }
  } catch {
    // 忽略，使用空配置
  }

  config.vaultDir = dir
  const tmpPath = configPath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
  renameSync(tmpPath, configPath)
}

export function mistakesDir(): string {
  return join(getVaultDir(), 'mistakes')
}

export function assetsDir(): string {
  return join(getVaultDir(), 'assets')
}

export function assetAbsPath(rel: string): string {
  return join(getVaultDir(), rel)
}

export function ensureDirs(): void {
  const vaultStatus = getVaultStatus()

  // 如果配置的路径存在，创建子目录
  if (vaultStatus.exists) {
    const dirs = [
      join(vaultStatus.dir, 'mistakes'),
      join(vaultStatus.dir, 'assets'),
      getTempDir()
    ]

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  // 始终创建 temp 目录
  if (!existsSync(getTempDir())) {
    mkdirSync(getTempDir(), { recursive: true })
  }
}
