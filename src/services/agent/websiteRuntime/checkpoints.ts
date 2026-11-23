import { readSecureDocument, writeSecureDocument, redactNative } from '../../security/secureStore'
import type { InstalledWebsiteTool } from './protocol'

export type WebsiteCheckpoint = {
  id: string; sessionId: string; browserId: string; name: string; installed: InstalledWebsiteTool
  input: Record<string, unknown>; state: Record<string, unknown>; updatedAt: number
}
type Document = { version: 1; entries: WebsiteCheckpoint[] }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
const stable = (value: unknown): string => JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row)
export const sameWorkflowInput = (one: unknown, two: unknown) => stable(one) === stable(two)

export function createWebsiteCheckpointStore(io: { read: () => Promise<Document | null>; write: (value: Document) => Promise<unknown> }) {
  let pending: Promise<unknown> = Promise.resolve()
  const read = async (): Promise<Document> => {
    const document = await io.read()
    if (!document) return { version: 1, entries: [] }
    if (document.version !== 1 || !Array.isArray(document.entries) || document.entries.length > 16
      || bytes(document) > 8 * 1024 * 1024) throw new Error('网站流程检查点格式无效，已保留原数据')
    const ids = new Set<string>()
    for (const entry of document.entries) {
      if (!entry || !['id', 'sessionId', 'browserId', 'name'].every(key => typeof entry[key as keyof WebsiteCheckpoint] === 'string')
        || !entry.installed || !entry.state || typeof entry.state !== 'object' || Array.isArray(entry.state)
        || !entry.input || typeof entry.input !== 'object' || Array.isArray(entry.input)
        || bytes(entry.state) > 8192 || bytes(entry.input) > 32768 || !Number.isFinite(entry.updatedAt)
        || ids.has(entry.id)) throw new Error('网站流程检查点内容无效，已保留原数据')
      ids.add(entry.id)
    }
    return document
  }
  const change = (update: (document: Document) => void) => {
    const next = pending.catch(() => undefined).then(async () => {
      const document = await read()
      update(document)
      if (document.entries.length > 16 || bytes(document) > 8 * 1024 * 1024) throw new Error('网站检查点存储已满，请先处理未完成流程')
      await io.write(document)
    })
    pending = next
    return next
  }
  return {
    list: async (sessionId: string) => { await pending.catch(() => undefined); return (await read()).entries.filter(entry => entry.sessionId === sessionId) },
    save: (entry: WebsiteCheckpoint) => change(document => {
      if (!entry.state || Array.isArray(entry.state) || typeof entry.state !== 'object'
        || bytes(entry.state) > 8192 || bytes(entry.input) > 32768) throw new Error('网站检查点状态或参数超过限制')
      const index = document.entries.findIndex(item => item.id === entry.id)
      if (index < 0) document.entries.push(entry)
      else document.entries[index] = entry
    }),
    remove: (sessionId: string, id: string) => change(document => { document.entries = document.entries.filter(entry => entry.sessionId !== sessionId || entry.id !== id) }),
    removeHost: (host: string) => change(document => { document.entries = document.entries.filter(entry => entry.installed.host !== host) }),
    removeSession: (sessionId: string) => change(document => { document.entries = document.entries.filter(entry => entry.sessionId !== sessionId) }),
  }
}

export const websiteCheckpoints = createWebsiteCheckpointStore({
  read: () => readSecureDocument<Document>('website_workflows'),
  write: async document => writeSecureDocument('website_workflows', await redactNative(document)),
})
