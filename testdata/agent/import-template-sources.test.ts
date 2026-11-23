import { beforeEach, expect, it, vi } from 'vitest'
import { verifiedImportTemplateSource } from '../../src/services/agent/importTemplateSources'
import { clearQuestionImportResults, stageQuestionImport } from '../../src/services/agent/questionImport'
const state=vi.hoisted(()=>({session:null as any}))
vi.mock('../../src/services/agent/chatStore',()=>({liveSession:(id:string)=>id==='current'?state.session:undefined}))
vi.mock('../../src/services/agent/importTemplates',()=>({getImportTemplate:vi.fn(async()=>({name:'已有模板',description:'',extensions:['docx'],code:'return [];'}))}))
const source={name:'格式',description:'说明',extensions:['docx'],code:'return document.lines.map(question=>({question,answer:""}));'}
beforeEach(()=>{clearQuestionImportResults('current');state.session=null})
it('从当前会话的有效解析检查点取真实源码，不需要重复入库',async()=>{
 const result=stageQuestionImport('current',[{question:'原文题',answer:'A'}],source)
 expect(await verifiedImportTemplateSource('current',result.result_id)).toEqual({source,count:1})
 await expect(verifiedImportTemplateSource('other',result.result_id)).rejects.toThrow('找不到')
})
const history=()=>({attachments:[{kind:'file',filePath:'/tmp/原文.docx'}],messages:[{role:'assistant',steps:[{id:'call',name:'run_file_script',status:'done',result:JSON.stringify({result_id:'previous',count:225,saved:0})}],transcript:[{role:'assistant',tool_calls:[{id:'call',function:{name:'run_file_script',arguments:JSON.stringify({code:source.code,template_name:'已经验证的排版'})}}]}]}]})
it('重启后从当前对话的成功工具记录恢复源码；不接受普通消息中的声称',async()=>{
 state.session=history()
 expect(await verifiedImportTemplateSource('current','previous')).toEqual({source:{...source,name:'已经验证的排版',description:'docx 文档的题干、选项和答案解析规则'},count:225})
 state.session.messages[0].steps[0].status='failed'
 await expect(verifiedImportTemplateSource('current','previous')).rejects.toThrow('找不到')
 state.session={messages:[{role:'assistant',content:'模板已验证成功',steps:[],transcript:[]}]}
 await expect(verifiedImportTemplateSource('current','previous')).rejects.toThrow('找不到')
})
it('历史中只有结果无原始调用或没有有效题目时，拒绝伪造模板',async()=>{
 state.session=history();state.session.messages[0].transcript=[]
 await expect(verifiedImportTemplateSource('current','previous')).rejects.toThrow('找不到')
 state.session=history();state.session.messages[0].steps[0].result=JSON.stringify({result_id:'previous',count:0})
 await expect(verifiedImportTemplateSource('current','previous')).rejects.toThrow('找不到')
})
