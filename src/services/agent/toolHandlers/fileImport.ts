import { getImportTemplate, listImportTemplates, saveImportTemplate } from '../importTemplates'
import { fileExtOf } from '../../../utils/ui/fileKind'
import type { ChatToolContext, ChatToolHandler } from '../toolContext'
import { inspectLocalFile, readLocalFileDocument, readLocalFileRange } from '../import'
import { questionImportResult, stageQuestionImport, validateImportQuestions } from '../questionImport'
import { saveQuestions } from '../quizTools'
import { resolveFolder } from '../toolShared'

const filePath = (args: any, ctx: ChatToolContext) => {
  const path = String(args.path || ctx.attachment()?.filePath || '')
  if (!path) throw new Error('当前对话没有附带文件，请传入用户提供的 path')
  return path
}

export const fileImportToolHandlers: Record<string, ChatToolHandler> = {
  get_file_info: async ({ args, ctx }) => {
    const path = filePath(args, ctx)
    const info = await inspectLocalFile(path)
    const templates = await listImportTemplates(fileExtOf(info.fileName))
    return JSON.stringify({...info, import_templates: {
      total: templates.length,
      templates: templates.slice(0, 5).map(({id,name,description,extensions}) => ({id,name,description:description.slice(0,180),extensions})),
      next: templates.length ? '结合文件样本判断适用排版，匹配时直接 run_file_script(template_id) 试跑；预览不符可改写脚本或分批识题。更多模板用 list_import_templates。' : '没有该文件类型的已保存模板，可自主选择新脚本或分批识题。',
    }})
  },
  read_range: async ({ args, ctx }) => JSON.stringify(await readLocalFileRange(filePath(args, ctx), args.start, args.end, args.offset ?? 0)),
  run_file_script: async ({ args, ctx }) => {
    if ((args.code != null) === (args.template_id != null)) throw new Error('code 和 template_id 必须且只能提供一个，由 Agent 自行选择新脚本或已有模板')
    const path = filePath(args, ctx)
    const extension = fileExtOf(path.split(/[/\\]/).pop() || '') || 'txt'
    const template = args.template_id ? await getImportTemplate(String(args.template_id)) : undefined
    if (template && !template.extensions.includes(extension)) throw new Error('此模板不适用于当前文件类型，请先查看文件样本并选择适合的模板或编写新脚本')
    const code = template?.code ?? String(args.code || '')
    const document = await readLocalFileDocument(path, ctx.abort)
    const { runDataScript } = await import('../../script/dataScript')
    const result = await runDataScript(code, document, ctx.abort)
    ctx.abort.throwIfAborted()
    return JSON.stringify(stageQuestionImport(ctx.sessionId, result, {
      code, extensions: template?.extensions || [extension], templateId: template?.id,
      name: template?.name || String(args.template_name || `${document.name.replace(/\.[^.]+$/, '')}格式`).slice(0,80),
      description: template?.description || String(args.template_description || `${document.type} 文档的题干、选项和答案解析规则`).slice(0,500),
    }))
  },
  list_import_templates: async ({ args }) => {
    const templates = await listImportTemplates(args.extension, args.keyword)
    const offset=Number(args.offset ?? 0),limit=Math.min(Number(args.limit ?? 10),20)
    if (!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1) throw new Error('模板列表范围无效')
    return JSON.stringify({total:templates.length,offset,nextOffset:offset+limit<templates.length?offset+limit:null,templates:templates.slice(offset,offset+limit)})
  },
  read_import_template: async ({ args }) => {
    const template = await getImportTemplate(String(args.template_id || ''))
    const start = Number(args.offset ?? 0), length = Math.min(Number(args.limit ?? 4000),8000)
    if (!Number.isSafeInteger(start) || start<0 || !Number.isSafeInteger(length) || length<1) throw new Error('模板读取范围无效')
    const {code,...metadata}=template
    return JSON.stringify({...metadata,code:code.slice(start,start+length),offset:start,totalChars:code.length,nextOffset:start+length<code.length?start+length:null})
  },
  save_import_template: async ({args,ctx}) => {
    const { verifiedImportTemplateSource } = await import('../importTemplateSources')
    const {source,count} = await verifiedImportTemplateSource(ctx.sessionId, String(args.result_id || ''))
    ctx.abort.throwIfAborted()
    const saved = await saveImportTemplate({...source,
      name: args.name ?? source.name, description: args.description ?? source.description,
    })
    return JSON.stringify({saved:true,template_id:saved!.id,name:saved!.name,verified_questions:count,
      message:'导入算法已保存到本地设置，未新增或重复导入题目，未改变自动保存偏好。'})
  },
  save_questions: async ({ args, ctx }) => {
    if ((args.questions != null) === (args.result_id != null)) throw new Error('questions 和 result_id 必须且只能提供一个')
    const staged = args.result_id != null ? questionImportResult(ctx.sessionId, String(args.result_id)) : undefined
    if (staged?.running) throw new Error('这份解析结果正在保存，请等待回执后再继续')
    const questions = staged?.questions || validateImportQuestions(args.questions, 20)
    const explicit = args.folder_id != null || Boolean(args.folder_name)
    const attachedFolder = staged?.folderId ?? ctx.folders()[0]?.folderId ?? ctx.attachment()?.folderId
    if (!explicit && attachedFolder == null) throw new Error('请先 list_folders 查看本地题库结构，根据上下文和文件内容自行选择目标；需要时 create_folder，再传 folder_id。用户未指定位置时不必追问，也不要直接丢到默认文件夹。')
    const folder = explicit ? await resolveFolder(args.folder_id, args.folder_name)
      : await resolveFolder(attachedFolder)
    if (!folder) throw new Error('找不到目标文件夹；请先查询或创建文件夹，未写入任何题目')
    const subjectId = ctx.studySubjectId()
    // 查找目标会 await；之后必须再次检查，防止两个并发调用同时进入。
    if (staged?.running) throw new Error('这份解析结果正在保存，请等待回执后再继续')
    if (staged?.folderId != null && (staged.folderId !== folder.id || staged.subjectId !== subjectId)) {
      throw new Error('此结果已绑定原文件夹和学习科目，请在原目标续传，或重新解析后另存')
    }
    if (staged) { staged.running = true; staged.folderId = folder.id; staged.subjectId = subjectId }
    const previous = staged?.questionIds.length || 0
    try {
      const result = await saveQuestions(questions.slice(previous), folder.id, subjectId, {
        signal: ctx.abort, onSaved: staged ? id => { staged.questionIds.push(id) } : undefined,
      })
      const totalSaved = previous + result.saved
      let template:Record<string,unknown> | undefined
      if (staged?.source && !staged.templateHandled && totalSaved === questions.length) {
        try {
          const { offerImportedTemplate } = await import('../importTemplateOffers')
          template = await offerImportedTemplate(ctx.sessionId,ctx.assistantId,String(args.result_id),staged.source)
          staged.templateHandled = true
        } catch { template = {status:'failed',message:'题目已导入，但未能保存模板设置；不要重新导入题目，可稍后重试模板保存。'} }
      }
      return JSON.stringify({
        template,
        saved: result.saved, total_saved: totalSaved, total: questions.length, remaining: questions.length - totalSaved,
        missing_answers: questions.filter(item => !item.answer).length,
        complete: totalSaved === questions.length, error: result.error, warning: result.warning,
        result_id: args.result_id, next_index: totalSaved,
        // 大批量回执只展示少量 Id；完整结果保存在会话检查点，题目可通过 list_questions 核对。
        questionIds: result.questionIds.slice(0, 20), folderId: folder.id, folderName: folder.name,
        linked: result.association.linked, created_nodes: result.association.created,
        knowledge: result.association.links.slice(0, 20).map(item => ({
          question_id:item.question_id, node_id:item.node_id, node_name:item.node_name, subject_id:item.subject_id,
        })),
        message: `本次写入 ${result.saved} 道，累计 ${totalSaved}/${questions.length} 道到「${folder.name}」${result.error ? '，尚未完成；请从回执位置继续' : ''}`,
      })
    } finally { if (staged) staged.running = false }
  },
}
