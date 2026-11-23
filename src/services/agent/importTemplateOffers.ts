import { settingsManager } from '../app/settings'
import { importTemplateSettings, markImportTemplateUsed, saveImportTemplate } from './importTemplates'
import type { ImportTemplateSource } from './importTemplateTypes'

/** 只有实际成功入库的新解析算法才出现保存提示；提示不会阻塞导入回执或模型结束。 */
export async function offerImportedTemplate(sessionId:string, messageId:string, resultId:string, source:ImportTemplateSource) {
  await settingsManager.ready
  if (source.templateId) {
    await markImportTemplateUsed(source.templateId)
    return {status:'reused',id:source.templateId}
  }
  const existing=importTemplateSettings.value.templates.find(item=>item.code===source.code)
  if (existing) { await saveImportTemplate(source); return {status:'existing',id:existing.id,name:existing.name} }
  const mode=importTemplateSettings.value.saveMode
  if (mode==='never') return {status:'disabled'}
  if (mode==='auto') {
    const saved=await saveImportTemplate(source,{automatic:true})
    if (saved) return {status:'saved',id:saved.id,name:saved.name}
    return {status:'disabled'}
  }
  const store=await import('./chatStore')
  const message=store.liveSession(sessionId)?.messages.find(item=>item.id===messageId)
  if (!message) return {status:'unavailable'}
  const offers=message.importTemplateOffers || []
  if (!offers.some(item=>item.id===resultId)) {
    if (offers.length>=10) return {status:'limit',message:'本条消息的待保存模板过多，可在下次导入后保存'}
    store.patchMessage(sessionId,messageId,{importTemplateOffers:[...offers,{...source,id:resultId,status:'pending'}]})
    await store.flushChatCheckpoint()
  }
  return {status:'pending',name:source.name,message:'已在本条回复中显示模板保存选项，等待用户选择即可；不要重复询问或等待后再报告导入完成。'}
}
const submitting=new Set<string>()
export async function respondImportTemplateOffer(sessionId:string,messageId:string,id:string,choice:'skip'|'save'|'always',name?:string) {
  if (!['skip','save','always'].includes(choice)) throw new Error('模板保存选项无效')
  const key=`${sessionId}:${messageId}:${id}`
  if (submitting.has(key)) return
  submitting.add(key)
  try {
    const store=await import('./chatStore')
    const message=store.liveSession(sessionId)?.messages.find(item=>item.id===messageId)
    const offer=message?.importTemplateOffers?.find(item=>item.id===id)
    if (!offer || offer.status!=='pending') return
    const saved=choice==='skip' ? undefined : await saveImportTemplate({...offer,name:name?.trim() || offer.name},{always:choice==='always'})
    const latest=store.liveSession(sessionId)?.messages.find(item=>item.id===messageId)
    if (!latest) return
    store.patchMessage(sessionId,messageId,{importTemplateOffers:latest.importTemplateOffers?.map(item=>item.id===id?{...item,name:saved?.name || item.name,status:choice==='skip'?'skipped':'saved',savedTemplateId:saved?.id}:item)})
    await store.flushChatCheckpoint()
  } finally { submitting.delete(key) }
}
