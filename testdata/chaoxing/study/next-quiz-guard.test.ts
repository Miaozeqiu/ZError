import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ open: vi.fn(), jobs: [
  { label: '视频', kind: 'video', jobDone: true, active: false },
  { label: '测验', kind: 'quiz', jobDone: false, active: false },
] }))
vi.mock('../../../src/services/chaoxing/browser/chapters', () => ({
  startChaoxingChapterParser: vi.fn(),
  refreshChapterCard: async () => ({ chapters: [{ title: '2.1', kind: 'section', unfinished: true }] }),
  chapterStateFor: () => ({ jobs: state.jobs, chapters: [{ title: '2.1', kind: 'section', unfinished: true }] }),
  findChapterInPanel: () => null, isCatalogSectionTitle: () => true, openChapterFromCard: state.open,
}))
vi.mock('../../../src/services/chaoxing/study', () => ({ liveStudyHref: vi.fn(), parseChaoxingChapters: vi.fn(), waitForStudyPlayerReady: vi.fn() }))
vi.mock('../../../src/services/chaoxing/study/video', () => ({}))
vi.mock('../../../src/services/browser/eval', () => ({ waitMs: vi.fn() }))
vi.mock('../../../src/services/browser/pageClock', () => ({ kickParserClock: vi.fn() }))
import { nextPanelStudy } from '../../../src/services/chaoxing/browser/panelStudy'

describe('章节切换保护', () => {
  it('当前节还有未完成测验时，不打开下一节', async () => {
    const result = await nextPanelStudy('browser')
    expect(result).toMatchObject({ ok: false, sameChapter: true })
    expect(result.hint).toContain('未完成的测验')
    expect(state.open).not.toHaveBeenCalled()
  })
})
