import { registerClickText, registerNavigateGuard } from '../../browser/pageHooks'
import { clickSpaceTab, isSpaceListTopUrl } from './spaceTab'

export const bindChaoxingPageHooks = () => {
  registerNavigateGuard((url) => (
    isSpaceListTopUrl(url) ? '禁止顶层打开课表地址。只点 iframe 里的「我学的课」页签。' : null
  ))
  registerClickText(async (id, text) => {
    const want = String(text || '').trim()
    if (/^(我学的课|已学的课|我教的课)$/.test(want)) {
      return clickSpaceTab(id, want === '我教的课' ? 'taught' : 'student')
    }
    const { clickCourseTab, isCourseChromeTab } = await import('./courseTab')
    if (isCourseChromeTab(want)) return clickCourseTab(id, want)
    return null
  })
}
