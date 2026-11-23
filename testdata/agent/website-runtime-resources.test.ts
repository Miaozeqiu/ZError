import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { runtimeBinding, runtimeFixture } from './fixtures/websiteRuntime'
import { validateWebsiteRuntime, verifyWebsiteRuntime } from '../../src/services/agent/websiteRuntime/protocol'
import { executeWebsitePackage } from '../../src/services/agent/websiteRuntime/execute'
const resource = (text: string) => ({ id: 'reference', size: Buffer.byteLength(text), data: Buffer.from(text).toString('base64'), sha256: createHash('sha256').update(text).digest('hex') })
it('资源随运行包校验并绑定，按小块读取，不提供额外文件或网络入口', async () => {
  const runtime = runtimeFixture("var ZErrorSitePackage={*create(){const row=yield {op:'resource.read',args:{id:'reference',offset:2,length:3}};return {title:String.fromCharCode(...row.bytes)};}};")
  runtime.tools[0].commands = ['resource.read']; runtime.resources = [resource('fixture')]
  const checked = validateWebsiteRuntime(runtime, 'academy')
  await verifyWebsiteRuntime(checked)
  const invoke = vi.fn(), currentUrl = vi.fn(async () => { throw new Error('resource reads must not access the tab') })
  const result = await executeWebsitePackage(runtimeBinding(checked), {}, {
    signal: new AbortController().signal, browserId: 'tab', isActive: () => true, readOnly: () => true, currentUrl,
    invoke, delay: async () => {}, waitForPage: async () => ({}),
  })
  expect(result).toMatchObject({ result: { title: 'xtu' }, observed: false })
  expect(invoke).not.toHaveBeenCalled()
  expect(currentUrl).not.toHaveBeenCalled()
  checked.resources![0].data = Buffer.from('altered').toString('base64')
  await expect(verifyWebsiteRuntime(checked)).rejects.toThrow('哈希')
})
it('拒绝重复资源、无效编码和超过总容量的内容', () => {
  const runtime = runtimeFixture(), asset = resource('data')
  for (const resources of [[asset, asset], [{ ...asset, data: 'not-base64' }], [{ ...asset, size: 1024 * 1024 + 1 }]]) {
    expect(() => validateWebsiteRuntime({ ...runtime, resources }, 'academy')).toThrow('资源')
  }
})

it('公共资源读取不构成网页观察，不能绕过跨域与恢复前写入校验', async () => {
  const prefix="const row=yield {op:'resource.read',args:{id:'reference',offset:0,length:3}};"
  for (const resume of [false,true]) {
    const command = resume ? "yield {op:'browser.fill',args:{ref:'e1',text:'fixture'}};" : "yield {op:'browser.observe',args:{}};"
    const runtime=runtimeFixture("var ZErrorSitePackage={*create(){"+prefix+command+"return {title:'done'};}};")
    runtime.resources=[resource('public-reference')]
    runtime.tools[0].commands=['resource.read',resume?'browser.fill':'browser.observe']
    const invoke=vi.fn()
    await expect(executeWebsitePackage(runtimeBinding(runtime),{}, {
      signal:new AbortController().signal,browserId:'tab',isActive:()=>true,readOnly:()=>false,
      currentUrl:async()=>resume?'https://academy.example/':'https://other.example/',invoke,delay:async()=>{},waitForPage:async()=>({}),
    },resume?{requiresObservation:true}:undefined)).rejects.toThrow(resume?'恢复后先读取':'域名范围')
    expect(invoke).not.toHaveBeenCalled()
  }
})
