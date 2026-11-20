/** Buffer UI commands until their workspace first mounts; never own background tasks. */
const routes: Record<string, string[]> = {
  'open-model-settings': ['settings'],
  'open-ocs-config': ['home'],
  'prefill-agent-composer': ['agent'],
  'open-study-graph': ['study', 'agent'],
}
const listeners = new Map<string, Set<EventListener>>()
const pending = new Map<string, Event>()
const keyOf = (workspace: string, type: string) => `${workspace}:${type}`

export function installWorkspaceEventBuffer() {
  const capture = (event: Event) => {
    for (const workspace of routes[event.type] || []) {
      const key = keyOf(workspace, event.type)
      if (!listeners.get(key)?.size) pending.set(key, event)
    }
  }
  for (const type of Object.keys(routes)) window.addEventListener(type, capture, true)
  return () => {
    for (const type of Object.keys(routes)) window.removeEventListener(type, capture, true)
    pending.clear()
  }
}

export function listenWorkspaceEvent(workspace: string, type: string, listener: EventListener) {
  const key = keyOf(workspace, type)
  let group = listeners.get(key)
  if (!group) { group = new Set(); listeners.set(key, group) }
  group.add(listener)
  window.addEventListener(type, listener)
  const event = pending.get(key)
  if (event) { pending.delete(key); listener(event) }
  return () => {
    window.removeEventListener(type, listener)
    group?.delete(listener)
    if (!group?.size) listeners.delete(key)
  }
}
