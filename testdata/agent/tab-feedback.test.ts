import { describe, expect, it, vi } from 'vitest'
import { handleActTools } from '../../src/services/agent/tools/act'
import { isCourseChromeTab } from '../../src/services/platform/chaoxing/courseTab'
import { recordBrowserTabLimit, withPopupTabLimit } from '../../src/services/browser/tabLimits'

describe('标签上限经过真实工具入口反馈', () => {
  it.each(['作业', '讨论', '考试', '查看详情', '学习通作业'])('不漏掉 %s 的已发送点击与弹窗失败', async label => {
    const chaoxing = label === '学习通作业'
    const text = chaoxing ? '作业' : label
    const url = chaoxing ? 'https://mooc1.chaoxing.com/mycourse/stu' : 'https://wisdom-mooc.zhihuishu.com/study/analysis'
    const observe = vi.fn(async (id, result, _from, _frame, sequence) => withPopupTabLimit(id, result, sequence))
    const click = vi.fn(async () => {
      recordBrowserTabLimit('popup', 'tab', 'session')
      return { ok: true, text, tab: text }
    })
    const result = JSON.parse(await handleActTools({
      name: 'browser_click_text', args: { text, nth: 1 }, browserId: 'tab', sessionId: 'session',
      currentUrl: async () => url, graphUrlOf: async () => url, graphNodeId: () => 'course', isShellNode: () => false,
      siteGraphForUrl: () => ({ id: chaoxing ? 'chaoxing' : 'zhihuishu' }),
      listCachedPageRefs: () => [], clickByLocator: click, clickBrowserText: click,
      withBudget: async promise => promise, isCourseChromeTab, observeAfterClick: observe,
    }) || '{}')
    expect(click).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ ok: false, reason: 'tab_limit', clickDispatched: true })
    if (chaoxing) { expect(observe).not.toHaveBeenCalled(); expect(result.tab).toBe('作业') }
    else expect(observe).toHaveBeenCalledOnce()
  })
})
