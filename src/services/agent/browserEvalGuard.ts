export type BrowserEvalPolicy = 'full' | 'read' | 'deny'

const NAV_RE = /location\.(href|replace|assign)\s*=|\.src\s*=\s*['"`]/
const FRAME_DOM_RE = /contentDocument|contentWindow/
const MUTATE_RE = /\.click\s*\(|\.play\s*\(|\.pause\s*\(|dispatchEvent\s*\(|__study_|HTMLElement\.prototype\.click|document\.write\s*\(/

export const inspectEvalScript = (script: string, policy: BrowserEvalPolicy): string | null => {
  const raw = String(script || '')
  if (!raw.trim()) return '缺少 script'
  if (raw.length > 20_000) return '脚本过长（上限 20000 字）'
  if (NAV_RE.test(raw)) {
    return '禁止用 eval 改 location 或 iframe.src。跳转用 browser_navigate / click；课表页签只用 click_text。'
  }
  if (FRAME_DOM_RE.test(raw)) {
    return '禁止 iframe.contentDocument / contentWindow。脚本已在每帧执行，直接写 document。'
  }
  if (policy === 'deny') {
    return '当前页禁止 eval。刷课用 browser_study_play / next，不要自己点播放器。'
  }
  if (policy === 'read' && MUTATE_RE.test(raw)) {
    return '当前页只允许只读 eval。要点击或播放请用 click_text / browser_study_play。'
  }
  return null
}
