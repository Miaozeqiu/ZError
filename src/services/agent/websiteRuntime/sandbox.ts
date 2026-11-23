import { getQuickJS } from '../../script/quickjs'

export async function withWebsiteSandbox<T>(work: (evaluate: (source: string, initialize?: boolean) => unknown) => T | Promise<T>): Promise<T> {
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  try {
    runtime.setMemoryLimit(8 * 1024 * 1024)
    runtime.setMaxStackSize(256 * 1024)
    let deadline = 0
    runtime.setInterruptHandler(() => performance.now() > deadline)
    const context = runtime.newContext()
    let initialized = false
    const evaluate = (source: string, initialize = false) => {
      // Parsing a bounded bundle includes library tables. Each subsequent step keeps the tighter limit.
      const budget = initialize && !initialized ? 500 : 100
      initialized = true
      deadline = performance.now() + budget
      const result = context.evalCode(source, 'website-adapter.js', { type: 'global' })
      if (!('value' in result)) { result.error.dispose(); throw new Error('网站脚本执行失败或超时。') }
      try { return JSON.parse(context.getString(result.value)) } finally { result.value.dispose() }
    }
    try { return await work(evaluate) } finally { context.dispose() }
  } finally { runtime.dispose() }
}
