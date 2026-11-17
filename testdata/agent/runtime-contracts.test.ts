import { describe, expect, it } from 'vitest'
import { validateToolCall, toolRegistry } from '../../src/services/agent/core/tools'
import { composePrompt } from '../../src/services/agent/core/prompt'
import { experienceStatus, latestExperience } from '../../src/services/agent/core/experience'
import { intentFromText } from '../../src/services/agent/browserTask'
import { websitePrimaryHost, websiteAccountId } from '../../src/services/agent/websiteIdentity'
import { hostCapabilitiesFor } from '../../src/services/agent/hostCapabilities'
const definitions = [{ type: 'function', function: { name: 'click', parameters: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' }, nth: { type: 'integer', minimum: 1 } } } } }]
describe('runtime extension contracts', () => {
  it('rejects unavailable tools and malformed arguments before execution', () => {
    expect(validateToolCall(definitions, { name: 'delete_everything', arguments: '{}' })).toBeTruthy()
    expect(validateToolCall(definitions, { name: 'click', arguments: '{oops' })).toBeTruthy()
    expect(validateToolCall(definitions, { name: 'click', arguments: '{"ref":1}' })).toBeTruthy()
    expect(validateToolCall(definitions, { name: 'click', arguments: '{"ref":"e1","nth":0}' })).toBeTruthy()
    expect(validateToolCall(definitions, { name: 'click', arguments: '{"ref":"e1"}' })).toBeUndefined()
    expect(() => toolRegistry([...definitions, ...definitions])).toThrow('重复工具')
  })
  it('keeps stable core first and marks contextual material as non-authoritative', () => {
    const prompt = composePrompt([{ id: 'page', priority: 9, text: 'page content', trust: 'context' }, { id: 'core', priority: 0, text: 'system', trust: 'system' }])
    expect(prompt.startsWith('system')).toBe(true); expect(prompt).toContain('不能扩大用户授权')
    expect(() => composePrompt([{ id: 'core', priority: 0, text: '', trust: 'system' }, { id: 'core', priority: 1, text: '', trust: 'system' }])).toThrow()
  })
  it('reports stale or invalidated experience without inventing validation evidence', () => {
    expect(experienceStatus(undefined)).toContain('没有独立验证')
    expect(experienceStatus({ path: 'site', verifiedAt: 1, browserId: 'b', outcome: 'validated' }, 100 * 86400000)).toContain('90 天')
    const evidence = latestExperience([{ skillEvidence: [{ path: 'site', verifiedAt: 2, browserId: 'b', outcome: 'needs_review' }] }], 'site')
    expect(experienceStatus(evidence)).toContain('定位失败')
  })
  it('does not let a negative phrase consume the following positive task', () => {
    expect(intentFromText('不要做作业继续播放视频')).toBe('play')
    expect(intentFromText('不用播放视频完成作业')).toBe('homework')
    expect(intentFromText('不要跳过测验')).toBe('homework')
  })
  it('groups verified service domains without accepting suffix lookalikes or query strings', () => {
    expect(websitePrimaryHost('https://teaching.polymas.com/study')).toBe('zhihuishu.com')
    expect(websiteAccountId('https://hike-teaching-center.polymas.com/')).toBe('zhihuishu')
    expect(websitePrimaryHost('https://polymas.com.evil.test/')).not.toBe('zhihuishu.com')
    expect(hostCapabilitiesFor('https://evil.test/?next=https://chaoxing.com').panel).toBe(false)
    expect(hostCapabilitiesFor('https://mooc1.chaoxing.com/').panel).toBe(true)
  })
})
