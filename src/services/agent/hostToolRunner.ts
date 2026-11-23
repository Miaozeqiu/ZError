import { takeToolImages } from '../model/toolImages'
import type { RunTextModelOptions } from '../model/runner'
import { validateToolCall } from './core/tools'
import { isWebsiteHostCommand } from './websiteRuntime/protocol'

const object = (raw: string) => { try { return JSON.parse(raw) || {} } catch { return {} } }

export function createHostToolRunner(
  options: Pick<RunTextModelOptions, 'tools' | 'liveTools' | 'executeTool' | 'onEvent' | 'onTurnTranscript'>,
  turnId: string,
) {
  let sequence = 0
  return async (name: string, args: Record<string, unknown>) => {
    const call = { id: `${turnId}-host-${++sequence}`, name, arguments: JSON.stringify(args) }
    const invalid = validateToolCall(await options.liveTools?.() ?? options.tools ?? [], call)
    if (invalid) return { ok: false, error: invalid }
    if (!options.executeTool) return { ok: false, error: '当前没有可执行的工具。' }
    // The executor still applies control, policy, durable action receipts and run audit.
    // Internal document/service data belongs to the package, not the model transcript or UI steps.
    if (isWebsiteHostCommand(name)) return object(await options.executeTool(call))
    options.onEvent?.({ type: 'tool_start', ...call })
    const result = await options.executeTool(call)
    const { text } = takeToolImages(result)
    options.onEvent?.({ type: 'tool_end', id: call.id, name, result: text })
    options.onTurnTranscript?.([
      { role: 'assistant', content: '', tool_calls: [{ id: call.id, type: 'function', function: { name, arguments: call.arguments } }] },
      { role: 'tool', tool_call_id: call.id, name, content: text },
    ])
    return object(result)
  }
}
