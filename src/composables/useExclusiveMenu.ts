import { onScopeDispose, ref, watch, type Ref, type WatchSource } from 'vue'

const activeMenuId = ref<string | null>(null)
let seq = 0

export function createExclusiveMenuId(prefix = 'menu'): string {
  seq += 1
  return `${prefix}-${seq}`
}

export function claimExclusiveMenu(id: string) {
  activeMenuId.value = id
}

export function releaseExclusiveMenu(id: string) {
  if (activeMenuId.value === id) {
    activeMenuId.value = null
  }
}

export function closeAllExclusiveMenus() {
  activeMenuId.value = null
}

/** Bind a local boolean: open claims exclusivity; other menus auto-close it */
export function useExclusiveMenu(id: string, open: Ref<boolean>) {
  watch(
    open,
    (isOpen) => {
      if (isOpen) claimExclusiveMenu(id)
      else releaseExclusiveMenu(id)
    },
    { flush: 'sync' }
  )

  watch(
    activeMenuId,
    (current) => {
      if (current !== id && open.value) {
        open.value = false
      }
    },
    { flush: 'sync' }
  )

  onScopeDispose(() => releaseExclusiveMenu(id))
}

/** For components that only receive a visible prop: call onClose when displaced */
export function useExclusiveMenuProp(
  id: string,
  visible: WatchSource<boolean>,
  onClose: () => void
) {
  const readVisible = () => {
    return typeof visible === 'function'
      ? !!(visible as () => boolean)()
      : !!(visible as { value: boolean }).value
  }

  watch(
    visible,
    (isOpen) => {
      if (isOpen) claimExclusiveMenu(id)
      else releaseExclusiveMenu(id)
    },
    { immediate: true, flush: 'sync' }
  )

  watch(
    activeMenuId,
    (current) => {
      if (current !== id && readVisible()) {
        onClose()
      }
    },
    { flush: 'sync' }
  )

  onScopeDispose(() => releaseExclusiveMenu(id))
}