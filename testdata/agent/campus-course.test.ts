// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { campusToolHandlers } from '../../src/services/agent/toolHandlers/campus'
import { setAgentPolicy } from '../../src/services/agent/agentPolicy'
import { executeChatTool } from '../../src/services/agent/executeChatTool'
import { buildAgentSystemPrompt } from '../../src/services/agent/prompts'
import { availableAgentTools, CHAT_TOOLS } from '../../src/services/agent/tools'
import type { ChatToolContext } from '../../src/services/agent/toolContext'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../src/services/platform/panelAccess', () => ({
  chapterStateFor: vi.fn(), packAgentPanel: vi.fn(), videoWatchFor: vi.fn(),
}))
vi.mock('../../src/services/agent/browserTools', () => ({ executeBrowserTool: vi.fn() }))
vi.mock('../../src/services/agent/finishGate', () => ({ collectFinishEvidence: vi.fn(), judgeFinish: vi.fn() }))
vi.mock('../../src/services/agent/toolHandlers/folder', () => ({ folderToolHandlers: {} }))
vi.mock('../../src/services/agent/toolHandlers/quiz', () => ({ quizToolHandlers: {} }))
vi.mock('../../src/services/agent/toolHandlers/study', () => ({ studyToolHandlers: {} }))
vi.mock('../../src/services/agent/toolHandlers/search', () => ({ searchToolHandlers: {} }))
vi.mock('../../src/services/agent/chatStore', () => ({ liveSession: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: request }))
vi.mock('../../src/services/app/auth', () => ({
  isLoggedIn: { value: true },
  authUser: { value: { id: 12 } },
}))

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

const callCampusTool = async (name: string, args: Record<string, unknown>) =>
  JSON.parse(await campusToolHandlers[name]({
    args,
    call: { id: 'course', name, arguments: JSON.stringify(args) },
    ctx: { abort: new AbortController().signal, sessionId: 'campus-course-test' } as ChatToolContext,
  }))

const dispatchCampusTool = async (name: string, args: Record<string, unknown> = {}) =>
  JSON.parse(await executeChatTool({
    call: { id: 'permission-test', name, arguments: JSON.stringify(args) },
    ctx: { abort: new AbortController().signal, sessionId: 'permission-test', browserId: () => '' } as ChatToolContext,
  }))

const createCourse = (args: Record<string, unknown>) => callCampusTool('create_campus_course', args)
const verifiedCampus = () => jsonResponse({ campus: { id: 42, name: '测试学校' }, status: 'verified' })
const courseDetail = (archived = false, creatorId = 12) => jsonResponse({
  id: 7,
  name: '劳动经济学',
  folders: [{ ID: 9, Name: '期中试卷', IsArchived: archived, CreatorID: creatorId }],
})

describe('创建校园课程', () => {
  beforeEach(() => {
    request.mockReset()
    setAgentPolicy({ campusUpload: true, campusEdit: true })
  })

  it('课名为空时先询问，不发送请求', async () => {
    expect(await createCourse({ name: '  ' })).toEqual({ error: '请先向用户询问课程名称。' })
    expect(request).not.toHaveBeenCalled()
  })

  it('校园账号未认证时不提交课程', async () => {
    request.mockResolvedValueOnce(jsonResponse({ campus: { id: 42, name: '测试学校' }, status: 'pending' }))
    expect(await createCourse({ name: '劳动经济学' })).toMatchObject({ error: expect.stringContaining('认证') })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('用校园接口提交到绑定学校，并保留待审核状态', async () => {
    request
      .mockResolvedValueOnce(jsonResponse({ campus: { id: 42, name: '测试学校' }, status: 'verified' }))
      .mockResolvedValueOnce(jsonResponse({ ID: 7, Name: '劳动经济学', Status: 'pending' }, 201))

    expect(await createCourse({ name: ' 劳动经济学 ' })).toMatchObject({
      course_id: 7,
      status: 'pending',
      message: '课程「劳动经济学」已提交审核。',
    })
    const [url, init] = request.mock.calls[1]
    expect(url).toBe('https://campuses.zerror.cc/courses')
    expect(init.method).toBe('POST')
    expect(init.body.get('campus_id')).toBe('42')
    expect(init.body.get('name')).toBe('劳动经济学')
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('接口拒绝时保留错误，不重复提交', async () => {
    request
      .mockResolvedValueOnce(jsonResponse({ campus: { id: 42, name: '测试学校' }, status: 'verified' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Course name already exists in this campus' }, 400))
    expect(await createCourse({ name: '劳动经济学' })).toEqual({ error: 'Course name already exists in this campus' })
    expect(request).toHaveBeenCalledTimes(2)
  })
})


describe('管理校园课程和试卷', () => {
  beforeEach(() => {
    request.mockReset()
    setAgentPolicy({ campusUpload: true, campusEdit: true })
  })

  it('用表单提交改名，并区分待审核记录和原课程', async () => {
    request.mockResolvedValueOnce(verifiedCampus()).mockResolvedValueOnce(
      jsonResponse({ course: { ID: 22, Name: '劳动经济学导论', Status: 'pending', ParentID: 7 } }),
    )
    expect(await callCampusTool('rename_campus_course', { course_id: 7, name: '劳动经济学导论' }))
      .toMatchObject({ course_id: 7, status: 'pending', message: expect.stringContaining('待审核') })
    const [url, init] = request.mock.calls[1]
    expect(url).toMatch(/\/courses\/7$/)
    expect(init.method).toBe('PUT')
    expect(init.body.get('name')).toBe('劳动经济学导论')
  })

  it('按课程请求未分类题分页', async () => {
    request.mockResolvedValueOnce(verifiedCampus())
      .mockResolvedValueOnce(jsonResponse([{ ID: 7, Name: '劳动经济学' }]))
      .mockResolvedValueOnce(jsonResponse([{ ID: 11, Content: '题目', Type: 'short_answer' }]))
    expect(await callCampusTool('list_campus_uncategorized_questions', { course_id: 7, page: 2, page_size: 1 }))
      .toMatchObject({ course_id: 7, next_page: 3, questions: [{ campus_question_id: 11 }] })
    expect(request.mock.calls[2][0]).toMatch(/\/courses\/7\/questions\?page=2&page_size=1$/)
  })

  it('查重排除近似题和选项顺序不同的同题干结果', async () => {
    request.mockResolvedValueOnce(verifiedCampus()).mockResolvedValueOnce(jsonResponse({
      found: true,
      results: [
        { ID: 1, Content: '劳动供给的定义是什么？', Options: '["甲","乙"]' },
        { ID: 2, Content: '劳动供给 的定义', Options: '["乙","甲"]' },
        { ID: 3, Content: '劳动供给的定义', Options: '["甲","乙"]' },
      ],
    }))
    expect(await callCampusTool('check_campus_question_duplicate', { question: '劳动供给的定义', options: ['甲', '乙'] }))
      .toMatchObject({ found: true, compared_options: true, count: 1, same_stem_count: 2, questions: [{ campus_question_id: 3 }] })
  })

  it('能取消归档后端标为 IsArchived 的试卷', async () => {
    request.mockResolvedValueOnce(verifiedCampus()).mockResolvedValueOnce(courseDetail(true))
      .mockResolvedValueOnce(jsonResponse({ message: 'Folder unarchived successfully' }))
    expect(await callCampusTool('set_campus_paper_archived', { course_id: 7, paper_id: 9, archived: false }))
      .toMatchObject({ archived: false, vote_started: false })
    expect(request.mock.calls[2][0]).toMatch(/\/folders\/9\/unarchive$/)
  })

  it('需要投票时先征求同意，获得同意后只报告已发起投票', async () => {
    request.mockResolvedValueOnce(verifiedCampus()).mockResolvedValueOnce(courseDetail(false, 999))
    const args = { course_id: 7, paper_id: 9, archived: true }
    expect(await callCampusTool('set_campus_paper_archived', args)).toMatchObject({ requires_vote: true })
    expect(request).toHaveBeenCalledTimes(2)

    request.mockResolvedValueOnce(verifiedCampus()).mockResolvedValueOnce(courseDetail(false, 999))
      .mockResolvedValueOnce(jsonResponse({ vote: { ID: 33 } }, 201))
    expect(await callCampusTool('set_campus_paper_archived', { ...args, allow_vote: true }))
      .toMatchObject({ archived: false, vote_started: true, vote_id: 33 })
  })

  const questions = () => jsonResponse([
    { ID: 11, Content: '第一题', Children: [{ ID: 13 }] },
    { ID: 12, Content: '第二题' },
  ])

  it.each([[[12]], [[12, 13]]])('拒绝残缺或混入子题的排序 %j', async (ids) => {
    request.mockResolvedValueOnce(verifiedCampus()).mockResolvedValueOnce(courseDetail()).mockResolvedValueOnce(questions())
    expect(await callCampusTool('reorder_campus_paper_questions', {
      course_id: 7, paper_id: 9, campus_question_ids: ids,
    })).toMatchObject({ expected_count: 2 })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('只提交完整的试卷顶层题 ID 顺序', async () => {
    request.mockResolvedValueOnce(verifiedCampus()).mockResolvedValueOnce(courseDetail()).mockResolvedValueOnce(questions())
      .mockResolvedValueOnce(jsonResponse({ message: 'Questions reordered successfully' }))
      .mockResolvedValueOnce(jsonResponse([{ ID: 12, Content: '第二题' }, { ID: 11, Content: '第一题' }]))
    expect(await callCampusTool('reorder_campus_paper_questions', { course_id: 7, paper_id: 9, campus_question_ids: [12, 11] }))
      .toMatchObject({ paper_id: 9, count: 2, already: false })
    const [url, init] = request.mock.calls[3]
    expect(url).toMatch(/\/folders\/9\/reorder$/)
    expect(JSON.parse(init.body)).toEqual({ question_ids: [12, 11] })
  })
})


describe('校园题库操作权限', () => {
  const available = () => availableAgentTools(CHAT_TOOLS, { enabled: false }).map(tool => tool.function.name)

  it('两个开关分别限制上传与修改，保留查重', () => {
    setAgentPolicy({ campusUpload: false, campusEdit: false })
    expect(available()).not.toContain('save_campus_questions')
    expect(available()).not.toContain('update_campus_question')
    expect(available()).not.toContain('create_campus_course')
    expect(available()).toContain('check_campus_question_duplicate')
    expect(buildAgentSystemPrompt()).toContain('上传已关闭')

    setAgentPolicy({ campusUpload: true })
    expect(available()).toContain('save_campus_questions')
    expect(available()).not.toContain('update_campus_question')
    expect(buildAgentSystemPrompt()).toContain('批阅页明确公布的正确答案')

    setAgentPolicy({ campusUpload: false, campusEdit: true })
    expect(available()).not.toContain('save_campus_questions')
    expect(available()).toContain('update_campus_question')
    expect(available()).toContain('create_campus_course')
  })

  it('拦截直接调用已关闭的工具，包括旧对话中的调用', async () => {
    request.mockReset()
    setAgentPolicy({ campusUpload: false, campusEdit: false })
    expect(await dispatchCampusTool('save_campus_questions')).toMatchObject({ denied: true })
    expect(await dispatchCampusTool('update_campus_question')).toMatchObject({ denied: true })
    expect(await dispatchCampusTool('create_campus_course', { name: '测试课' })).toMatchObject({ denied: true })
    expect(request).not.toHaveBeenCalled()
  })

  it('只开上传时，缺失试卷不会被隐式创建', async () => {
    setAgentPolicy({ campusUpload: true, campusEdit: false })
    request.mockReset().mockResolvedValueOnce(verifiedCampus())
      .mockResolvedValueOnce(jsonResponse([{ ID: 7, Name: '劳动经济学' }]))
      .mockResolvedValueOnce(courseDetail())

    expect(await dispatchCampusTool('save_campus_questions', {
      course_id: 7, paper_name: '新试卷', create_paper: true,
      questions: [{ question: '题干', answer: '答案', question_type: '简答' }],
    })).toMatchObject({ error: expect.stringContaining('校验并修改校园题库') })
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
})
