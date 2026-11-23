import { computed } from 'vue'
import { parse } from 'acorn'
import { settingsManager } from '../app/settings'
import { defaultQuestionImportSettings, type ImportAlgorithmTemplate, type ImportTemplateSaveMode, type ImportTemplateSource } from './importTemplateTypes'

export const importTemplateSettings = computed(() => settingsManager.get('questionImport') || defaultQuestionImportSettings())
const validateSource = (source: ImportTemplateSource) => {
  if (typeof source.code !== 'string' || !source.code.trim() || source.code.length > 64_000) throw new Error('模板脚本不能为空或超过 64000 字符')
  if (!source.name.trim() || source.name.length > 80 || source.description.length > 500) throw new Error('请填写 80 字以内的模板名称和 500 字以内的说明')
  if (!Array.isArray(source.extensions) || !source.extensions.length || source.extensions.length > 16 || !source.extensions.every(value => /^[a-z0-9]{1,12}$/.test(value))) throw new Error('模板文件类型无效')
}
const metadata = ({code: _code,...template}:ImportAlgorithmTemplate) => template
export async function listImportTemplates(extension?: string, keyword?: string) {
  await settingsManager.ready
  const words = String(keyword || '').trim().toLowerCase().split(/[\s,，、]+/).filter(Boolean)
  const format = String(extension || '').trim().replace(/^\./, '').toLowerCase()
  return importTemplateSettings.value.templates.filter(item => (!format || item.extensions.includes(format))
    && words.every(word => `${item.name} ${item.description}`.toLowerCase().includes(word)))
    .slice().sort((a,b)=>(b.lastUsedAt || b.updatedAt)-(a.lastUsedAt || a.updatedAt)).map(metadata)
}
export async function getImportTemplate(id:string) {
  await settingsManager.ready
  const template = importTemplateSettings.value.templates.find(item=>item.id===id)
  if (!template) throw new Error('导入模板不存在，可能已被删除；请重新查询模板列表')
  validateSource(template)
  return JSON.parse(JSON.stringify(template)) as ImportAlgorithmTemplate
}
export async function setImportTemplateSaveMode(mode:ImportTemplateSaveMode) {
  if (!['ask','auto','never'].includes(mode)) throw new Error('模板保存方式无效')
  await settingsManager.commit(draft=>{
    draft.questionImport ||= defaultQuestionImportSettings()
    draft.questionImport.saveMode=mode
  })
}
export async function saveImportTemplate(source:ImportTemplateSource, options:{automatic?:boolean; always?:boolean}={}) {
  validateSource(source)
  let result:ImportAlgorithmTemplate | undefined
  await settingsManager.commit(draft=>{
    const config=draft.questionImport ||= defaultQuestionImportSettings()
    if (options.automatic && config.saveMode !== 'auto') return
    const existing=config.templates.find(item=>item.code===source.code)
    if (existing) {
      const extensions=[...new Set([...existing.extensions,...source.extensions])]
      if (extensions.length!==existing.extensions.length) { existing.extensions=extensions;existing.updatedAt=Date.now() }
      result=existing
    }
    else {
      if (config.templates.length>=100 || config.templates.reduce((n,item)=>n+item.code.length,0)+source.code.length>2_000_000) throw new Error('导入模板数量或总大小已达上限，请在设置中删除不再使用的模板')
      const now=Date.now()
      result={id:crypto.randomUUID(),name:source.name.trim(),description:source.description.trim(),extensions:[...new Set(source.extensions)],code:source.code,createdAt:now,updatedAt:now}
      config.templates.push(result)
    }
    if (options.always) config.saveMode='auto'
  })
  return result ? metadata(result) : undefined
}
export async function markImportTemplateUsed(id:string) {
  await settingsManager.commit(draft=>{
    const template=draft.questionImport?.templates.find(item=>item.id===id)
    if (template) template.lastUsedAt=Date.now()
  })
}
export async function updateImportTemplate(id:string, patch:{name:string;description:string;code?:string}) {
  await settingsManager.commit(draft=>{
    const template=draft.questionImport?.templates.find(item=>item.id===id)
    if (!template) throw new Error('模板已被删除')
    validateSource({...template,...patch})
    if (patch.code !== undefined) {
      // 只校验语法，不执行用户正在编辑的算法。
      try { parse(`function parseDocument(document) {"use strict";\n${patch.code}\n}`, { ecmaVersion: 'latest' }) }
      catch { throw new Error('算法存在 JavaScript 语法错误，请修改后保存') }
      const total=draft.questionImport.templates.reduce((size,item)=>size+(item.id===id?patch.code!.length:item.code.length),0)
      if (total>2_000_000) throw new Error('导入模板总大小已达上限，请删除不再使用的模板')
    }
    Object.assign(template,patch,{name:patch.name.trim(),description:patch.description.trim(),updatedAt:Date.now()})
  })
}
export async function deleteImportTemplate(id:string) {
  await settingsManager.commit(draft=>{
    if (draft.questionImport) draft.questionImport.templates=draft.questionImport.templates.filter(item=>item.id!==id)
  })
}
