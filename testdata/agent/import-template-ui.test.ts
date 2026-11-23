// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import AgentImportTemplateManager from '../../src/views/settings/AgentImportTemplateManager.vue'
import AgentImportTemplateOffer from '../../src/components/agent/AgentImportTemplateOffer.vue'
import AgentImportSettings from '../../src/views/settings/AgentImportSettings.vue'
import { respondImportTemplateOffer } from '../../src/services/agent/importTemplateOffers'
import { setImportTemplateSaveMode, deleteImportTemplate, updateImportTemplate } from '../../src/services/agent/importTemplates'
const api=vi.hoisted(()=>({settings:null as any}))
vi.mock('../../src/services/agent/importTemplateOffers',()=>({respondImportTemplateOffer:vi.fn(async()=>{})}))
vi.mock('../../src/services/agent/importTemplates',async()=>{
  const {reactive,computed}=await import('vue');api.settings=reactive({saveMode:'ask',templates:[]})
  return {importTemplateSettings:computed(()=>api.settings),setImportTemplateSaveMode:vi.fn(async value=>{api.settings.saveMode=value}),deleteImportTemplate:vi.fn(async id=>{api.settings.templates=api.settings.templates.filter((row:any)=>row.id!==id)}),updateImportTemplate:vi.fn(async(id,patch)=>{Object.assign(api.settings.templates.find((row:any)=>row.id===id),patch)})}
})
let app:App,root:HTMLDivElement
const template={id:'template',name:'编号题目',description:'题干和答案分段',extensions:['docx'],code:'return [];',createdAt:1,updatedAt:1}
beforeEach(()=>{vi.clearAllMocks();api.settings.saveMode='ask';api.settings.templates=[];root=document.createElement('div');document.body.append(root)})
afterEach(()=>{app.unmount();root.remove();document.querySelectorAll('[role=listbox]').forEach(item=>item.remove())})
for(const [label,choice] of [['不保存','skip'],['保存','save'],['下次不用问我','always']] as const) it(`对话卡片提供“${label}”并传递明确的用户选择`,async()=>{
  const offer=reactive({...template,id:'offer',status:'pending'})
  app=createApp({render:()=>h(AgentImportTemplateOffer,{sessionId:'s',messageId:'m',offer:offer as any})});app.mount(root)
  const input=root.querySelector('input')!;input.value='我的排版';input.dispatchEvent(new Event('input',{bubbles:true}))
  Array.from(root.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')===label)!.click();await nextTick()
  expect(respondImportTemplateOffer).toHaveBeenCalledWith('s','m','offer',choice,'我的排版')
  expect(Array.from(root.querySelectorAll('.option-letter'), item=>item.textContent)).toEqual(['A','B','C'])
  expect(root.querySelector('details')).toBeNull()
  expect(root.querySelector('.offer-help')).toBeNull()
})
it('已完成的保存卡片显示回执，不会再次出现选择按钮或执行脚本',async()=>{
  app=createApp({render:()=>h(AgentImportTemplateOffer,{sessionId:'s',messageId:'m',offer:{...template,id:'o',status:'saved'}})});app.mount(root)
  expect(root.textContent).toContain('已保存导入模板');expect(root.querySelectorAll('button')).toHaveLength(0)
})
it('设置只显示保存方式和算法管理两行，管理入口不展开代码',async()=>{
  api.settings.templates=[{...template}]
  const manage=vi.fn()
  app=createApp({render:()=>h(AgentImportSettings,{onManage:manage})});app.mount(root)
  expect(root.querySelectorAll('.setting-item')).toHaveLength(2)
  expect(root.querySelector('pre')).toBeNull()
  root.querySelector<HTMLButtonElement>('#agent-import-template-mode')!.click();await nextTick()
  Array.from(document.querySelectorAll<HTMLElement>('[role=option]')).find(option=>option.textContent?.includes('自动保存'))!.click();await vi.waitFor(()=>expect(setImportTemplateSaveMode).toHaveBeenCalledWith('auto'))
  root.querySelector<HTMLButtonElement>('.template-manage')!.click()
  expect(manage).toHaveBeenCalledOnce()
  expect(root.textContent).toContain('1 个模板')
})
const editor=()=>EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!
const switchMode=async(mode:string)=>{root.querySelector<HTMLInputElement>(`input[value="${mode}"]`)!.click();await nextTick()}
it('算法默认只读预览，编辑可修改代码和说明并保存，预览不丢失草稿',async()=>{
  api.settings.templates=[{...template}]
  app=createApp({render:()=>h(AgentImportTemplateManager)});app.mount(root)
  await vi.waitFor(()=>expect(editor().state.doc.toString()).toBe(template.code))
  expect(root.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
  await switchMode('edit')
  const input=root.querySelector<HTMLInputElement>('.template-meta input')!
  input.value='新的名称';input.dispatchEvent(new Event('input',{bubbles:true}))
  editor().dispatch({changes:{from:0,to:editor().state.doc.length,insert:'return document.lines;'}})
  await nextTick();await switchMode('preview')
  expect(editor().state.doc.toString()).toBe('return document.lines;')
  expect(root.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
  root.querySelector<HTMLButtonElement>('.save-button')!.click()
  await vi.waitFor(()=>expect(updateImportTemplate).toHaveBeenCalledWith('template',{name:'新的名称',description:template.description,code:'return document.lines;'}))
  await vi.waitFor(()=>expect(root.querySelector('[role=status]')?.textContent).toBe('已保存'))
  root.querySelector<HTMLButtonElement>('.template-delete')!.click();await vi.waitFor(()=>expect(deleteImportTemplate).toHaveBeenCalledWith('template'))
  expect(root.textContent).toContain('还没有保存的导入模板')
})
it('切换模板或返回时保护未保存修改，保存失败保留草稿和当前模板',async()=>{
  api.settings.templates=[{...template},{...template,id:'second',name:'另一个模板',code:'return [1];'}]
  const back=vi.fn()
  app=createApp({render:()=>h(AgentImportTemplateManager,{onBack:back})});app.mount(root)
  await switchMode('edit')
  editor().dispatch({changes:{from:0,to:editor().state.doc.length,insert:'return [;'}});await nextTick()
  root.querySelectorAll<HTMLButtonElement>('.template-entry')[1]!.click();await nextTick()
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
  vi.mocked(updateImportTemplate).mockRejectedValueOnce(new Error('算法语法错误'))
  document.querySelector<HTMLButtonElement>('.unsaved-panel .btn-confirm')!.click()
  await vi.waitFor(()=>expect(document.querySelector('.unsaved-error')?.textContent).toContain('语法错误'))
  expect(root.querySelector('.template-entry.active')?.textContent).toContain(template.name)
  expect(editor().state.doc.toString()).toBe('return [;')
  document.querySelector<HTMLButtonElement>('.unsaved-discard')!.click()
  await vi.waitFor(()=>expect(editor().state.doc.toString()).toBe('return [1];'))
  await switchMode('edit')
  expect(undo(editor())).toBe(false)
  expect(editor().state.doc.toString()).toBe('return [1];')
  root.querySelector<HTMLButtonElement>('.back-button')!.click()
  expect(back).toHaveBeenCalledOnce()
})
