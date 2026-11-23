import { expect, it } from 'vitest'
import { validateWebsiteTools } from '../../src/services/agent/websiteToolDefinitions'
import { websiteRuntimeTools } from '../../src/services/agent/websiteRuntime/protocol'
import { runtimeFixture } from './fixtures/websiteRuntime'
const sorted=(value:any):any=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value
it('原生持久化调整对象键顺序后，等价工具定义仍有效',()=>{
  const runtime=runtimeFixture(),tools=websiteRuntimeTools('academy',runtime)
  expect(validateWebsiteTools('academy.example',sorted(tools),sorted(runtime),'academy')).toEqual(tools)
  const changed=sorted(tools);changed[0].function.name='untrusted_tool'
  expect(()=>validateWebsiteTools('academy.example',changed,runtime,'academy')).toThrow('不一致')
})
