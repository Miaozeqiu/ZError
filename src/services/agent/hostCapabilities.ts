/** 宿主能力按能力注册，不按站点假装学习通工具可用。 */

export type HostCapabilities = {
  watch: boolean
  tick: boolean
  capture: boolean
  captcha: boolean
  panel: boolean
  catalog: boolean
  login: boolean
}

export const emptyHostCapabilities = (): HostCapabilities => ({
  watch: true,
  tick: true,
  capture: false,
  captcha: false,
  panel: false,
  catalog: false,
  login: true,
})

/** 视频进度监控任何站都有。目录和面板只在学习通这种已经接过宿主的站上打开。 */
export const hostCapabilitiesFor = (url: string): HostCapabilities => {
  const caps = emptyHostCapabilities()
  let chaoxing = false
  try { const parsed = new URL(url); chaoxing = /^https?:$/.test(parsed.protocol) && (parsed.hostname === 'chaoxing.com' || parsed.hostname.endsWith('.chaoxing.com')) } catch { /* invalid URL */ }
  if (chaoxing) {
    caps.catalog = true
    caps.panel = true
    caps.captcha = true
    caps.capture = true
  }
  return caps
}

export const missingHostNeeds = (_url: string) => [] as string[]

export const executeToolNamesFor = (caps: HostCapabilities) => {
  const names: string[] = [
    'browser_select_tab',
    'browser_run_status',
    'browser_verify_operation',
    'browser_get_state',
    'browser_find',
    'browser_wait',
    'browser_click',
    'browser_set_checked',
    'browser_click_text',
    'browser_type',
    'browser_press',
    'browser_navigate',
    'browser_scroll',
    'browser_todo',
    'browser_course_plan',
    'browser_finish',
    'browser_watch',
  ]
  void caps
  return names
}
