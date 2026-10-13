import { describe, expect, it } from 'vitest'
import { formatLessonsNudge, noteBrowserToolResult } from '../../src/services/agent/agentLessons'

const url = 'https://www.zjooc.cn/ucenter/student/course/study/abc/plan/detail/xyz'

const fail = (tool: string, error: string, times = 2) => {
  for (let i = 0; i < times; i += 1) {
    noteBrowserToolResult(url, tool, JSON.stringify({ ok: false, error }), { kind: 'step', label: 'x' })
  }
}

describe('agent lessons', () => {
  it('过时的错不进教训：工具名当时不存在、缺少 handle', () => {
    fail('browser_read_agent_skill', '未知浏览器工具：browser_read_agent_skill')
    fail('browser_invoke', '缺少 handle。传 handle={kind,title} 或 kind + title。')
    const text = formatLessonsNudge(url)
    expect(text).not.toContain('未知浏览器工具')
    expect(text).not.toContain('缺少 handle')
    expect(text).not.toContain('handle={kind,title}')
  })

  it('教训只留错误第一句，下一步按工具给', () => {
    fail('browser_eval', '当前是播放页。播放用 invoke 点播放或 browser_watch；任务点从卡片读。')
    const text = formatLessonsNudge(url)
    expect(text).toContain('browser_eval：当前是播放页（2 次）')
    expect(text).toContain('快照里目标还在就用 ref 点')
    expect(text).toContain('browser_watch')
    expect(text).not.toContain('换参数')
  })
})
