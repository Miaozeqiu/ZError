import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export const secureStorageState = reactive({ error: '', requiresAuthorization: false, authorizing: false })
export const isNativeSecureStore = () => typeof window !== 'undefined'
  && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)
export const isSecretReference = (value: unknown): value is string => typeof value === 'string' && /^\{\{secret:[^{}]+\}\}$/.test(value)
const volatile = new Map<string, unknown>()
const queues = new Map<string, Promise<unknown>>()
const failures = new Map<string, unknown>()
const unread = new Set<string>()
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const refreshError = () => {
  secureStorageState.requiresAuthorization = [...failures.values()].some(error => String(error).includes('SECURE_STORAGE_AUTHORIZATION_REQUIRED'))
  const needsSigning = [...failures.values()].some(error => String(error).includes('SECURE_STORAGE_SIGNING_REQUIRED'))
  secureStorageState.error = needsSigning
    ? '开发程序签名需要更新，请通过开发启动命令重新启动软件。现有数据已保留。'
    : secureStorageState.requiresAuthorization
    ? '旧版安全存储的授权需要更新。点击恢复授权后重新加载；现有数据已保留。'
    : failures.size ? '安全存储暂不可用，修改尚未保存。请解锁系统凭据存储后重新加载。' : ''
}
const report = (error: unknown, name: string, preserveCause = false) => {
  if (!preserveCause || !failures.has(name)) failures.set(name, error)
  refreshError()
  return error instanceof Error ? error : new Error(secureStorageState.error)
}
export const readSecureDocument = async <T>(name: string, legacyKey?: string): Promise<T | null> => {
  let legacy: unknown = null
  try { const raw = legacyKey && localStorage.getItem(legacyKey); if (raw) legacy = JSON.parse(raw) } catch (error) { unread.add(name); throw report(error, name) }
  try {
    const value = isNativeSecureStore()
      ? await invoke<T | null>('secure_document_read', { name, legacy })
      : (volatile.has(name) ? clone(volatile.get(name)) : legacy) as T | null
    // Ordinary browser previews have session-only storage, never a plaintext fallback.
    if (!isNativeSecureStore() && value != null) volatile.set(name, clone(value))
    if (isNativeSecureStore() && legacyKey && legacy != null && value != null) localStorage.removeItem(legacyKey)
    unread.delete(name); failures.delete(name); refreshError()
    return value
  } catch (error) { unread.add(name); throw report(error, name) }
}
export const writeSecureDocument = <T>(name: string, value: T): Promise<T> => {
  const snapshot = clone(value)
  const pending = (queues.get(name) || Promise.resolve()).catch(() => undefined).then(async () => {
    try {
      if (unread.has(name)) throw new Error('原存储尚未成功读取，已阻止覆盖。请解锁后重新加载。')
      const saved = isNativeSecureStore()
        ? await invoke<T>('secure_document_write', { name, value: snapshot })
        : (volatile.set(name, snapshot), clone(snapshot))
      failures.delete(name); refreshError()
      return saved
    } catch (error) { throw report(error, name, unread.has(name)) }
  })
  queues.set(name, pending)
  return pending
}
export const redactNative = async <T>(value: T): Promise<T> => isNativeSecureStore()
  ? invoke<T>('secure_redact', { value: clone(value) }) : value

/** Only the explicit recovery button calls this; startup and Agent calls never do. */
export const authorizeSecureStorage = async () => {
  if (secureStorageState.authorizing) return false
  secureStorageState.authorizing = true
  try {
    await invoke('secure_storage_authorize')
    return true
  } catch (error) {
    // A cancelled migration must keep the unread-data guard and original records.
    report(error, 'authorization')
    return false
  } finally { secureStorageState.authorizing = false }
}

let cleaning: Promise<unknown> | undefined
export const cleanupLegacySecrets = () => {
  if (!isNativeSecureStore()) return Promise.resolve()
  if (!cleaning) cleaning = (async () => {
    const archives: Record<string, unknown> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      if (key.startsWith('zerror-site-accounts-')) archives[key] = localStorage.getItem(key)
    }
    if (Object.keys(archives).length) {
      await invoke('secure_archive_legacy', { values: archives })
      Object.keys(archives).forEach(key => localStorage.removeItem(key))
    }
    await invoke('secure_cleanup_legacy')
  })().then(() => { failures.delete('migration'); refreshError() }).catch(error => { cleaning = undefined; throw report(error, 'migration') })
  return cleaning
}
