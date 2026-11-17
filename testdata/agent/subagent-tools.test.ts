import { describe, expect, it } from 'vitest'
import { assembleBrowserTools } from '../../src/services/agent/tools'
import { toolNamesOf } from '../../src/services/agent/subagent/tools'
import { emptyHostCapabilities, executeToolNamesFor } from '../../src/services/agent/hostCapabilities'
import { SUBAGENTS_ENABLED } from '../../src/services/agent/subagent/enabled'
import { summarizeSubagentReceipt } from '../../src/services/agent/subagent/receipt'

describe('子 Agent 工具表', () => {
  it('explore 调 play 会被工具表拦住', () => {
    const names = toolNamesOf(assembleBrowserTools({ role: 'explore' }))
    expect(names).toContain('browser_get_state')
    expect(names).toContain('browser_get_page')
    expect(names).not.toContain('browser_study_play')
    expect(names).not.toContain('browser_homework')
    expect(names).not.toContain('browser_task')
    expect(names).not.toContain('write_agent_skill_file')
  })

  it('parent 自己动手，用 click 而不是 invoke', () => {
    const names = toolNamesOf(assembleBrowserTools({ role: 'parent' }))
    expect(names).toContain('browser_get_state')
    expect(names).not.toContain('browser_invoke')
    expect(names).not.toContain('browser_parser_dryrun')
    expect(names).toContain('browser_watch')
    expect(names).toContain('browser_click')
    expect(names.includes('browser_task')).toBe(SUBAGENTS_ENABLED)
    expect(names).toContain('browser_finish')
    expect(names).toContain('read_agent_skill_file')
    expect(names).toContain('write_agent_skill_file')
  })

  it('execute 没有 watch 就不挂 study_play', () => {
    const caps = emptyHostCapabilities()
    const names = toolNamesOf(assembleBrowserTools({ role: 'execute', capabilities: caps }))
    expect(names).not.toContain('browser_study_play')
    expect(names).not.toContain('browser_study_watch')
    expect(names).toContain('browser_watch')
    expect(names).toContain('browser_wait')
    expect(names).not.toContain('browser_invoke')
    expect(executeToolNamesFor(caps)).toContain('browser_watch')
    expect(executeToolNamesFor(caps)).not.toContain('browser_study_play')
  })

  it('execute 回执不含长 transcript', () => {
    const receipt = summarizeSubagentReceipt({
      ok: true,
      kind: 'execute',
      summary: '视频2在播',
      url: 'https://mooc1.chaoxing.com/studentstudy',
      playing: true,
    })
    expect(receipt).not.toHaveProperty('transcript')
    expect(JSON.stringify(receipt).length).toBeLessThan(800)
  })
})
