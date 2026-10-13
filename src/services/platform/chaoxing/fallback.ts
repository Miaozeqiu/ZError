/** 图谱未命中时的学习通 URL 兜底。禁止在 browserTools / browserLoop 再写一份。 */

export const CX_HOST = /chaoxing\.com/i
export const CX_PLAYER = /studentstudy/i
export const CX_COURSE = /\/mycourse\/stu|studentcourse|stucoursemiddle/i
export const CX_HOMEWORK_DO = /doHomeWork|\/work\/do(?:work)?(?:[/?#]|$)|\/work\/phone\/do|dowork|do-work/i
export const CX_HOMEWORK_LIST = /(?:^|[?&])pageHeader=8(?:&|$)|\/work\/(?:list|index|view)(?:[/?#]|$)|mooc2-ans\.chaoxing\.com\/[^?\s]*\/work(?:\/|\?|$)/i
export const CX_LOGIN = /passport2\.chaoxing\.com/i
export const CX_SPACE = /i\.chaoxing\.com|i\.mooc\.chaoxing\.com/i
export const CX_IFRAME_PAGE = /studentcourse|\/knowledge\/cards|ananas\/modules|insertvideo|insertdoc|insertaudio|insertbbs|\/mooc2\/work\/list|\/work\/list/i
export const CX_NOT_HOMEWORK_DO = /studentstudy|studentcourse|knowledge\/cards|ananas|insertcourse|passport2/i
export const CX_COURSES_TAB = /visit\/courses|courselist/i
export const CX_TAUGHT_TAB = /visit\/interaction/i
