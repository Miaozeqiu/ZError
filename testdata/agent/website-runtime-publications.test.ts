import { afterEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ documents: [] as any[], record: vi.fn(), url: 'https://academy.example/lesson' }))
vi.mock('../../src/services/browser/documents', async original => ({
  ...await original<typeof import('../../src/services/browser/documents')>(), browserDocuments: async () => ({ documents: io.documents }),
}))
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: () => io.url }))
vi.mock('../../src/services/app/auth', () => ({ authToken: {value:''}, authUser: {value:null} }))
vi.mock('../../src/services/agent/chatStore', () => ({ recordHomeworkProgress: io.record, liveSession: () => ({id:'chat'}) }))
import { registerWebsiteServices, executeWebsiteService } from '../../src/services/agent/websiteRuntime/services'
import { clearWebsiteObservation, currentWebsiteQuestions, publishWebsiteQuestions } from '../../src/services/agent/websiteRuntime/observations'
const document = {frameId:'paper',loaderId:'one',url:io.url}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); clearWebsiteObservation('tab') })
describe('仓库题目发布', () => {
  it('核对真实文档后发布题目，模型输出和历史作业不能触发当前页自动打开', async () => {
    const controller = new AbortController(), ctx = {sessionId:'chat',assistantId:'',abort:controller.signal} as any
    io.documents = [document]
    const service = registerWebsiteServices({ctx,browserId:'tab',host:'academy.example',owner:'source',signal:controller.signal,pause:()=>{},resume:()=>{}})
    const request = {document,assignmentId:'paper-1',total:1,phase:'read',questions:[]}
    const input = {service_scope:service.id,service_op:'questions.publish',request}
    try {
      await executeWebsiteService('browser_package_read',input,ctx,'tab')
      expect(io.record).toHaveBeenCalledOnce()
      expect(currentWebsiteQuestions('tab','chat',io.url)).toBe('paper-1')
      expect(currentWebsiteQuestions('tab','other',io.url)).toBeUndefined()
      expect(currentWebsiteQuestions('tab','chat',io.url+'/other')).toBeUndefined()
      io.documents = [{...document,loaderId:'two'}]
      await expect(executeWebsiteService('browser_package_read',input,ctx,'tab')).rejects.toThrow('文档已更换')
      expect(io.record).toHaveBeenCalledOnce()
    } finally { service.dispose() }
  })
  it('页面订阅清理和过期使自动显示状态失效，保存的历史作业不被当作新页面', () => {
    vi.useFakeTimers()
    publishWebsiteQuestions('tab','chat',io.url,'paper-1')
    expect(currentWebsiteQuestions('tab','chat',io.url)).toBe('paper-1')
    vi.advanceTimersByTime(15001)
    expect(currentWebsiteQuestions('tab','chat',io.url)).toBeUndefined()
    publishWebsiteQuestions('tab','chat',io.url,'paper-2')
    clearWebsiteObservation('tab')
    expect(currentWebsiteQuestions('tab','chat',io.url)).toBeUndefined()
  })
})
