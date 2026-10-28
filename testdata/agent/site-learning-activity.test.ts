import { describe, expect, it } from 'vitest'
import { describeActivity } from '../../src/services/agent/activity'
const path = 'sites/menhu.haou.edu.cn/SKILL.md'
const args = { skill_id: 'chaoxing', path: 'sites/authserver.open.ha.cn/SKILL.md' }
const target = { id: 'site-learn', path }
describe('website learning activity labels', () => {
  it('shows the canonical target and an expected first-time absence without a failure label', () => {
    const activity = describeActivity('browser_read_agent_skill_file', args, 'done', { ...target, ok: true, exists: false })
    expect(activity).toEqual({ target: 'site-learn', label: `本站尚无经验记录，可创建 ${path}` })
  })
  it('does not claim a write when the content was unchanged, and preserves real failures', () => {
    expect(describeActivity('write_agent_skill_file', args, 'done', { ...target, unchanged: true }).label).toContain('内容未变')
    expect(describeActivity('read_agent_skill_file', args, 'failed', target).label).toBe(`读取 ${path} 失败`)
    expect(describeActivity('write_agent_skill_file', args, 'failed', target).label).toBe(`写入 ${path} 失败`)
  })
  it('distinguishes pending experience evidence from a failure to finish the webpage task', () => {
    expect(describeActivity('browser_finish', { status: 'done' }, 'failed', { learningRequired: true }).label).toBe('网页任务已完成，网站经验待核对')
    expect(describeActivity('browser_finish', { status: 'done' }, 'failed', {}).label).toBe('收尾失败')
  })
})
