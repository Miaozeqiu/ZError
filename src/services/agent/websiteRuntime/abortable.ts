/** Release the invocation's sandbox even while native I/O is still pending.
 * Dispatched native effects still belong to the host operation log.
 */
export function websiteHostAwait<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    let settled = false
    const finish = (error: boolean, value: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (error) reject(value)
      else resolve(value as T)
    }
    const abort = () => finish(true, signal.reason ?? new DOMException('已停止', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    void Promise.resolve().then(() => {
      signal.throwIfAborted()
      return work()
    }).then(value => finish(false, value), error => finish(true, error))
  })
}
