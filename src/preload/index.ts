import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { Api, CapturePayload } from '@shared/ipc'

/** 自定义协议：把 vault 里的相对图片路径变成 <img src> 可用的 URL */
const ASSET_SCHEME = 'cuoti-asset'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api: Api = {
  captureStart: () => ipcRenderer.invoke(IPC.captureStart),
  onCaptured: (cb) => on<CapturePayload>(IPC.captureCaptured, cb),
  onOpenComposer: (cb) => on<void>(IPC.captureOpenComposer, () => cb()),
  onNotify: (cb) => on<string>(IPC.appNotify, cb),

  extract: (imageAbsPath) => ipcRenderer.invoke(IPC.extract, imageAbsPath),
  extractFromClipboard: () => ipcRenderer.invoke(IPC.extract, null),

  save: (input) => ipcRenderer.invoke(IPC.mistakeSave, input),
  list: (filter) => ipcRenderer.invoke(IPC.mistakeList, filter),
  get: (id) => ipcRenderer.invoke(IPC.mistakeGet, id),
  update: (id, patch) => ipcRenderer.invoke(IPC.mistakeUpdate, id, patch),
  remove: (id) => ipcRenderer.invoke(IPC.mistakeDelete, id),

  reviewQuery: (query) => ipcRenderer.invoke(IPC.reviewQuery, query),
  grade: (id, grade) => ipcRenderer.invoke(IPC.reviewGrade, id, grade),

  stats: () => ipcRenderer.invoke(IPC.statsOverview),
  errorPatterns: (filter) => ipcRenderer.invoke(IPC.analysisErrorPatterns, filter),
  variants: (id, n) => ipcRenderer.invoke(IPC.generateVariants, id, n),
  forecast: () => ipcRenderer.invoke(IPC.forecastTopics),

  configGet: () => ipcRenderer.invoke(IPC.configGet),
  configSetChoice: (feature, choice) => ipcRenderer.invoke(IPC.configSetChoice, feature, choice),
  configSetProviderKey: (providerId, apiKey) =>
    ipcRenderer.invoke(IPC.configSetProviderKey, providerId, apiKey),
  configRemoveProviderKey: (providerId) => ipcRenderer.invoke(IPC.configRemoveProviderKey, providerId),
  configUpsertProvider: (p) => ipcRenderer.invoke(IPC.configUpsertProvider, p),
  configTest: (choice) => ipcRenderer.invoke(IPC.configTest, choice),
  configListModels: (providerId) => ipcRenderer.invoke(IPC.configListModels, providerId),

  vaultGet: () => ipcRenderer.invoke(IPC.vaultGet),
  vaultChoose: () => ipcRenderer.invoke(IPC.vaultChoose),
  indexRebuild: () => ipcRenderer.invoke(IPC.indexRebuild),

  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),

  // 同步构造：仅拼字符串，无需往返主进程
  assetUrl: (rel) => `${ASSET_SCHEME}://local/${rel.split('/').map(encodeURIComponent).join('/')}`,

  notifySync: (tasks) => ipcRenderer.invoke(IPC.notifySync, tasks),
  onNotifyCommand: (cb) => on<{ taskId: string; action: string }>(IPC.notifyCommand, cb)
}

contextBridge.exposeInMainWorld('api', api)
