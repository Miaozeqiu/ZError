import { getQuickJS } from './quickjs'

/** 数据脚本只有输入值与标准 JavaScript，不暴露文件系统、网络、凭据或宿主执行接口。 */
export async function evaluateDataScript(code: string, data: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  if (!code.trim() || code.length > 64_000) throw new Error('脚本不能为空或超过 64000 字符')
  const quickjs = await getQuickJS()
  signal?.throwIfAborted()
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(32 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  const deadline = performance.now() + 1000
  runtime.setInterruptHandler(() => Boolean(signal?.aborted) || performance.now() > deadline)
  const context = runtime.newContext()
  try {
    // 输入作为 JSON 值传入，文档内的文本不会被拼成可执行代码。
    const source = `JSON.stringify((function(document){"use strict";\n${code}\n})(${JSON.stringify(data)}))`
    const result = context.evalCode(source, 'file-data-script.js')
    if (!('value' in result)) {
      let message = '脚本执行失败'
      try { message = String(context.dump(result.error)?.message || message) } finally { result.error.dispose() }
      signal?.throwIfAborted()
      throw new Error(`脚本执行失败或超时：${message}`)
    }
    try {
      const json = context.getString(result.value)
      if (json.length > 2_000_000) throw new Error('脚本输出超过 200 万字符，请缩小结果')
      try { return JSON.parse(json) } catch { throw new Error('脚本必须同步 return 可序列化的数据，不能只打印或返回 Promise') }
    } finally { result.value.dispose() }
  } finally { context.dispose(); runtime.dispose() }
}
