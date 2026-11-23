import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** 生命周期跟随应用，Agent 工作区卸载后仍继续提供服务。 */
export async function startCliRuntime(): Promise<() => void> {
  let disposed = false
  let generation = ''
  const queued = new Set<string>()
  const active = new Set<string>()
  const handle = async (id: string) => {
    if (disposed || active.has(id)) return
    if (!generation) { queued.add(id); return }
    active.add(id)
    try {
      const request = await invoke<{ method: string; params: Record<string, unknown> } | null>('cli_take', { id, generation })
      if (!request || disposed) return
      let result: unknown
      try {
        const { dispatchCli } = await import('./commands')
        result = { ok: true, result: await dispatchCli(request.method, request.params, async () => {
          if (disposed || !await invoke<boolean>('cli_request_active', { id, generation })) throw new Error('CLI 请求已过期或界面已重载，未开始新的操作')
        }) }
      } catch (error) {
        const { redactNative } = await import('../security/secureStore')
        result = { ok: false, code: 'operation_failed', error: await redactNative(error instanceof Error ? error.message : String(error)).catch(() => '安全存储未解锁，无法安全返回错误详情') }
      }
      if (!disposed) await invoke('cli_complete', { id, generation, result })
    } finally { active.delete(id) }
  }
  const unlisten = await listen<{ id: string }>('cli-request', ({ payload }) => {
    void handle(payload.id).catch(() => undefined)
  })
  try {
    const connection = await invoke<{ generation: string }>('cli_connect')
    generation = connection.generation
    for (const id of queued) void handle(id).catch(() => undefined)
    queued.clear()
  } catch (error) { unlisten(); throw error }
  return () => { disposed = true; unlisten(); queued.clear() }
}
