import { readSecureDocument, writeSecureDocument } from '../../security/secureStore'
type Entry = { owner: string; principal: string; key: string; json: string; at: number }
type State = { version: 1; entries: Entry[] }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
export function createPackageStateStore(io: { read: () => Promise<State | null>; write: (state: State) => Promise<unknown> }) {
  let queue: Promise<unknown> = Promise.resolve()
  const load = async () => {
    const value = await io.read()
    if (!value) return { version: 1 as const, entries: [] }
    if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 512 || bytes(value) > 8 * 1024 * 1024
      || value.entries.some(row => !row || ['owner', 'principal', 'key', 'json'].some(key => typeof row[key as keyof Entry] !== 'string') || !Number.isFinite(row.at))) throw new Error('网站数据缓存不可读取，未覆盖原数据')
    return value
  }
  const change = (update: (state: State) => void) => {
    const next = queue.catch(() => undefined).then(async () => {
      const state = await load(); state.entries = state.entries.filter(row => Date.now() - row.at < 7 * 86400000)
      update(state)
      while (state.entries.length > 512 || bytes(state) > 8 * 1024 * 1024) state.entries.shift()
      await io.write(state)
    }); queue = next; return next
  }
  return {
    read: async (owner: string, principal: string, key: string) => { await queue.catch(() => undefined); return (await load()).entries.find(row => row.owner === owner && row.principal === principal && row.key === key && Date.now() - row.at < 7 * 86400000)?.json ?? null },
    readMany: async (owner: string, principal: string, keys: string[]) => {
      await queue.catch(() => undefined)
      const rows = new Map((await load()).entries.filter(row => row.owner === owner && row.principal === principal && Date.now() - row.at < 7 * 86400000).map(row => [row.key, row.json]))
      return keys.map(key => rows.get(key) ?? null)
    },
    write: (owner: string, principal: string, key: string, json: string | null) => change(state => {
      state.entries = state.entries.filter(row => !(row.owner === owner && row.principal === principal && row.key === key))
      if (json !== null) state.entries.push({ owner, principal, key, json, at: Date.now() })
    }),
    removeOwner: (owner: string) => change(state => { state.entries = state.entries.filter(row => !row.owner.startsWith(owner + '\n')) }),
  }
}
export const packageState = createPackageStateStore({ read: () => readSecureDocument<State>('website_package_state'), write: value => writeSecureDocument('website_package_state', value) })
