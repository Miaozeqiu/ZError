/** 是否在 Tauri 里。浏览器预览走 mock。 */
export const detectTauri = () => {
  if (typeof window === 'undefined') return false
  const hasTauri = Boolean((window as any).__TAURI__)
  const hasTauriInternals = Boolean((window as any).__TAURI_INTERNALS__)
  const isTauriApp = window.location.protocol === 'tauri:'
  return hasTauri || hasTauriInternals || isTauriApp
}

const cached = detectTauri()
export const isTauri = () => cached
