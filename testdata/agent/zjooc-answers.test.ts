// @vitest-environment jsdom
import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { evalBrowserViewMain } from '../../src/services/browser/eval'
import { authToken, authUser, openLoginDialog } from '../../src/services/app/auth'
import { remoteJson, RemoteApiError } from '../../src/services/app/remoteHttp'
import { runTextModel } from '../../src/services/model/runner'
import { captureReview } from '../../src/services/platform/zjooc/paperBank'
import { chaoxingStartup } from '../../src/services/agent/chaoxingStartup'
import { answerZjooc } from '../../src/services/agent/tools/zjoocAnswers'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../src/services/browser/eval', () => ({ evalBrowserViewMain: vi.fn() }))
vi.mock('../../src/services/app/auth', () => ({ authToken: { value: '' }, authUser: { value: null }, openLoginDialog: vi.fn() }))
vi.mock('../../src/services/app/remoteHttp', async original => ({
  ...await original<typeof import('../../src/services/app/remoteHttp')>(), remoteJson: vi.fn(),
}))
vi.mock('../../src/services/model/config', () => ({ modelConfigManager: { ready: Promise.resolve(), getSelectedTextModel: () => ({ id: 'answer-model' }), getSelectedAgentModel: () => null } }))
vi.mock('../../src/services/model/runner', () => ({ runTextModel: vi.fn() }))
let id = 0
let url: string
let dom: JSDOM
function row(stem: string, number: number, official = '', selected = false) {
  return '<section class="questiono-item"><div class="questiono-header"><b>' + number + '.</b><h6><span class="processing_img">' +
    stem + '</span></h6></div><div class="questiono-main">' + ['乙', '甲'].map((v, i) =>
    '<label class="common_test_option"><input type="radio" value="' + 'AB'[i] + '" name="q' + number + '"' +
    (selected && !i ? ' checked' : '') + '><span class="processing_img">' + v + '</span></label>').join('') + '</div>' +
    (official ? '<span class="common_test_correct">正确答案:</span><span class="common_test_html">' + official + '</span>' : '') +
    '<span class="common_test_myanswer">我的答案:</span><span>个人记录</span></section>'
}
function page(stage: string, rows: string[], count = rows.length) {
  url = 'https://www.zjooc.cn/ucenter/student/course/study/course/homework/' + stage + '/p' + id
  dom = new JSDOM('<div class="common_look_title"><h6>课堂练习</h6><p>学生:个人姓名</p></div><div class="common_look_main">' +
    '<div class="el-col">单选题(共' + count + '题)</div>' + rows.join('') + '</div><button>提交</button>', { url, runScripts: 'outside-only' })
  Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value() { return [{}] } })
  vi.mocked(evalBrowserViewMain).mockImplementation(async (_id, js) => dom.window.eval(js))
}
function run(args: Record<string, unknown> = {}, extra = {}) {
  return answerZjooc({ args, browserId: 'b', wait: async () => {}, signal: new AbortController().signal, ...extra }).then(JSON.parse)
}
beforeEach(() => {
  id++
  vi.resetAllMocks()
  authToken.value = 'mock-session'
  authUser.value = { id: 1, nickname: 'fixture' }
  vi.mocked(invoke).mockResolvedValue([[]])
  vi.mocked(runTextModel).mockResolvedValue('[]')
})

describe('在浙学答题', () => {
  it('collects only released review fields, deduplicates concurrent uploads and remaps answers by option text', async () => {
    page('result', [row('题目', 1, 'B', true)])
    vi.mocked(remoteJson).mockImplementation(async url => {
      if (url.includes('originalJson')) throw new RemoteApiError(404, 'Paper not found')
      return {}
    })
    expect(await Promise.all([captureReview('b', url), captureReview('b', url)])).toEqual([true, true])
    const uploads = vi.mocked(remoteJson).mock.calls.filter(([url]) => url.endsWith('/upload'))
    expect(uploads).toHaveLength(1)
    const payload = String(uploads[0]![1]!.body)
    expect(payload).not.toMatch(/个人|stuName|mock-session|stuScore/)
    expect(JSON.parse(payload).data.paperSubjectList[0].rightAnswer).toBe('B')
    page('do', [row('题目', 1).replace('乙', '换位').replace('甲', '乙').replace('换位', '甲')])
    const progress = vi.fn()
    const response = await run({}, { onHomeworkProgress: progress })
    expect(response.questions).toEqual([{ number: 1, status: 'filled', source: 'review' }])
    expect(progress.mock.calls.at(-1)?.[0].questions[0].actual).toEqual({ choices: ['A'] })
    expect(remoteJson).toHaveBeenCalledTimes(2)
  })
  it('matches server, bank and model independently, retains existing answers and never clicks submit', async () => {
    page('do', [row('服务器', 1), row('本地', 2), row('模型', 3), row('保留', 4, '', true), row('无答案', 5)])
    const submitted = vi.fn()
    dom.window.document.querySelector('button')!.onclick = submitted
    vi.mocked(remoteJson).mockResolvedValue({ data: { id: 'p' + id, courseId: 'course', paperSubjectList: [
      { subjectType: 1, subjectName: '服务器', subjectOptions: [{ optionHead: 'A', optionContent: '甲' }, { optionHead: 'B', optionContent: '乙' }], rightAnswer: 'A' },
    ] } })
    vi.mocked(invoke).mockResolvedValueOnce([[{ answer: '乙' }]])
    vi.mocked(runTextModel).mockResolvedValueOnce('["B"]')
    const result = await run()
    expect(result.questions.map((q: any) => q.source || q.status)).toEqual(['server', 'local_bank', 'model', 'existing_answer', 'needs_review'])
    expect([...dom.window.document.querySelectorAll<HTMLInputElement>('input:checked')].map(i => i.value)).toEqual(['B', 'A', 'B', 'A'])
    expect(remoteJson).toHaveBeenCalledTimes(1)
    expect(submitted).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('mock-session')
    expect(JSON.stringify(vi.mocked(runTextModel).mock.calls)).not.toContain('mock-session')
  })
  it('fills multiple, judgement and multi-blank controls and falls back after a network error', async () => {
    page('do', [row('多选', 1).replaceAll('type="radio"', 'type="checkbox"'),
      row('判断', 2).replace('乙', '正确').replace('甲', '错误'),
      '<div class="questiono-item"><div class="questiono-header"><b>3.</b><h6><span class="processing_img">填空</span></h6></div>' +
      '<div class="pb10"><input class="el-input__inner" placeholder="此处输入答案"></div>'.repeat(2) + '</div>'])
    expect(chaoxingStartup('帮我自动答题', url)?.name).toBe('browser_answer_zjooc')
    expect(chaoxingStartup('看看答题情况', url)).toBeUndefined()
    vi.mocked(remoteJson).mockRejectedValue(new Error('offline'))
    vi.mocked(runTextModel).mockResolvedValueOnce('["B","A"]').mockResolvedValueOnce('["B"]').mockResolvedValueOnce('["一","二"]')
    const result = await run()
    expect(result.serverUnavailable).toBe(true)
    expect(result.questions.map((q: any) => q.status)).toEqual(['filled', 'filled', 'filled'])
    expect([...dom.window.document.querySelectorAll<HTMLInputElement>('input.el-input__inner')].map(el => el.value)).toEqual(['一', '二'])
  })
  it('uses the displayed number in single-question mode and exposes the enabled next button', async () => {
    page('do', [])
    dom.reconfigure({ url: url.replace('/homework/', '/singleQuestion/') })
    dom.window.document.body.innerHTML = '<div class="left_container"><div class="question_title"><p>2、单选题</p></div>' +
      '<div class="question_content"><div><div class="question_title"><span>单题</span></div><div class="question_content">' +
      ['A','B'].map(key => '<div class="radio_content"><input name="x" type="radio" value="' + key + '"><p>选项' + key + '</p></div>').join('') +
      '</div></div></div><div class="question_btn"><button>下一题</button></div></div><ul class="index_box"><li>1</li><li>2</li><li>3</li></ul>'
    vi.mocked(remoteJson).mockRejectedValue(new RemoteApiError(404, 'miss'))
    vi.mocked(runTextModel).mockResolvedValue('["B"]')
    const result = await run({ question_range: { start: 2, end: 2 } })
    expect(result).toMatchObject({ singlePage: true, hasNextPage: true, questions: [{ number: 2, status: 'filled' }] })
  })
  it('asks for app login on missing or expired credentials and resumes the same batch', async () => {
    page('do', [row('题目', 1)])
    authToken.value = ''
    vi.mocked(openLoginDialog).mockImplementation(() => {
      authToken.value += 'new'
      window.dispatchEvent(new CustomEvent('login-dialog-finished', { detail: true }))
    })
    vi.mocked(remoteJson).mockRejectedValueOnce(new RemoteApiError(401, 'Token expired')).mockRejectedValueOnce(new RemoteApiError(404, 'miss'))
    vi.mocked(runTextModel).mockResolvedValueOnce('["B"]')
    expect((await run()).questions[0]).toMatchObject({ status: 'filled', source: 'model' })
    expect(openLoginDialog).toHaveBeenCalledTimes(2)
    expect(vi.mocked(remoteJson).mock.calls.map(([url]) => new URL(url).searchParams.get('token'))).toEqual(['new', 'newnew'])
  })
  it('stops on cancellation or navigation during login', async () => {
    page('do', [row('题目', 1)])
    authToken.value = ''
    vi.mocked(openLoginDialog).mockImplementationOnce(() => window.dispatchEvent(new CustomEvent('login-dialog-finished', { detail: false })))
    expect((await run()).ok).toBe(false)
    vi.mocked(openLoginDialog).mockImplementationOnce(() => {
      authToken.value = 'new'
      dom.reconfigure({ url: url + '-other' })
      window.dispatchEvent(new CustomEvent('login-dialog-finished', { detail: true }))
    })
    expect((await run()).ok).toBe(false)
    expect(remoteJson).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
  it('skips incomplete reviews and never uploads a personal answer or a do page', async () => {
    page('result', [row('未公布', 1)])
    expect(await captureReview('b', url)).toBe(false)
    page('result', [row('第一题', 1, 'B')], 2)
    expect(await captureReview('b', url)).toBe(false)
    page('do', [row('第一题', 1, 'B')])
    expect(await captureReview('b', url)).toBe(false)
    expect(remoteJson).not.toHaveBeenCalled()
  })
  it('limits scoped writes, rejects ambiguous displayed numbers and catches a changed paper during inference', async () => {
    page('do', [row('题一', 1), row('题二', 2), row('题三', 3)])
    vi.mocked(remoteJson).mockRejectedValue(new RemoteApiError(404, 'miss'))
    vi.mocked(runTextModel).mockResolvedValueOnce('["A"]')
    expect((await run({ question_range: { start: 2, end: 2 } })).questions).toEqual([{ number: 2, source: 'model', status: 'filled' }])
    page('do', [row('同号', 1), row('同号', 1)])
    expect((await run({ question_range: { start: 1, end: 1 } })).ok).toBe(false)
    page('do', [row('题一', 1)])
    vi.mocked(runTextModel).mockImplementationOnce(async () => {
      dom.window.document.querySelector('h6 .processing_img')!.textContent = '另一题'
      return '["B"]'
    })
    expect((await run()).ok).toBe(false)
    expect(dom.window.document.querySelector('input:checked')).toBeNull()
  })
})
