import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateExportData } from '../../src/utils/question/exporter'
import { parseSoftwareExportedFile } from '../../src/utils/question/importer'
import { gradeQuiz, nextMastery, parseQuizCards } from '../../src/utils/question/quizPractice'
import { classifyQuestionStats } from '../../src/utils/study/studyDataStats'
import type { AIResponse } from '../../src/services/app/database/types'
const files=vi.hoisted(()=>new Map<string,Uint8Array>())
vi.mock('@tauri-apps/plugin-fs',()=>({readFile:vi.fn(async(path:string)=>{const bytes=files.get(path);if(!bytes)throw new Error('Not found');return bytes})}))
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}))
const question:AIResponse={id:1,folder_id:1,question:'题干包含逗号,和“中文”以及"引号"\n第二行',options:'A. 甲,乙\nB. 丙"丁"',answer:'B',question_type:'单选题',importance:2,mastery:1,difficulty:3,create_time:'2026-01-01T00:00:00Z'}
beforeEach(()=>files.clear())
describe('user data round trip and practice outcomes',()=>{
  for(const format of ['csv','xlsx','txt'] as const) it(`${format} export and re-import preserve multiline Unicode questions, options and metrics`,async()=>{
    const bytes=await generateExportData([question],format);files.set(`fixture.${format}`,bytes)
    const imported=await parseSoftwareExportedFile(`fixture.${format}`)
    expect(imported).toEqual([expect.objectContaining({question:question.question,options:question.options,answer:'B',question_type:'单选题',importance:2,mastery:1,difficulty:3})])
  })
  it('handles Windows line endings and literal quote characters in a quoted field',async()=>{
    const special={...question,question:'"原样保留"\r\n第二行',options:'A. 甲\r\nB. 乙'}
    files.set('windows.csv',await generateExportData([special],'csv'))
    expect(await parseSoftwareExportedFile('windows.csv')).toEqual([expect.objectContaining({question:special.question,options:special.options})])
  })
  it('imports an empty export without inventing a question and rejects unsupported formats',async()=>{
    files.set('empty.csv',await generateExportData([],'csv'));expect(await parseSoftwareExportedFile('empty.csv')).toEqual([])
    await expect(parseSoftwareExportedFile('fixture.unknown')).rejects.toThrow('不支持')
  })
  it('does not silently import a truncated CSV quoted field',async()=>{
    files.set('broken.csv',new TextEncoder().encode('ID,题目,选项,答案,类型\n1,"unfinished,,A,单选题'))
    await expect(parseSoftwareExportedFile('broken.csv')).rejects.toThrow()
  })
  it('grades multiple choices independent of order and does not accept an incomplete selection',()=>{
    expect(gradeQuiz(['C','A'],'AC','多选题','A. 甲\nB. 乙\nC. 丙')).toBe(true)
    expect(gradeQuiz(['A'],'AC','多选题','A. 甲\nB. 乙\nC. 丙')).toBe(false)
    expect(gradeQuiz(['A'],'','单选题','A. 甲\nB. 乙')).toBe(false)
    expect(nextMastery(3,false)).toBe(1);expect(nextMastery(1,true)).toBe(2)
  })
  it('keeps question identity in practice cards and distinguishes corrected questions from always correct ones',()=>{
    expect(parseQuizCards([{question_id:42,question:'题目',answer:'A',options:'A. 甲\nB. 乙'}])[0].question_id).toBe(42)
    expect(classifyQuestionStats([{question_id:1,attempted:2,last_correct:true,ever_wrong:true},{question_id:2,attempted:1,last_correct:false,ever_wrong:true},{question_id:3,attempted:1,last_correct:true,ever_wrong:false}] as any)).toEqual({practiced:3,correct:1,wrong:1,corrected:1})
  })
})
