/** 平台无关 Agent 工具名；旧 browser_chaoxing_* 仅作执行别名。 */

export const PLATFORM_TOOLS = {
  chapters: 'browser_study_chapters',
  play: 'browser_study_play',
  watch: 'browser_study_watch',
  next: 'browser_study_next',
  homework: 'browser_homework',
  captcha: 'browser_captcha',
} as const

export type PlatformToolName = (typeof PLATFORM_TOOLS)[keyof typeof PLATFORM_TOOLS]

const ALIASES: Record<string, PlatformToolName> = {
  browser_study_chapters: PLATFORM_TOOLS.chapters,
  browser_study_play: PLATFORM_TOOLS.play,
  browser_study_watch: PLATFORM_TOOLS.watch,
  browser_study_next: PLATFORM_TOOLS.next,
  browser_homework: PLATFORM_TOOLS.homework,
  browser_captcha: PLATFORM_TOOLS.captcha,
  browser_chaoxing_chapters: PLATFORM_TOOLS.chapters,
  browser_chaoxing_play: PLATFORM_TOOLS.play,
  browser_chaoxing_watch: PLATFORM_TOOLS.watch,
  browser_chaoxing_next: PLATFORM_TOOLS.next,
  browser_chaoxing_homework: PLATFORM_TOOLS.homework,
  browser_chaoxing_captcha: PLATFORM_TOOLS.captcha,
}

export const normalizePlatformTool = (name: string): PlatformToolName | null => (
  ALIASES[String(name || '').trim()] || null
)

export const isPlatformTool = (name: string, kind: keyof typeof PLATFORM_TOOLS) => (
  normalizePlatformTool(name) === PLATFORM_TOOLS[kind]
)

export const usedPlatformTool = (
  steps: Array<{ name?: string; status?: string }> | null | undefined,
  kind: keyof typeof PLATFORM_TOOLS,
  status?: string,
) => (
  (steps || []).some((step) => (
    isPlatformTool(String(step.name || ''), kind)
    && (!status || step.status === status)
  ))
)
