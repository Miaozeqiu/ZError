/** 注册应用使用的 Lucide 图标，供 Iconify 离线渲染。 */
import { addCollection } from '@iconify/vue/offline'
import type { IconifyJSON } from '@iconify/types'

declare const __AGENT_LUCIDE_ICONS__: IconifyJSON

addCollection(__AGENT_LUCIDE_ICONS__)

const id = (name: string) => `lucide:${name}`

export type AgentFeatureIcon = 'read' | 'click' | 'type' | 'play'

export const featureIconName = (kind: AgentFeatureIcon) => {
  if (kind === 'read') return id('globe')
  if (kind === 'click') return id('mouse-pointer-click')
  if (kind === 'type') return id('keyboard')
  return id('play')
}

export const activityIconName = (name: string) => {
  if (name === 'protect_credentials') return id('shield')
  if (name === 'set_website_icon') return id('globe')
  if (name === 'browser_set_checked') return id('list-checks')
  if (name === 'web_search') return id('search')
  if (name === 'browser_get_page' || name === 'browser_get_state') return id('eye')
  if (name === 'browser_navigate') return id('link')
  if (name === 'browser_reload') return id('refresh-cw')
  if (name === 'browser_go_back') return id('chevron-left')
  if (name === 'browser_go_forward') return id('chevron-right')
  if (name === 'browser_click' || name === 'browser_click_text' || name === 'browser_course_plan') {
    return id('mouse-pointer-click')
  }
  if (name === 'browser_type' || name === 'browser_press') return id('keyboard')
  if (name === 'browser_scroll') return id('arrow-up-down')
  if (name === 'browser_eval') return id('code-xml')
  if (name === 'browser_screenshot') return id('camera')
  if (name === 'browser_todo' || name === 'present_quiz') return id('list-checks')
  if (name === 'browser_task') return id('workflow')
  if (name === 'browser_site_graph') return id('share-2')
  if (name === 'browser_wait') return id('clock')
  if (name === 'browser_finish') return id('check')
  if (name === 'browser_captcha') return id('shield')
  if (name === 'browser_homework') return id('book-open')
  if (
    name.startsWith('browser_chaoxing')
    || name.startsWith('browser_study_')
  ) {
    return id('play')
  }
  return id('circle-dot')
}
