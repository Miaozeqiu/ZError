type Rows = {
  row: string; target: string; name: string; number: string; task: string; hiddenCount: string; badge: string; completed: string
}
export const WEBSITE_CHAPTER_KINDS = ['video', 'quiz', 'document', 'discussion', 'unknown'] as const
export type WebsiteChapterKind = (typeof WEBSITE_CHAPTER_KINDS)[number]
export type WebsiteMediaControls = { box: string; media: string; controls: readonly string[] }
export type WebsiteChapterRules = {
  player: WebsiteMediaControls
  directory: Rows; sidebar: Rows & { active: string }; completionLabel: string
  cards: string; cardTarget: string; tabs: string; activeTab: string; disabledTab: string; tabPrefix: string
  body: string; jobIcon: string; jobContainer: string; jobDoneIcon: string; jobDoneBox: string; jobDoneLabel: string
}
const bounded = (value: unknown) => typeof value === 'string' && value.length <= 512

export function websiteChapterRules(value: unknown): WebsiteChapterRules {
  const rules = value as WebsiteChapterRules | null
  const fields = ['completionLabel', 'cards', 'cardTarget', 'tabs', 'activeTab', 'disabledTab', 'tabPrefix', 'body',
    'jobIcon', 'jobContainer', 'jobDoneIcon', 'jobDoneBox', 'jobDoneLabel'] as const
  if (!rules || fields.some(key => !bounded(rules[key]) || !rules[key])
    || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/.test(rules.tabPrefix)
    || !rules.player || !bounded(rules.player.box) || !rules.player.box
    || !bounded(rules.player.media) || !rules.player.media
    || !Array.isArray(rules.player.controls) || !rules.player.controls.length || rules.player.controls.length > 8
    || rules.player.controls.some(control => !bounded(control) || !control)
    || !rules.sidebar || !bounded(rules.sidebar.active) || !rules.sidebar.active || !rules.directory || [rules.sidebar, rules.directory].some(row =>
      (['row', 'target', 'name', 'number', 'task', 'hiddenCount', 'badge', 'completed'] as const).some(key =>
        !bounded(row[key]) || (key !== 'task' && !row[key])))) {
    throw new Error('网站脚本返回了无效的章节识别规则。')
  }
  return rules
}
