import { describe, expect, it, vi } from 'vitest'
import { executeWebsitePackage, type WebsiteHost } from '../../src/services/agent/websiteRuntime/execute'
import { isWebsiteRuntimeToolName, validateWebsiteRuntime, validateWebsiteValue, websiteToolName } from '../../src/services/agent/websiteRuntime/protocol'
import { objectSchema, runtimeBinding, runtimeFixture } from './fixtures/websiteRuntime'

const host = (signal = new AbortController().signal): WebsiteHost => ({
  signal, browserId:'tab', readOnly:()=>false, isActive:()=>true,
  currentUrl:async ()=>'https://academy.example/courses',
  invoke:vi.fn(async ()=>({ok:true,title:'示例课程'})), waitForPage:vi.fn(async ()=>({ok:true,event:'page.loaded'})), delay:vi.fn(async ()=>{}),
})
const code = (body: string) => `var ZErrorSitePackage = { *create({args}) { ${body} } };`
describe('网站运行包 API 2',()=>{
  it('只有实际网页读取才产生宿主观察证据，操作后需要重新读取', async () => {
    for (const [body, observed] of [
      ["return {title:'done'};", false],
      ["yield {op:'browser.observe',args:{}};return {title:'done'};", true],
      ["yield {op:'browser.observe',args:{}};yield {op:'browser.click',args:{ref:'e1'}};return {title:'done'};", false],
      ["yield {op:'browser.click',args:{ref:'e1'}};yield {op:'browser.observe',args:{}};return {title:'done'};", true],
    ] as const) {
      const runtime = runtimeFixture(code(body))
      runtime.tools[0].commands = ['browser.observe', 'browser.click']
      const io = host(); io.invoke = vi.fn(async () => ({ ok: true, snapshot: '当前网页' }))
      expect(await executeWebsitePackage(runtimeBinding(runtime), {}, io)).toMatchObject({ observed })
    }
  })
  it('执行第三方包的编译产物并通过宿主读取页面',async()=>{
    const runtime = validateWebsiteRuntime(runtimeFixture(),'academy')
    expect(websiteToolName('academy','read_catalog')).toBe('browser_site_academy__read_catalog')
    expect(isWebsiteRuntimeToolName('browser_site_academy__read_catalog')).toBe(true)
    expect(isWebsiteRuntimeToolName('browser_site_graph')).toBe(false)
    const io = host()
    expect(await executeWebsitePackage(runtimeBinding(runtime),{},io)).toMatchObject({ok:true,repository:{id:'academy'},result:{title:'示例课程'}})
    expect(io.invoke).toHaveBeenCalledExactlyOnceWith('browser_get_page',{})
  })
  it('隔离编译脚本，限制 CPU 并验证产物哈希',async()=>{
    const runtime = runtimeFixture(code('while(true) {}'))
    await expect(executeWebsitePackage(runtimeBinding(runtime),{},host())).rejects.toThrow(/超时/)
    runtime.bundle.code += ' '
    await expect(executeWebsitePackage(runtimeBinding(runtime),{},host())).rejects.toThrow(/哈希/)
    await expect(executeWebsitePackage(runtimeBinding(runtimeFixture(code("return {title:typeof process + ':' + typeof fetch + ':' + typeof window};"))),{},host()))
      .resolves.toMatchObject({result:{title:'undefined:undefined:undefined'}})
  })
  it('拒绝不兼容 API、重名、未知 schema 和伪装的跨包名称',()=>{
    expect(()=>validateWebsiteRuntime({...runtimeFixture(),apiVersion:99},'academy')).toThrow()
    const runtime = runtimeFixture()
    runtime.tools.push(runtime.tools[0])
    expect(()=>validateWebsiteRuntime(runtime,'academy')).toThrow(/重名/)
    const invalid=runtimeFixture();invalid.tools[0].parameters=objectSchema({value:{$ref:'file:///secret'}})
    expect(()=>validateWebsiteRuntime(invalid,'academy')).toThrow(/schema/)
    expect(()=>websiteToolName('academy','../browser_click')).toThrow()
    expect(()=>validateWebsiteValue({value:1},objectSchema({value:{type:'null'}}),'数据')).toThrow()
    expect(()=>validateWebsiteValue(JSON.parse('{"__proto__":{"ref":"other"}}'),objectSchema(),'数据')).toThrow()
    expect(()=>validateWebsiteValue({},objectSchema({constructor:{type:'string'}}),'数据')).toThrow()
  })
  it('在执行前拒绝未声明能力、越界参数和跨域操作',async()=>{
    for(const body of [
      "yield {op:'secure_read',args:{}};",
      "yield {op:'browser.observe',args:{browserId:'other'}};",
      "yield {op:'browser.navigate',args:{url:'https://other.example/'}};",
    ]){
      const runtime=runtimeFixture(code(body));runtime.tools[0].commands=['browser.observe','browser.navigate']
      const io=host()
      await expect(executeWebsitePackage(runtimeBinding(runtime),{},io)).rejects.toThrow()
      expect(io.invoke).not.toHaveBeenCalled()
    }
  })
  it('按实际命令实施只读限制，包无法把点击声明成只读',async()=>{
    const runtime=runtimeFixture(code("yield {op:'browser.click',args:{ref:'e1'}};"))
    runtime.tools[0].commands=['browser.click']
    const io=host();io.readOnly=()=>true
    await expect(executeWebsitePackage(runtimeBinding(runtime),{},io)).rejects.toThrow(/只允许/)
    expect(io.invoke).not.toHaveBeenCalled()
  })
  it('固定执行版本，更新当前对象也不改变运行中的代码',async()=>{
    const runtime=runtimeFixture();const original=runtime.bundle.sha256
    const io=host()
    io.invoke=vi.fn(async()=>{
      runtime.bundle.code=code("return {title:'新版本'};")
      runtime.bundle.sha256='b'.repeat(64)
      return {title:'原任务'}
    })
    expect(await executeWebsitePackage(runtimeBinding(runtime),{},io)).toMatchObject({repository:{sha256:original},result:{title:'原任务'}})
  })
  it('从显式检查点重新进入状态机，读到实际页面之前不能操作或直接完成',async()=>{
    const runtime=runtimeFixture("var ZErrorSitePackage={*create({resume}){const page=yield {op:'browser.observe',args:{}};return {title:resume.state.phase+':'+page.title};}};")
    const observed=host();observed.invoke=vi.fn(async()=>({ok:true,title:'示例课程',snapshot:'当前实际页面'}))
    expect(await executeWebsitePackage(runtimeBinding(runtime),{},observed,{state:{phase:'核对'}})).toMatchObject({result:{title:'核对:示例课程'}})
    const failed=host();failed.invoke=vi.fn(async()=>({error:'页面读取失败'}))
    await expect(executeWebsitePackage(runtimeBinding(runtime),{},failed,{state:{phase:'核对'}})).rejects.toThrow('必须先核对')
    for(const body of ["yield {op:'browser.click',args:{ref:'e1'}};", "return {title:'完成'};", "yield {op:'workflow.checkpoint',args:{state:{phase:'done'}}};"]){
      const invalid=runtimeFixture(code(body));invalid.tools[0].commands=['browser.click','workflow.checkpoint']
      const io=host();io.checkpoint=vi.fn(async()=>({ok:true}))
      await expect(executeWebsitePackage(runtimeBinding(invalid),{},io,{state:{phase:'pending'}})).rejects.toThrow(/恢复/)
      expect(io.invoke).not.toHaveBeenCalled();expect(io.checkpoint).not.toHaveBeenCalled()
    }
  })
  it('原生请求未返回时取消也会退出沙箱，晚到的结果不会恢复流程',async()=>{
    const control=new AbortController(), io=host(control.signal)
    let reply!: (value:Record<string,unknown>)=>void
    io.invoke=vi.fn(()=>new Promise(resolve=>{reply=resolve}))
    const pending=executeWebsitePackage(runtimeBinding(),{},io)
    await vi.waitFor(()=>expect(io.invoke).toHaveBeenCalledOnce())
    const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'})
    control.abort()
    await rejected
    reply({title:'晚到的数据'})
    await Promise.resolve()
    expect(io.invoke).toHaveBeenCalledOnce()
  })
  it('卸载或取消后不再执行下一条命令，也不重放前面的动作',async()=>{
    const runtime=runtimeFixture(code("yield {op:'browser.observe',args:{}}; yield {op:'browser.observe',args:{}}; return {title:'完成'};"))
    for(const cancel of ['uninstall','abort']){
      let active=true;const control=new AbortController();const io=host(control.signal)
      io.isActive=()=>active
      io.invoke=vi.fn(async()=>{if(cancel==='abort')control.abort();else active=false;return {title:'旧页'}})
      await expect(executeWebsitePackage(runtimeBinding(runtime),{},io)).rejects.toThrow()
      expect(io.invoke).toHaveBeenCalledTimes(1)
    }
  })
  it('拒绝越界页面、重定向后的数据和不符合结果 schema 的回执',async()=>{
    const io=host();io.currentUrl=async()=>'https://other.example/'
    await expect(executeWebsitePackage(runtimeBinding(),{},io)).rejects.toThrow(/域名范围/)
    expect(io.invoke).not.toHaveBeenCalled()
    const redirected=host()
    redirected.currentUrl=vi.fn().mockResolvedValueOnce('https://academy.example/').mockResolvedValue('https://other.example/')
    await expect(executeWebsitePackage(runtimeBinding(),{},redirected)).rejects.toThrow(/域名范围/)
    expect(redirected.invoke).toHaveBeenCalledOnce()
    const bad=host();bad.invoke=async()=>({title:1})
    await expect(executeWebsitePackage(runtimeBinding(),{},bad)).rejects.toThrow(/结果无效/)
  })
})
