/** Temporary v1 compatibility list. Remove entries as repositories adopt host API 2. */
export const legacyWebsiteTools = {
  'chaoxing.com': [
    'browser_login_chaoxing', 'browser_list_courses', 'browser_open_course',
    'browser_list_homework', 'browser_open_homework', 'browser_answer_homework',
    'browser_review_homework', 'browser_review_chapter_discussion', 'browser_reply_chapter_discussion',
    'browser_start_chapter_tasks', 'browser_open_pending_chapter', 'browser_review_chapter',
    'browser_complete_chapter', 'browser_decode_chaoxing_font',
  ],
} satisfies Record<string, string[]>

export const websiteToolHost = (name: string) => Object.entries(legacyWebsiteTools).find(([, names]) => names.includes(name))?.[0]
export const websiteHasSupportedTools = (host: string) => Object.hasOwn(legacyWebsiteTools, host)
export const websiteToolNames = Object.values(legacyWebsiteTools).flat()
