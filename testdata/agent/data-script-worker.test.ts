import { afterEach, describe, expect, it, vi } from 'vitest'
import { runDataScript } from '../../src/services/script/dataScript'
const workers: FakeWorker[] = []
class FakeWorker {
  onmessage?: (event:any)=>void
  onerror?: ()=>void
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { workers.push(this) }
}
afterEach(() => { workers.length=0; vi.unstubAllGlobals(); vi.useRealTimers() })
describe('独立脚本执行环境生命周期', () => {
  it('正常完成和错误都销毁 Worker，不残留后台执行环境', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const first = runDataScript('return []', {})
    workers[0].onmessage!({ data:{ ok:true,value:[] } })
    expect(await first).toEqual([]); expect(workers[0].terminate).toHaveBeenCalledOnce()
    const second = runDataScript('broken', {})
    workers[1].onmessage!({ data:{ ok:false,error:'解析失败' } })
    await expect(second).rejects.toThrow('解析失败'); expect(workers[1].terminate).toHaveBeenCalledOnce()
  })
  it('取消无需等待执行线程回应，且晚到消息不会恢复脚本', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController()
    const task = runDataScript('while(true){}', {}, controller.signal)
    const rejected = expect(task).rejects.toMatchObject({ name:'AbortError' })
    controller.abort(); workers[0].onmessage!({ data:{ok:true,value:'late'} })
    await rejected; expect(workers[0].terminate).toHaveBeenCalledOnce()
  })
  it('初始化卡住或无结果时硬超时销毁 Worker', async () => {
    vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers()
    const task = runDataScript('while(true){}', {})
    const rejected = expect(task).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(5000)
    await rejected; expect(workers[0].terminate).toHaveBeenCalledOnce()
  })
})
