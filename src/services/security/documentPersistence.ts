/** 仅在当前值仍与提交基线一致时合并原生规范化或事务结果，
 * 保留提交后界面产生的新修改。 */
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
// 原生 serde 映射可能调整对象键顺序；直接比较序列化字符串
// 会导致已保存的文档被反复写入。
export const sameDocumentValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => sameDocumentValue(item, b[index]))
  if (!record(a) || !record(b)) return false
  const keys = Object.keys(a).filter(key => a[key] !== undefined)
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length && keys.every(key => Object.hasOwn(b, key) && sameDocumentValue(a[key], b[key]))
}
const keyed = (rows: unknown[]): rows is Array<Record<string, unknown> & { id: string | number }> => rows.every(row => record(row) && (typeof row.id === 'string' || typeof row.id === 'number')) && new Set(rows.map(row => (row as { id: unknown }).id)).size === rows.length

export function replaceDocument<T extends object>(target: T, next: T): void {
  for (const key of Object.keys(target)) if (!Object.hasOwn(next, key)) delete target[key as keyof T]
  Object.assign(target, next)
}

export function mergeDocument(current: unknown, base: unknown, saved: unknown): unknown {
  if (sameDocumentValue(current, base)) return copy(saved)
  if (record(current) && record(base) && record(saved)) {
    const result = { ...current }
    for (const key of new Set([...Object.keys(base), ...Object.keys(saved)])) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
      const value = mergeDocument(current[key], base[key], saved[key])
      if (value === undefined) delete result[key]
      else result[key] = value
    }
    return result
  }
  if (Array.isArray(current) && Array.isArray(base) && Array.isArray(saved) && keyed(current) && keyed(base) && keyed(saved)) {
    const before = new Map(base.map(row => [row.id, row]))
    const after = new Map(saved.map(row => [row.id, row]))
    const result: unknown[] = []
    for (const row of current) {
      const value = before.has(row.id) ? mergeDocument(row, before.get(row.id), after.get(row.id)) : row
      if (value !== undefined) result.push(value)
    }
    for (const row of saved) if (!before.has(row.id) && !current.some(item => item.id === row.id)) result.push(copy(row))
    return result
  }
  return copy(current)
}

/** 界面自动保存与显式修改共用写入队列；真正开始写入时才生成快照，
 * 避免排队期间的修改丢失，并允许后续操作在前一次失败后继续执行。 */
export function createDocumentPersistence<T extends object>(options: {
  ready: () => Promise<void>
  writable: () => boolean
  read: () => T
  apply: (value: T) => void
  write: (value: T) => Promise<T>
}) {
  let queue: Promise<unknown> = Promise.resolve()
  let persisted: T | undefined
  const exclusive = <R>(job: () => Promise<R>) => {
    const operation = queue.catch(() => undefined).then(job)
    queue = operation
    return operation
  }
  const enqueue = (mutate?: (draft: T) => void | Promise<void>) => {
    return exclusive(async () => {
      await options.ready()
      if (!options.writable()) throw new Error('安全存储尚未成功读取，已阻止覆盖')
      const base = copy(options.read())
      const draft = copy(base)
      await mutate?.(draft)
      let submitted = draft
      let previous = base
      // 写入期间产生的新修改也持久化后才返回成功；
      // 后续排队的自动保存会读到同一份已保存状态。
      for (;;) {
        if (sameDocumentValue(persisted, submitted) && !mutate) return copy(options.read())
        const saved = await options.write(submitted)
        options.apply(mergeDocument(options.read(), previous, saved) as T)
        persisted = copy(saved)
        const current = copy(options.read())
        if (sameDocumentValue(current, saved)) return current
        previous = current
        submitted = current
      }
    })
  }
  return { save: () => enqueue(), commit: (mutate: (draft: T) => void | Promise<void>) => enqueue(mutate), exclusive }
}
