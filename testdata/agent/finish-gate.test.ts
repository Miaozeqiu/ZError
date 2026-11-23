import { describe, expect, it, vi } from 'vitest'
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: () => 'https://academy.example/lesson' }))
vi.mock('../../src/services/platform/panelAccess', () => ({ videoWatchFor: () => null }))
import { collectFinishEvidence, judgeFinish } from '../../src/services/agent/finishGate'

describe('通用完成检查', () => {
  it('由模型结合仓库回执判断任务语义，宿主不按网站路径强制补读', () => {
    expect(judgeFinish('done','已核对本轮结果。',{ url:'https://academy.example/lesson', pageSummary:true })).toMatchObject({ok:true,status:'done'})
  })
  it('活动视频、未完成计划和未完成清单不能被普通 done 结束', () => {
    for (const evidence of [{playing:true},{watching:true},{planTotal:2,planDone:1},{todos:[{id:'one',text:'核对',status:'pending' as const}]}]) {
      expect(judgeFinish('done','已完成',evidence).ok).toBe(false)
    }
    expect(judgeFinish('watching','正在等待',{watching:true}).ok).toBe(true)
    expect(judgeFinish('watching','正在等待').ok).toBe(false)
  })
  it('明确阻塞、状态与摘要校验仍生效', () => {
    expect(judgeFinish('blocked','请核对登录账号。',{packagePending:true}).ok).toBe(true)
    expect(judgeFinish('done','').ok).toBe(false)
    expect(judgeFinish('invalid','摘要').ok).toBe(false)
    expect(judgeFinish('blocked','无').ok).toBe(false)
  })
  it('只读复核需要新证据，不能要求完成整站任务', () => {
    expect(judgeFinish('done','只读检查完毕',{reviewRequested:true}).ok).toBe(false)
    expect(judgeFinish('done','只读检查完毕',{reviewRequested:true,reviewObservationId:'new'}).ok).toBe(true)
  })
  it('只采纳当前标签、当前工具调用的工作流状态', async () => {
    const step = { id:'call',name:'browser_site_academy__study',status:'done',kind:'tool',result:JSON.stringify({ok:true,observation_id:'call',observed_browser_id:'tab',result:{workflowPending:true}}) } as any
    const evidence = await collectFinishEvidence('tab','chat',{steps:[step]})
    expect(evidence.packagePending).toBe(true)
    expect(judgeFinish('done','完成',evidence).ok).toBe(false)
    expect((await collectFinishEvidence('other','chat',{steps:[step]})).packagePending).toBe(false)
    step.result=JSON.stringify({ok:true,observation_id:'older',observed_browser_id:'tab',result:{workflowPending:true}})
    expect((await collectFinishEvidence('tab','chat',{steps:[step]})).packagePending).toBe(false)
  })
})
