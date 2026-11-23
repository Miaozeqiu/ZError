// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { EditorView } from '@codemirror/view'
import AgentImportSettings from '../../src/views/settings/AgentImportSettings.vue'
import AgentImportTemplateManager from '../../src/views/settings/AgentImportTemplateManager.vue'
import AgentImportTemplateOffer from '../../src/components/agent/AgentImportTemplateOffer.vue'
import { settingsManager } from '../../src/services/app/settings'
import { defaultQuestionImportSettings } from '../../src/services/agent/importTemplateTypes'
import { importTemplateSettings, updateImportTemplate } from '../../src/services/agent/importTemplates'
import { offerImportedTemplate } from '../../src/services/agent/importTemplateOffers'
import { fileImportToolHandlers } from '../../src/services/agent/toolHandlers/fileImport'
import { clearQuestionImportResults, stageQuestionImport } from '../../src/services/agent/questionImport'
const state=vi.hoisted(()=>({message:null as any,stored:null as any,fail:false}))
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async(name:string)=>name==='stat_local_file'?{size:100}:['1. 原文题目','【答案】A'])}))
vi.mock('../../src/services/security/secureStore',()=>({readSecureDocument:async()=>null,writeSecureDocument:async(_name:string,value:any)=>{
 if(state.fail)throw new Error('写入失败');state.stored=JSON.parse(JSON.stringify(value));return state.stored
}}))
vi.mock('../../src/services/agent/chatStore',()=>({liveSession:()=>({messages:[state.message]}),patchMessage:(_s:string,_m:string,patch:any)=>Object.assign(state.message,patch),flushChatCheckpoint:async()=>{}}))
let app:App,root:HTMLElement
const source={name:'题号与答案段落',description:'编号题干和独立答案',extensions:['docx'],code:'return [{question:"题",answer:"A"}];'}
beforeEach(async()=>{
 state.fail=false;await settingsManager.ready
 await settingsManager.commit(draft=>{draft.questionImport=defaultQuestionImportSettings()})
 const {reactive}=await import('vue');state.message=reactive({id:'assistant',importTemplateOffers:[]})
 root=document.createElement('div');document.body.append(root)
})
afterEach(()=>{app?.unmount();root.remove();clearQuestionImportResults('refresh')})
it('聊天卡片保存成功后，已打开的设置计数和管理列表立即刷新，且真正持久化',async()=>{
 await offerImportedTemplate('refresh','assistant','result',source)
 app=createApp({render:()=>h('div',[h(AgentImportSettings),h(AgentImportTemplateManager),h(AgentImportTemplateOffer,{sessionId:'refresh',messageId:'assistant',offer:state.message.importTemplateOffers[0]})])});app.mount(root)
 expect(root.querySelector('.template-manage')?.textContent).toContain('0 个模板')
 Array.from(root.querySelectorAll<HTMLButtonElement>('.template-offer button')).find(button=>button.getAttribute('aria-label')==='保存')!.click()
 await vi.waitFor(()=>expect(root.querySelector('.template-manage')?.textContent).toContain('1 个模板'))
 expect(root.querySelector('.template-entry')?.textContent).toContain(source.name)
 expect(state.stored.questionImport.templates[0].code).toBe(source.code)
 expect(root.querySelector('.template-offer')?.textContent).toContain('已保存导入模板')
})
it('只保存算法的工具返回真实保存回执并刷新设置，不新增题目；失败不报成功',async()=>{
 app=createApp({render:()=>h(AgentImportSettings)});app.mount(root)
 const result=stageQuestionImport('refresh',[{question:'已核对题',answer:'B'}],source)
 const args={result_id:result.result_id}
 const ctx={sessionId:'refresh',abort:new AbortController().signal} as any
 state.fail=true
 await expect(fileImportToolHandlers.save_import_template!({args,ctx,call:{} as any})).rejects.toThrow('写入失败')
 expect(root.querySelector('.template-manage')?.textContent).toContain('0 个模板')
 state.fail=false
 const saved=JSON.parse(await fileImportToolHandlers.save_import_template!({args,ctx,call:{} as any}))
 await nextTick()
 expect(saved).toMatchObject({saved:true,verified_questions:1,name:source.name})
 expect(root.querySelector('.template-manage')?.textContent).toContain('1 个模板')
 expect(state.stored.questionImport.saveMode).toBe('ask')
})
it('其他入口更新同一模板时刷新预览，但不覆盖用户未保存的草稿',async()=>{
 const {saveImportTemplate}=await import('../../src/services/agent/importTemplates')
 const template=(await saveImportTemplate(source))!
 app=createApp({render:()=>h(AgentImportTemplateManager)});app.mount(root)
 await updateImportTemplate(template.id,{name:'外部更新',description:'新排版',code:'return [1];'})
 await nextTick()
 expect(root.querySelector('.template-meta h3')?.textContent).toBe('外部更新')
 const editor=()=>EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!
 expect(editor().state.doc.toString()).toBe('return [1];')
 root.querySelector<HTMLInputElement>('input[value=edit]')!.click();await nextTick()
 const input=root.querySelector<HTMLInputElement>('.template-meta input')!
 input.value='本地草稿';input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick()
 await updateImportTemplate(template.id,{name:'另一次更新',description:'另一说明'})
 await nextTick()
 expect(input.value).toBe('本地草稿')
 expect(importTemplateSettings.value.templates[0]?.name).toBe('另一次更新')
})
it('文件概况只携带有界的模板摘要，不把算法源码带入模型上下文',async()=>{
 app=createApp({render:()=>h(AgentImportSettings)});app.mount(root)
 const {saveImportTemplate}=await import('../../src/services/agent/importTemplates')
 for(let index=0;index<6;index++) await saveImportTemplate({...source,name:`排版${index}`,code:`${source.code} // ${index}`})
 const ctx={attachment:()=>null} as any
 const info=JSON.parse(await fileImportToolHandlers.get_file_info!({args:{path:'/tmp/摘要.docx'},ctx,call:{} as any}))
 expect(info.import_templates.total).toBe(6)
 expect(info.import_templates.templates).toHaveLength(5)
 expect(info.import_templates.templates.every((item:any)=>!('code' in item))).toBe(true)
 expect(JSON.stringify(info).length).toBeLessThan(3000)
})
