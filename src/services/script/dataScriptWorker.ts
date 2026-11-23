import { evaluateDataScript } from './dataScriptRuntime'

self.onmessage = async event => {
  try {
    const value = await evaluateDataScript(event.data.code, event.data.data)
    self.postMessage({ ok: true, value })
  } catch (cause) {
    self.postMessage({ ok: false, error: cause instanceof Error ? cause.message : String(cause) })
  }
}
