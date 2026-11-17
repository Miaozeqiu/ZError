/** 站点认领开页 / 点文案。引擎只问钩子，不 import 任何站点。 */

export type NavigateGuard = (url: string) => string | null

export type ClickTextResult = {
  ok: boolean
  text?: string
  error?: string
  [key: string]: unknown
}

export type ClickTextHook = (
  id: string,
  text: string,
) => Promise<ClickTextResult | null> | ClickTextResult | null

let navigateGuard: NavigateGuard | null = null
let clickTextHook: ClickTextHook | null = null

export const registerNavigateGuard = (fn: NavigateGuard | null) => {
  navigateGuard = fn
}

export const registerClickText = (fn: ClickTextHook | null) => {
  clickTextHook = fn
}

export const guardNavigate = (url: string) => {
  const error = navigateGuard?.(url)
  return error ? String(error) : ''
}

export const claimClickText = async (id: string, text: string) => {
  if (!clickTextHook) return null
  return clickTextHook(id, String(text || '').trim())
}
