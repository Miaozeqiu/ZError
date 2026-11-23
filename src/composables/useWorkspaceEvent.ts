import { onMounted, onUnmounted } from 'vue'
import { listenWorkspaceEvent } from '../services/ui/workspaceEvents'

export function useWorkspaceEvent(workspace: string, type: string, listener: EventListener) {
  let stop: (() => void) | undefined
  onMounted(() => { stop = listenWorkspaceEvent(workspace, type, listener) })
  onUnmounted(() => stop?.())
}
