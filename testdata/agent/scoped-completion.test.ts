import { expect, it } from 'vitest'
import { scopedCompletionEvidence } from '../../src/services/agent/scopedCompletionEvidence'
import { browserTaskTargets, clearBrowserTaskIntent, rememberBrowserTaskIntent, setBrowserTaskIntent, specifiedChapterTargets } from '../../src/services/agent/browserTask'
const targets = ['2.1', '2.2']
const url = 'https://example.test/course/chapter'
const now = 10_000
const proof = { observation_id: 'read', targets, evidence: '目录中2.1与2.2均显示已完成，测验已有提交成绩回执。' }
const read = (extra: Record<string, unknown> = {}) => ({ id: 'read', name: 'browser_get_page', status: 'done',
  result: JSON.stringify({ ok: true, observation_id: 'read', observed_browser_id: 'tab', observed_at: now, url,
    snapshot: '目录中的目标章节', ...extra }) })
const check = (steps = [read()], value = proof) => scopedCompletionEvidence(steps, 'tab', url, targets, value, now)

it('accepts a fresh host-stamped page or screenshot for every explicitly requested chapter, including a running finish step', () => {
  expect(check([read(), { id: 'finish', name: 'browser_finish', status: 'running', result: '{}' }])).toMatchObject({ stepId: 'read', targets })
  expect(check([{ ...read(), name: 'browser_screenshot' }])).toBeTruthy()
  expect(check([{ ...read(), name: 'browser_todo' }])).toBeUndefined()
  expect(check([{ ...read(), name: 'browser_eval' }])).toBeUndefined()
})
it('does not shrink, expand or invent the user scope', () => {
  expect(check([read()], { ...proof, targets: ['2.2'] })).toBeUndefined()
  expect(check([read()], { ...proof, targets: [...targets, '2.3'] })).toBeUndefined()
  expect(scopedCompletionEvidence([read()], 'tab', url, [], proof, now)).toBeUndefined()
  expect(check([read()], { ...proof, evidence: '完成' })).toBeUndefined()
})
it('rejects untrusted, expired, wrong-tab, wrong-page and failed observations', () => {
  for (const extra of [{ observation_id: 'forged' }, { observed_browser_id: 'other' }, { observed_at: now - 120_001 },
    { observed_at: now + 1 }, { observed_at: undefined }, { observed_browser_id: undefined }, { url: 'https://other.test' },
    { ok: false }, { error: 'failed' }, { empty: true }, { snapshotStale: true }]) expect(check([read(extra)])).toBeUndefined()
  expect(check([{ ...read(), status: 'failed' }])).toBeUndefined()
  expect(check([read(), { ...read(), id: 'newer' }])).toBeUndefined()
})
it('invalidates a proof after actions, an impure eval, a failed read or a pending read', () => {
  for (const step of [
    { id: 'action', name: 'browser_click', status: 'done', result: '{}' },
    { id: 'action', name: 'browser_select_tab', status: 'done', result: '{}' },
    { id: 'action', name: 'browser_eval', status: 'done', arguments: ' {"script":"document.querySelector(\"button\").click()"}', result: '{}' },
    { ...read(), id: 'failure', status: 'failed' }, { ...read(), id: 'pending', status: 'running' },
  ]) expect(check([read(), step])).toBeUndefined()
})
it('takes chapter targets from user text, preserves bare continuation and never narrows a whole-course goal', () => {
  expect(specifiedChapterTargets('完成 2.1、2.2，旧成绩50.0分，软件v4.1')).toEqual(targets)
  expect(specifiedChapterTargets('完成整门课程，包括2.1、2.2')).toEqual([])
  expect(specifiedChapterTargets('完成所有章节，包括2.1和2.2')).toEqual([])
  expect(specifiedChapterTargets('只做2.1和2.2，不做整门课')).toEqual(targets)
  expect(specifiedChapterTargets('不要只做2.1和2.2，完成整门课程')).toEqual([])
  rememberBrowserTaskIntent('scoped', '只完成2.1和2.2的视频和测验')
  setBrowserTaskIntent('scoped', 'play')
  rememberBrowserTaskIntent('scoped', '继续')
  expect(browserTaskTargets('scoped')).toEqual(targets)
  rememberBrowserTaskIntent('scoped', '完成整门课程')
  expect(browserTaskTargets('scoped')).toEqual([])
  clearBrowserTaskIntent('scoped')
})
