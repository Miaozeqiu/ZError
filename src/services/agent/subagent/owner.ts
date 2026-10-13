/** 同一 browserId 同时只有一个拥有者。watch 叫醒不抢锁。 */

const owners = new Map<string, string>()
const childAborts = new Map<string, Set<AbortController>>()

const idOf = (value: string) => String(value || '').trim()

export const acquireBrowser = (browserId: string, jobId: string) => {
  const id = idOf(browserId)
  const job = idOf(jobId)
  if (!id || !job) return { ok: false as const, error: '缺少 browserId 或 jobId' }
  const current = owners.get(id)
  if (current && current !== job) {
    return { ok: false as const, error: `浏览器已被 ${current} 占用`, owner: current }
  }
  owners.set(id, job)
  return { ok: true as const }
}

export const releaseBrowser = (browserId: string, jobId: string) => {
  const id = idOf(browserId)
  if (owners.get(id) === jobId) owners.delete(id)
}

export const browserOwnerOf = (browserId: string) => owners.get(idOf(browserId)) || null

export const clearBrowserOwners = () => {
  owners.clear()
}

export const registerChildAbort = (parentId: string, abort: AbortController) => {
  const key = idOf(parentId)
  if (!key) return
  const set = childAborts.get(key) || new Set<AbortController>()
  set.add(abort)
  childAborts.set(key, set)
  abort.signal.addEventListener('abort', () => {
    set.delete(abort)
    if (!set.size) childAborts.delete(key)
  }, { once: true })
}

export const abortChildrenOf = (parentId: string) => {
  const set = childAborts.get(idOf(parentId))
  if (!set) return
  for (const abort of set) {
    if (!abort.signal.aborted) abort.abort()
  }
  childAborts.delete(idOf(parentId))
}
