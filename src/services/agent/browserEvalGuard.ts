export type BrowserEvalPolicy = 'full' | 'read' | 'deny'

const NAV_RE = /location\.(href|replace|assign)\s*=|\.src\s*=\s*['"`]/
const FRAME_DOM_RE = /contentDocument|contentWindow/
const MUTATE_RE = /\.click\s*\(|\.play\s*\(|\.pause\s*\(|dispatchEvent\s*\(|__study_|HTMLElement\.prototype\.click|document\.write\s*\(/

export const inspectEvalScript = (script: string, policy: BrowserEvalPolicy): string | null => {
  const raw = String(script || '')
  if (!raw.trim()) return '缺少 script'
  if (raw.length > 20_000) return '脚本过长（上限 20000 字）'
  if (NAV_RE.test(raw)) {
    return '跳转用 browser_navigate / click；课表页签用 click_text。eval 不要改 location 或 iframe.src。'
  }
  if (FRAME_DOM_RE.test(raw)) {
    return '指定框用 frame 参数；默认只跑顶层。eval 不要碰 iframe.contentDocument / contentWindow。'
  }
  if (policy === 'deny') {
    return '当前是播放页。当前看得见的视频只是其中一条。用快照里那一条的 ref 点页签再播放。'
  }
  if (policy === 'read' && MUTATE_RE.test(raw)) {
    return '当前页 eval 只读。要点击或播放请用 click_text / browser_click。'
  }
  return null
}
