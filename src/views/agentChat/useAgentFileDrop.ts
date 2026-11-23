import { computed, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { DragDropEvent } from '@tauri-apps/api/webview'
import { isTauriEnvironment } from '../../services/app/environmentDetector'
import { agentAttachmentKind } from '../../services/agent/attachmentFiles'

/** 原生文件路径交给共用附件入口；DOM 拖放仅作浏览器预览和图片的后备入口。 */
export function useAgentFileDrop(options: {
  target: Ref<HTMLElement | null>; enabled: () => boolean
  paths: (paths: string[]) => Promise<void>; files: (files: File[]) => Promise<void>
  error: (message: string) => void
}) {
  const hovering = ref(false)
  const paths = ref<string[]>([])
  const supported = computed(() => !paths.value.length || paths.value.some(path => agentAttachmentKind(path)))
  const message = computed(() => supported.value ? '松开即可添加' : '不支持此文件类型')
  let depth = 0, nativeReady = false, disposed = false
  let unlisten: (()=>void) | undefined
  const reset = () => { hovering.value = false; paths.value = []; depth = 0 }
  const inside = (position: {x:number;y:number}) => {
    if (!options.enabled() || !options.target.value) return false
    const rect = options.target.value.getBoundingClientRect()
    // Tauri 给物理像素，DOM 使用逻辑像素；覆盖 Retina 与 Windows 显示缩放。
    const scale = window.devicePixelRatio || 1
    const x = position.x / scale, y = position.y / scale
    return rect.width > 0 && rect.height > 0 && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
  }
  const nativeDrop = (event: DragDropEvent) => {
    if (disposed) return
    nativeReady = true
    if (event.type === 'leave') { reset(); return }
    if (event.type === 'drop') {
      const accepted = inside(event.position)
      reset()
      if (accepted) void options.paths(event.paths).catch(() => options.error('无法添加拖入的文件，请重新选择。'))
      return
    }
    if (event.type === 'enter') paths.value = event.paths
    hovering.value = inside(event.position)
  }
  const fileDrag = (event: DragEvent) => Boolean(event.dataTransfer && (
    Array.from(event.dataTransfer.types || []).includes('Files') || event.dataTransfer.files?.length
  ))
  const enter = (event: DragEvent) => {
    if (!options.enabled() || !fileDrag(event)) return
    event.preventDefault(); event.stopPropagation()
    depth++; hovering.value = true
  }
  const over = (event: DragEvent) => {
    if (!options.enabled() || !fileDrag(event)) return
    event.preventDefault(); event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = supported.value ? 'copy' : 'none'
    hovering.value = true
  }
  const leave = (event: DragEvent) => {
    if (!fileDrag(event) && !hovering.value) return
    event.preventDefault(); event.stopPropagation()
    depth = Math.max(0,depth-1)
    if (!depth) reset()
  }
  const drop = (event: DragEvent) => {
    if (!options.enabled() || !fileDrag(event)) return
    event.preventDefault(); event.stopPropagation()
    const files = Array.from(event.dataTransfer?.files || [])
    reset()
    // 桌面端只消费原生事件，避免同一次松手又被 DOM 事件添加一遍。
    if (!nativeReady && files.length) void options.files(files).catch(() => options.error('无法添加拖入的文件，请重新选择。'))
  }
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') reset() }
  watch(options.enabled, enabled => { if (!enabled) reset() })
  onMounted(async () => {
    window.addEventListener('keydown',escape)
    window.addEventListener('blur',reset)
    window.addEventListener('dragend',reset)
    if (!isTauriEnvironment()) return
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview')
      if (disposed) return
      const stop = await getCurrentWebview().onDragDropEvent(event => nativeDrop(event.payload))
      if (disposed) stop()
      else { unlisten = stop; nativeReady = true }
    } catch { if (!disposed) options.error('暂时无法启用文件拖放，请使用「文件/图片」添加。') }
  })
  onScopeDispose(() => {
    disposed = true; unlisten?.(); reset()
    window.removeEventListener('keydown',escape)
    window.removeEventListener('blur',reset)
    window.removeEventListener('dragend',reset)
  })
  return { hovering, message, supported, enter, over, leave, drop }
}
