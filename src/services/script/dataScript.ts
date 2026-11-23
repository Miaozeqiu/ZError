/** 浏览器中使用独立 Worker，避免大正则或恶意脚本阻塞界面；停止时直接销毁执行环境。 */
export async function runDataScript(code: string, data: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') {
    const { evaluateDataScript } = await import('./dataScriptRuntime')
    return evaluateDataScript(code, data, signal)
  }
  return new Promise((resolve, reject) => {
    // 开发服务器直接提供 ES 模块；安装包输出单个经典脚本，兼容旧版 WKWebView。
    // 两个构造调用保留静态选项，供 Vite 正确分析并打包 Worker。
    const worker = import.meta.env.DEV
      ? new Worker(new URL('./dataScriptWorker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('./dataScriptWorker.ts', import.meta.url))
    let settled = false
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () => finish(new DOMException('脚本已停止', 'AbortError'))
    // 包括 WASM 加载的硬超时；运行时另有 1 秒 CPU 中断和内存限制。
    const timer = setTimeout(() => finish(new Error('脚本执行或初始化超时，请缩小输入或简化脚本')), 5000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = event => event.data.ok ? finish(undefined, event.data.value) : finish(new Error(event.data.error || '脚本执行失败'))
    worker.onerror = () => finish(new Error('数据脚本执行环境加载失败'))
    if (signal?.aborted) { abort(); return }
    try { worker.postMessage({ code, data }) } catch (cause) { finish(cause instanceof Error ? cause : new Error(String(cause))) }
  })
}
