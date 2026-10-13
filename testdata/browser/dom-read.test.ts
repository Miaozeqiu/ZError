import { describe, expect, it, vi } from 'vitest'
import { jobsFromHtml, catalogReadyFromHtml } from '../../src/services/chaoxing/study/localJobs'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))

describe('本地 DOM 解析', () => {
  it('catalogReadyFromHtml 认 coursetree 节点', () => {
    const snap = catalogReadyFromHtml('<ul id="coursetree"><li class="posCatalog_select">1.1</li></ul>', 'https://x/studentstudy')
    expect(snap.hasDir).toBe(true)
    expect(snap.catalogLi).toBeGreaterThan(0)
    expect(snap.onCatalog).toBe(true)
  })

  it('jobsFromHtml 用 collectSteps 读任务点', () => {
    const jobs = jobsFromHtml(`
      <div class="ans-attach-ct videoContainer">
        <iframe src="https://mooc1.chaoxing.com/ananas/modules/video?mid=11"></iframe>
      </div>
    `)
    expect(Array.isArray(jobs)).toBe(true)
  })
})
