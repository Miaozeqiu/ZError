vi.mock('../../src/services/agent/importTemplateOffers',()=>({offerImportedTemplate:vi.fn(async()=>({status:'disabled'}))}))
import { saveQuestions } from '../../src/services/agent/quizTools'
import { getQuickJS } from '../../src/services/script/quickjs'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { fileImportToolHandlers } from '../../src/services/agent/toolHandlers/fileImport'
import { clearFileCaches } from '../../src/services/agent/import'
import { clearQuestionImportResults, questionImportResult, stageQuestionImport } from '../../src/services/agent/questionImport'
import { databaseService } from '../../src/services/app/database'
import { associateQuestionsToKnowledge } from '../../src/services/study/questionKnowledge'
import { validateToolCall } from '../../src/services/agent/core/tools'
import { FOLDER_QUESTION_TOOLS } from '../../src/services/agent/toolDefs/folderQuestionTools'
import { PRACTICE_QUIZ_TOOLS } from '../../src/services/agent/toolDefs/practiceQuizTools'
import type { ChatToolContext } from '../../src/services/agent/toolContext'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../src/services/app/database', () => ({ databaseService: { addQuestion: vi.fn(), getFolders: vi.fn() } }))
vi.mock('../../src/services/study/questionKnowledge', () => ({ associateQuestionsToKnowledge: vi.fn() }))
const script = readFileSync('testdata/agent/fixtures/questionDocumentScript.js', 'utf8')
let rows: any[] = []
let failAt = Infinity
let afterSave: (()=>void) | undefined
const paragraphs = ['题库概览', ...Array.from({ length: 225 }, (_, i) => [`${i + 1}. 测试题目${i+1}？`, 'A. 甲', 'B. 乙✓', '【答案】B【解析】依据原文']).flat()]
const context = (signal = new AbortController().signal): ChatToolContext => ({
  sessionId: 'import-test', assistantId: 'test-message', abort: signal,
  browserId: () => '', attachment: () => ({ kind: 'file', filePath: 'fixture.docx', fileName: 'fixture.docx', folderId: 7 }),
  folders: () => [], studySubjectId: () => undefined,
  setStudySubject: vi.fn(), markDrawingGraph: vi.fn(), scheduleEval: vi.fn(),
})
const call = async (name: string, args: object, ctx = context()) => JSON.parse(await fileImportToolHandlers[name]({ call: { name, arguments: JSON.stringify(args) } as any, args, ctx }))
beforeAll(async () => { await getQuickJS() })
beforeEach(() => {
  clearFileCaches(); clearQuestionImportResults('import-test'); rows = []; failAt = Infinity; afterSave = undefined
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, public detail?: any) {} })
  vi.mocked(invoke).mockImplementation(async (name, args: any) => name === 'stat_local_file' ? { size: 84000 } as any : paragraphs.slice(args.start, args.end + 1) as any)
  vi.mocked(databaseService.getFolders).mockResolvedValue([{ id: 7, name: '目标文件夹' }] as any)
  vi.mocked(databaseService.addQuestion).mockImplementation(async item => {
    if (rows.length === failAt) throw new Error('测试写入失败')
    const row = { ...item, id: rows.length + 1 }; rows.push(row); afterSave?.(); return row as any
  })
  vi.mocked(associateQuestionsToKnowledge).mockReset().mockResolvedValue({ linked: 0, created: 0, skipped: 0, links: [] })
})
describe('文件 → Agent 脚本或逐批工具 → 题库', () => {
  it('注册真实可调用的脚本/批量工具，schema 拦截超批量', () => {
    const registry = [...FOLDER_QUESTION_TOOLS, ...PRACTICE_QUIZ_TOOLS]
    expect(validateToolCall(registry, { name:'run_file_script', arguments:JSON.stringify({ code:script }) } as any)).toBeUndefined()
    expect(validateToolCall(registry, { name:'save_questions', arguments:'{"result_id":"opaque-id"}' } as any)).toBeUndefined()
    expect(validateToolCall(registry, { name:'save_questions', arguments:JSON.stringify({ questions:Array(21).fill({question:'题',answer:'A'}) }) } as any)).toContain('数量超出')
  })
  it('脚本解析全部 225 题，回执不含全文；核对后实际保存，再调用不重复写入', async () => {
    expect(await call('get_file_info', {})).toMatchObject({ total: paragraphs.length })
    expect(await call('read_range', { start: 0, end: 8 })).toMatchObject({ start:0, hasMore:true })
    const parsed = await call('run_file_script', { code: script })
    expect(parsed).toMatchObject({ count:225, saved:0, missing_answers:0 })
    expect(parsed.preview).toHaveLength(2); expect(JSON.stringify(parsed).length).toBeLessThan(2000)
    expect(rows).toHaveLength(0)
    const result = await call('save_questions', { result_id: parsed.result_id })
    expect(result).toMatchObject({ saved:225, total_saved:225, remaining:0, complete:true, folderId:7 })
    expect(rows).toHaveLength(225)
    expect(rows[224]).toMatchObject({ content:'测试题目225？', options:'A. 甲\nB. 乙', answer:'B', folderId:7 })
    expect(await call('save_questions', { result_id: parsed.result_id })).toMatchObject({ saved:0, total_saved:225, complete:true })
    expect(rows).toHaveLength(225)
  })
  it('分段识题后多批保存，同样只写入有效的指定目标', async () => {
    const items = Array.from({ length:43 }, (_, i) => ({ question:`批次题${i}`, answer: i === 0 ? '' : 'A' }))
    for (let i=0;i<items.length;i+=20) expect((await call('save_questions', { questions:items.slice(i,i+20),folder_id:7 })).complete).toBe(true)
    expect(rows).toHaveLength(43); expect(rows[0].answer).toBe('')
    await expect(call('save_questions', { questions:[{question:'新题',answer:'A'}],folder_id:99 })).rejects.toThrow('找不到目标')
    expect(rows).toHaveLength(43)
  })
  it('验证失败不丢弃坏题后假报成功，也不静默导入前 20 道', async () => {
    await expect(call('save_questions', { questions:[{question:'好题',answer:'A'}, {question:'缺答案字段'}] })).rejects.toThrow('第 2')
    await expect(call('save_questions', { questions:Array(21).fill({question:'题',answer:'A'}) })).rejects.toThrow('1–20')
    await expect(call('save_questions', {})).rejects.toThrow('只能提供一个')
    await expect(call('run_file_script', { code:'return []' })).rejects.toThrow('数组')
    expect(rows).toHaveLength(0)
  })
  it('数据库中途失败明确回报已保存数，同一结果续传不会重复', async () => {
    const parsed = await call('run_file_script', { code:script }); failAt = 41
    expect(await call('save_questions', { result_id:parsed.result_id })).toMatchObject({ saved:41,total_saved:41,remaining:184,complete:false,error:'测试写入失败' })
    failAt = Infinity
    expect(await call('save_questions', { result_id:parsed.result_id })).toMatchObject({ saved:184,total_saved:225,complete:true })
    expect(new Set(rows.map(row=>row.content)).size).toBe(225)
  })
  it('取消保存后保留真实进度，可用新请求继续', async () => {
    const parsed = await call('run_file_script', { code:script }); const controller = new AbortController()
    afterSave = () => { if (rows.length === 9) controller.abort() }
    expect(await call('save_questions', { result_id:parsed.result_id }, context(controller.signal))).toMatchObject({ total_saved:9,complete:false,error:'导入已停止' })
    afterSave = undefined
    expect(await call('save_questions', { result_id:parsed.result_id })).toMatchObject({ saved:216,total_saved:225,complete:true })
  })
  it('图谱关联失败不重导已经入库的题目；跨会话和重复并发调用被拒绝', async () => {
    const parsed = await call('run_file_script', { code:script })
    expect(() => questionImportResult('another-session', parsed.result_id)).toThrow('不属于当前对话')
    vi.mocked(associateQuestionsToKnowledge).mockRejectedValueOnce(new Error('关联暂不可用'))
    const saving = call('save_questions', { result_id:parsed.result_id })
    await expect(call('save_questions', { result_id:parsed.result_id })).rejects.toThrow('正在保存')
    expect(await saving).toMatchObject({ saved:225,complete:true,warning:expect.stringContaining('关联失败') })
    expect(await call('save_questions', { result_id:parsed.result_id })).toMatchObject({ saved:0,complete:true })
  })
  it('普通出题流程仍抛出保存错误，不把失败的题目当作已保存', async () => {
    failAt=0
    await expect(saveQuestions([{question:'练习题',answer:'A'}],7)).rejects.toThrow('测试写入失败')
    expect(rows).toHaveLength(0)
  })
  it('待保存结果容量有界，清理后释放；禁止改目标续传', async () => {
    const ids = Array.from({ length:8 }, () => stageQuestionImport('import-test', [{question:'题目',answer:'A'}]).result_id)
    expect(() => stageQuestionImport('import-test', [{question:'题目',answer:'A'}])).toThrow('结果过多')
    await call('save_questions', {result_id:ids[0]})
    vi.mocked(databaseService.getFolders).mockResolvedValue([{id:8,name:'另一个文件夹'}] as any)
    await expect(call('save_questions',{result_id:ids[0],folder_id:8})).rejects.toThrow('绑定原文件夹')
    clearQuestionImportResults('import-test')
    expect(() => questionImportResult('import-test', ids[0])).toThrow('不存在')
  })
})

it('没有关联目标时要求 Agent 自行查看和创建本地目录，不静默写入默认目录',async()=>{
  const ctx=context();ctx.attachment=()=>({kind:'file',fileName:'fixture.docx',filePath:'fixture.docx'})
  await expect(call('save_questions',{questions:[{question:'题目',answer:'A'}]},ctx)).rejects.toThrow('自行选择目标')
  expect(rows).toHaveLength(0)
})

it('脚本解析或部分写入时不出现模板保存选择，实际完整入库后只提出一次',async()=>{
  const {offerImportedTemplate}=await import('../../src/services/agent/importTemplateOffers')
  vi.mocked(offerImportedTemplate).mockClear()
  const parsed=await call('run_file_script',{code:script,template_name:'编号题目',template_description:'按题号和答案段落提取'})
  expect(offerImportedTemplate).not.toHaveBeenCalled()
  failAt=10
  await call('save_questions',{result_id:parsed.result_id})
  expect(offerImportedTemplate).not.toHaveBeenCalled()
  failAt=Infinity
  await call('save_questions',{result_id:parsed.result_id})
  expect(offerImportedTemplate).toHaveBeenCalledExactlyOnceWith('import-test','test-message',parsed.result_id,expect.objectContaining({code:script,name:'编号题目',extensions:['docx']}))
  await call('save_questions',{result_id:parsed.result_id});expect(offerImportedTemplate).toHaveBeenCalledOnce()
})

it('已保存模板可以按引用执行，先校验适用格式再解析，不能混传 code',async()=>{
  const templates=await import('../../src/services/agent/importTemplates')
  const get=vi.spyOn(templates,'getImportTemplate').mockResolvedValue({id:'saved-parser',name:'已保存排版',description:'编号与答案段落',extensions:['docx'],code:script,createdAt:1,updatedAt:1})
  try {
    const parsed=await call('run_file_script',{template_id:'saved-parser'})
    expect(parsed.count).toBe(225)
    expect(questionImportResult('import-test',parsed.result_id).source).toMatchObject({templateId:'saved-parser',code:script})
    await expect(call('run_file_script',{template_id:'saved-parser',code:script})).rejects.toThrow('只能提供一个')
    await expect(call('run_file_script',{template_id:'saved-parser',path:'other.csv'})).rejects.toThrow('不适用于')
  } finally { get.mockRestore() }
})
