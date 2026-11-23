import { fileExtOf } from '../../utils/ui/fileKind'
import { getImportTemplate } from './importTemplates'
import type { ImportTemplateSource } from './importTemplateTypes'
import { questionImportResult } from './questionImport'
import { parseToolArgs } from './toolArgs'

/** 只从实际成功的解析检查点或宿主保存的工具记录恢复算法，不接受模型新传的未验证代码。 */
export async function verifiedImportTemplateSource(sessionId: string, resultId: string): Promise<{source: ImportTemplateSource; count: number}> {
  try {
    const staged = questionImportResult(sessionId, resultId)
    if (staged.source) return { source: staged.source, count: staged.questions.length }
  } catch { /* 重启后的检查点从当前对话的成功执行记录恢复。 */ }
  const { liveSession } = await import('./chatStore')
  const session = liveSession(sessionId)
  const messages = session?.messages || []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.role !== 'assistant') continue
    const step = message.steps?.find(item => item.name === 'run_file_script' && item.status === 'done'
      && parseToolArgs(item.result || '').result_id === resultId)
    if (!step) continue
    const result = parseToolArgs(step.result || '')
    const count = result.count
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 5000) break
    const call = message.transcript?.flatMap(item => item.tool_calls || [])
      .find(item => item.id === step.id && item.function.name === 'run_file_script')
    if (!call) break
    const args = parseToolArgs(call.function.arguments)
    if (args.template_id) return { source: await getImportTemplate(String(args.template_id)), count }
    if (typeof args.code !== 'string' || !args.code.trim()) break
    const attachment = messages.slice(0, index + 1).reverse().flatMap(item => item.attachments || [])
      .find(item => item.kind === 'file') || session?.attachments?.find(item => item.kind === 'file')
    const path = typeof args.path === 'string' ? args.path : attachment?.filePath
    if (!path) break
    const fileName = path.split(/[/\\]/).pop() || ''
    const extension = fileExtOf(fileName)
    if (!extension) break
    return {source: {
      code: args.code, extensions: [extension],
      name: String(args.template_name || `${fileName.replace(/\.[^.]+$/, '')}格式`).slice(0,80),
      description: String(args.template_description || `${extension} 文档的题干、选项和答案解析规则`).slice(0,500),
    }, count}
  }
  throw new Error('找不到当前对话中已成功验证的算法，请先 run_file_script 解析核对后再保存模板；无需重复导入题目。')
}
