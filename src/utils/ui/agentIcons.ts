/** Agent 活动 / 快捷卡片图标：只用 lucide 子集，离线挂进 Iconify。 */
import { addCollection } from '@iconify/vue/offline'
import type { IconifyJSON } from '@iconify/types'
import lucide from '@iconify-json/lucide/icons.json'

const NEEDED = [
  'globe',
  'monitor',
  'maximize-2',
  'minimize-2',
  'x',
  'plus',
  'search',
  'eye',
  'eye-off',
  'volume-2',
  'volume-x',
  'link',
  'refresh-cw',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'mouse-pointer-click',
  'square-mouse-pointer',
  'keyboard',
  'arrow-up-down',
  'code-2',
  'camera',
  'list-checks',
  'workflow',
  'share-2',
  'clock',
  'check',
  'play',
  'book-open',
  'shield',
  'circle-dot',
  'circle-check',
  'circle-minus',
  'circle',
] as const

const icons: IconifyJSON['icons'] = {}
for (const name of NEEDED) {
  const data = (lucide as IconifyJSON).icons[name]
  if (data) icons[name] = data
}

addCollection({
  prefix: 'lucide',
  icons,
  width: (lucide as IconifyJSON).width || 24,
  height: (lucide as IconifyJSON).height || 24,
})

const id = (name: (typeof NEEDED)[number]) => `lucide:${name}`

export type AgentFeatureIcon = 'read' | 'click' | 'type' | 'play'

export const featureIconName = (kind: AgentFeatureIcon) => {
  if (kind === 'read') return id('globe')
  if (kind === 'click') return id('mouse-pointer-click')
  if (kind === 'type') return id('keyboard')
  return id('play')
}

export const activityIconName = (name: string) => {
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
  if (name === 'browser_eval') return id('code-2')
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
