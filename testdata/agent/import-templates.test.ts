import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsManager } from '../../src/services/app/settings'
import { defaultQuestionImportSettings, type ImportTemplateSource } from '../../src/services/agent/importTemplateTypes'
import { deleteImportTemplate, getImportTemplate, importTemplateSettings, listImportTemplates, saveImportTemplate, setImportTemplateSaveMode, updateImportTemplate } from '../../src/services/agent/importTemplates'
import { offerImportedTemplate, respondImportTemplateOffer } from '../../src/services/agent/importTemplateOffers'
const state=vi.hoisted(()=>({documents:new Map<string,any>(),fail:false,message:{id:'assistant',importTemplateOffers:[] as any[]},flush:vi.fn(async()=>{})}))
vi.mock('../../src/services/security/secureStore',()=>({readSecureDocument:async(name:string)=>state.documents.get(name)??null,writeSecureDocument:async(name:string,value:any)=>{
  if(state.fail)throw new Error('保存失败')
  const copy=JSON.parse(JSON.stringify(value));state.documents.set(name,copy);return copy
}}))
vi.mock('../../src/services/agent/chatStore',()=>({liveSession:(id:string)=>id==='session'?{id,messages:[state.message]}:undefined,patchMessage:(_s:string,_m:string,patch:any)=>Object.assign(state.message,patch),flushChatCheckpoint:()=>state.flush()}))
const source:ImportTemplateSource={name:'编号和答案段落',description:'编号题干，字母选项，【答案】段落',extensions:['docx'],code:'return document.lines.filter(s=>s.includes("题")).map(s=>({question:s,answer:""}));'}
beforeEach(async()=>{
  state.fail=false;state.message={id:'assistant',importTemplateOffers:[]};state.flush.mockReset().mockResolvedValue(undefined)
  await settingsManager.ready
  await settingsManager.commit(draft=>{draft.questionImport=defaultQuestionImportSettings();draft.theme='light'})
})
describe('本地导入算法模板与选择',()=>{
  it('默认只显示非阻塞保存提示，不提前保存算法；用户选择不保存后不改变全局偏好',async()=>{
    const result=await offerImportedTemplate('session','assistant','result',source)
    expect(result.status).toBe('pending')
    expect(importTemplateSettings.value.templates).toHaveLength(0)
    expect(state.message.importTemplateOffers).toMatchObject([{id:'result',status:'pending',code:source.code}])
    await respondImportTemplateOffer('session','assistant','result','skip')
    expect(importTemplateSettings.value.templates).toHaveLength(0)
    expect(importTemplateSettings.value.saveMode).toBe('ask')
    expect(state.message.importTemplateOffers[0].status).toBe('skipped')
  })
  it('保存一次不会改变后续询问；保存内容可重用，不在列表中输出代码',async()=>{
    await offerImportedTemplate('session','assistant','result',source)
    await respondImportTemplateOffer('session','assistant','result','save','我的题库格式')
    expect(importTemplateSettings.value.saveMode).toBe('ask')
    const list=await listImportTemplates('docx','我的')
    expect(list).toHaveLength(1);expect(list[0].name).toBe('我的题库格式');expect(list[0]).not.toHaveProperty('code')
    expect((await getImportTemplate(list[0].id)).code).toBe(source.code)
    expect(state.documents.get('app_settings').questionImport.templates[0].code).toBe(source.code)
    expect(state.message.importTemplateOffers[0]).toMatchObject({status:'saved',savedTemplateId:list[0].id})
  })
  it('模板检索支持带点的大小写扩展名和多个排版关键词',async()=>{
    await saveImportTemplate(source)
    expect(await listImportTemplates(' .DOCX ', '题干 答案')).toHaveLength(1)
    expect(await listImportTemplates('pdf','题干')).toHaveLength(0)
    expect(await listImportTemplates('docx','不存在')).toHaveLength(0)
  })
  it('下次不用问我将当前保存和全局自动保存一起持久化，之后的新算法无需新提示',async()=>{
    await offerImportedTemplate('session','assistant','first',source)
    await respondImportTemplateOffer('session','assistant','first','always')
    expect(importTemplateSettings.value.saveMode).toBe('auto')
    const next={...source,name:'另一个排版',code:'return []'}
    expect((await offerImportedTemplate('session','assistant','next',next)).status).toBe('saved')
    expect(importTemplateSettings.value.templates).toHaveLength(2)
    expect(state.message.importTemplateOffers).toHaveLength(1)
    expect(state.documents.get('app_settings').questionImport.saveMode).toBe('auto')
  })
  it('不保存模式不产生模板或提示，设置改回询问后恢复提示',async()=>{
    await setImportTemplateSaveMode('never')
    expect((await offerImportedTemplate('session','assistant','result',source)).status).toBe('disabled')
    expect(state.message.importTemplateOffers).toHaveLength(0)
    expect(importTemplateSettings.value.templates).toHaveLength(0)
    await setImportTemplateSaveMode('ask')
    expect((await offerImportedTemplate('session','assistant','result',source)).status).toBe('pending')
  })
  it('并发保存同一脚本去重，其他配置修改不会丢失；同脚本成功处理另一类型时扩展适用类型',async()=>{
    await Promise.all([saveImportTemplate(source),saveImportTemplate(source),settingsManager.commit(draft=>{draft.theme='dark'})])
    expect(importTemplateSettings.value.templates).toHaveLength(1);expect(settingsManager.get('theme')).toBe('dark')
    await offerImportedTemplate('session','assistant','next',{...source,extensions:['txt']})
    expect(importTemplateSettings.value.templates[0].extensions).toEqual(['docx','txt'])
    expect(state.message.importTemplateOffers).toHaveLength(0)
  })
  it('复用不重复询问，支持重命名、按格式查询、删除；删除后禁止运行旧引用',async()=>{
    const saved=(await saveImportTemplate(source))!
    expect((await offerImportedTemplate('session','assistant','reused',{...source,templateId:saved.id})).status).toBe('reused')
    expect(importTemplateSettings.value.templates[0].lastUsedAt).toBeGreaterThan(0)
    expect(state.message.importTemplateOffers).toHaveLength(0)
    await updateImportTemplate(saved.id,{name:'新名称',description:'新的格式说明'})
    expect((await listImportTemplates('docx','新名称'))[0].name).toBe('新名称')
    expect(await listImportTemplates('xlsx')).toEqual([])
    await deleteImportTemplate(saved.id)
    await expect(getImportTemplate(saved.id)).rejects.toThrow('不存在')
  })
  it('编辑后的算法持久化并用于下次运行，预览和保存不执行代码',async()=>{
    const saved=(await saveImportTemplate(source))!
    const code='return document.lines.map(question=>({question,answer:"B"}));'
    await updateImportTemplate(saved.id,{name:'更新后的格式',description:'逐行识别',code})
    expect((await getImportTemplate(saved.id)).code).toBe(code)
    expect(state.documents.get('app_settings').questionImport.templates[0].code).toBe(code)
    const {evaluateDataScript}=await import('../../src/services/script/dataScriptRuntime')
    expect(await evaluateDataScript((await getImportTemplate(saved.id)).code,{lines:['第一题']})).toEqual([{question:'第一题',answer:'B'}])
  })
  it('语法错误和超限代码不能覆盖已有算法',async()=>{
    const saved=(await saveImportTemplate(source))!
    for(const code of ['return [;', 'with(document) {}', ' '.repeat(64_001)]) {
      await expect(updateImportTemplate(saved.id,{name:'无效修改',description:'',code})).rejects.toThrow()
      expect((await getImportTemplate(saved.id)).code).toBe(source.code)
      expect((await getImportTemplate(saved.id)).name).toBe(source.name)
    }
  })
  it('持久化失败时保持待确认状态，不能假报已保存或提前打开自动保存',async()=>{
    await offerImportedTemplate('session','assistant','result',source)
    state.fail=true
    await expect(respondImportTemplateOffer('session','assistant','result','always')).rejects.toThrow('保存失败')
    expect(state.message.importTemplateOffers[0].status).toBe('pending')
    expect(importTemplateSettings.value.saveMode).toBe('ask')
    expect(importTemplateSettings.value.templates).toHaveLength(0)
    state.fail=false
    await respondImportTemplateOffer('session','assistant','result','always')
    expect(importTemplateSettings.value.templates).toHaveLength(1)
  })
  it('不存在的会话或重复点击不能保存未确认脚本，重复结果不会产生两张提示卡',async()=>{
    expect((await offerImportedTemplate('other','assistant','result',source)).status).toBe('unavailable')
    await offerImportedTemplate('session','assistant','result',source);await offerImportedTemplate('session','assistant','result',source)
    expect(state.message.importTemplateOffers).toHaveLength(1)
    await Promise.all([respondImportTemplateOffer('session','assistant','result','save'),respondImportTemplateOffer('session','assistant','result','save')])
    expect(importTemplateSettings.value.templates).toHaveLength(1)
  })
})
