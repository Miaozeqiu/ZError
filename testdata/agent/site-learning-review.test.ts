import { describe, expect, it } from 'vitest'
import { createLearningCompletionCheck, reviewSiteLearning } from '../../src/services/agent/siteLearningReview'
const path = 'sites/zjooc.cn/SKILL.md'
const step = (id: string, name: string, args = {}, result = {}, status = 'done') => ({
  id, name, status, arguments: JSON.stringify(args), result: JSON.stringify(result),
})
const actions = [
  step('old-read', 'browser_eval', { script: '读取所有选项祖先' }, { ok: true }),
  step('new-read', 'browser_eval', { script: '按独立题目分组' }, { ok: true }),
  step('checked', 'browser_set_checked', {}, { ok: true }),
]
const read = step('skill-read', 'read_agent_skill_file', { skill_id: 'site-learn', path }, { content: '# 在浙学\n已有步骤' })
const write = step('skill-write', 'write_agent_skill_file', {}, { id: 'site-learn', path, ok: true })
const check = (steps = actions, learning?: unknown, writePolicy = 'ask') => reviewSiteLearning({ url: 'https://www.zjooc.cn/ucenter/student/course/build/homework', steps, learning, writePolicy })
const decision = (decision: string) => ({ decision, reason: '独立题目容器分组已核对，避免题干与选项跨题混合' })

describe('站点经验收尾', () => {
  it('重现本轮：两次 eval 都返回成功，但读取方法发生改变，也必须检查经验', () => {
    expect(check()).toMatchObject({ required: true, candidate: true, ok: false, path })
    expect(check(actions, decision('no_new')).ok).toBe(false)
  })
  it('聊天、单步操作与本地导航不引入学习调用', () => {
    expect(check([]).required).toBe(false)
    expect(check([actions[2]]).required).toBe(false)
    expect(reviewSiteLearning({ url: 'http://localhost:1420/browser-home.html', steps: actions }).required).toBe(false)
  })
  it('先失败再成功的恢复也不能未经检查就说无新经验', () => {
    const steps = [step('fail', 'browser_click', {}, { error: '遮挡' }, 'failed'), step('ok', 'browser_click', {}, { ok: true }), actions[2]]
    expect(check(steps)).toMatchObject({ candidate: true, ok: false })
  })
  it('没有新发现的常规流程可以给出理由后跳过', () => {
    expect(check([step('a', 'browser_navigate'), actions[2]], decision('no_new')).ok).toBe(true)
  })
  it('不能凭口头声明已保存，也不能用别的站点或以前回合的写入当证据', () => {
    expect(check(actions, decision('updated')).ok).toBe(false)
    const wrong = step('wrong', 'write_agent_skill_file', {}, { id: 'site-learn', path: 'sites/other.cn/SKILL.md', ok: true })
    expect(check([...actions, read, wrong], decision('updated')).ok).toBe(false)
    expect(check([...actions, write, read], decision('updated')).ok).toBe(false)
  })
  it('必须先读取再保存成功，长参数被截断时仍以写入结果核对路径', () => {
    expect(check([...actions, read, { ...write, arguments: '{"content":"截断' }], decision('updated')).ok).toBe(true)
  })
  it('已有覆盖需要读取；文件不存在不能算已有覆盖', () => {
    expect(check(actions, decision('covered')).ok).toBe(false)
    expect(check([...actions, read], decision('covered')).ok).toBe(true)
    const missing = { ...read, status: 'failed', result: JSON.stringify({ error: '文件还不存在' }) }
    expect(check([...actions, missing], decision('covered')).ok).toBe(false)
    expect(check([...actions, missing, write], decision('updated')).ok).toBe(true)
  })
  it('重复正文未实际写入，只能报告覆盖，不能冒充新增经验', () => {
    const same = { ...write, result: JSON.stringify({ id: 'site-learn', path, ok: true, unchanged: true }) }
    expect(check([...actions, read, same], decision('updated')).ok).toBe(false)
    expect(check([...actions, read, same], decision('covered')).ok).toBe(true)
  })
  it('拒绝授权、写入失败或策略禁止，允许任务结束并如实记录未保存', () => {
    expect(check(actions, decision('deferred')).ok).toBe(false)
    const denied = step('denied', 'write_agent_skill_file', { skill_id: 'site-learn', path }, { denied: true, error: '用户拒绝' }, 'failed')
    expect(check([...actions, denied], decision('deferred')).ok).toBe(true)
    const failed = { ...denied, result: JSON.stringify({ error: '磁盘写入失败' }) }
    expect(check([...actions, failed], decision('deferred')).ok).toBe(true)
    expect(check(actions, decision('deferred'), 'deny').ok).toBe(true)
  })
  it('没有 finish 就直接回答时最多提醒两次，不无限循环或冒充学习成功', () => {
    const gate = createLearningCompletionCheck(() => ({ url: 'https://www.zjooc.cn/work', steps: actions, enabled: true }))
    expect(gate.beforeComplete()).toContain(path)
    expect(gate.beforeComplete()).toBeTruthy()
    expect(gate.beforeComplete()).toBeUndefined()
    expect(gate.deferred).toBe(true)
  })
  it('已成功收尾、子 Agent 或人工中止不启动额外学习', () => {
    const finish = step('finish', 'browser_finish', {}, { ok: true, finished: true, learning: decision('covered') })
    expect(createLearningCompletionCheck(() => ({ url: 'https://zjooc.cn/work', steps: [...actions, finish], enabled: true })).beforeComplete()).toBeUndefined()
    expect(createLearningCompletionCheck(() => ({ url: 'https://zjooc.cn/work', steps: actions, enabled: false })).beforeComplete()).toBeUndefined()
    expect(createLearningCompletionCheck(() => ({ url: 'https://zjooc.cn/work', steps: actions, enabled: true, ready: false })).beforeComplete()).toBeUndefined()
    const deferredFinish = { ...finish, result: JSON.stringify({ finished: true, learning: decision('deferred') }) }
    expect(createLearningCompletionCheck(() => ({ url: 'https://zjooc.cn/work', steps: [...actions, deferredFinish], enabled: true })).deferred).toBe(true)
  })
})
