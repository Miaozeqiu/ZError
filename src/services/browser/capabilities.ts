import { invoke } from '@tauri-apps/api/core'

export type BrowserCapabilities = {
  secureFill: boolean
  secureFillInFrames: boolean
  audioMute: boolean
  snapshotViaScript: boolean
  pageScriptActions: boolean
}

let cached: BrowserCapabilities | undefined

// The backend decides which operations its current platform and engine implement.
export const browserCapabilities = async (): Promise<BrowserCapabilities> => {
  if (cached) return cached
  const raw = await invoke<Partial<BrowserCapabilities>>('browser_capabilities').catch(() => null)
  const capabilities = {
    secureFill: raw?.secureFill === true,
    secureFillInFrames: raw?.secureFillInFrames === true,
    audioMute: raw?.audioMute === true,
    snapshotViaScript: raw?.snapshotViaScript === true,
    pageScriptActions: raw?.pageScriptActions === true,
  }
  if (raw) cached = capabilities
  return capabilities
}
