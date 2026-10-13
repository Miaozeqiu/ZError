/** 从题库 / 学习页拉起一轮对话。真正发送在 chatLoop.ts。 */
import { databaseService } from '../app/database'
import { emitStudyGraphStream } from '../study/graphStream'
import { createChat } from './chatStore'
import { sendChatMessage } from './chatLoop'
import type { AgentChatAttachment } from './chatTypes'
import { encodeFolderToken } from './folderTokens'
import { GRAPH_QUALITY, KEEP_GRAPH_HINT, graphSubjectHint } from './studyHelpers'

const resolveFolderRef = async (input: {
  folderId: number
  folderName: string
  folderPath?: string
}) => {
  const folderId = Number(input.folderId)
  if (!Number.isFinite(folderId) || folderId < 0) return null
  const folderName = String(input.folderName || '').trim() || '文件夹'
  let folderPath = String(input.folderPath || folderName).trim()
  try {
    const parts = await databaseService.getFolderPath(folderId)
    if (parts.length) folderPath = parts.map((item) => item.name).join(' / ')
  } catch {
    // keep given path
  }
  const attachment: AgentChatAttachment = {
    kind: 'folder',
    filePath: `folder:${folderId}`,
    fileName: folderName,
    folderId,
    folderName,
    folderPath,
  }
  return {
    attachment,
    token: encodeFolderToken({ folderId, folderName, folderPath }),
  }
}

export const startFolderOrganizeChat = async (input: {
  folderId: number
  folderName: string
  folderPath?: string
}) => {
  const folder = await resolveFolderRef(input)
  if (!folder || folder.attachment.folderId === 0) return
  createChat({
    title: `整理 ${folder.attachment.folderName}`,
    attachments: [folder.attachment],
  })
  await sendChatMessage(
    `请整理 ${folder.token}。先查看这个文件夹的路径、子文件夹和题目，再按题目内容归类：该新建子文件夹就新建，该移动的题目就移动，该重命名就重命名。不要删除题目或文件夹。整理完用一两句话说明做了什么。`,
    [folder.attachment],
  )
}

export const startStudySubjectChat = async (input: {
  subjectId: number
  subjectName?: string
}) => {
  const id = Number(input.subjectId)
  const name = String(input.subjectName || '').trim()
  if (!Number.isFinite(id) || id <= 0) return
  try {
    localStorage.setItem('zerror-study-subject', String(id))
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'agent' }))
  createChat({
    title: name ? `学习 ${name}` : '学习',
    studySubjectId: id,
  })
  await sendChatMessage(
    name
      ? `我现在开始学习「${name}」。根据我的学习进度学习。`
      : '根据我的学习进度学习。',
  )
}

export const startStudyGraphChat = async (input?: {
  subjectId?: number
  subjectName?: string
  rebuild?: boolean
}) => {
  const name = String(input?.subjectName || '').trim()
  const id = Number(input?.subjectId)
  const rebuild = Boolean(input?.rebuild)
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'agent' }))
  if (Number.isFinite(id) && id > 0) {
    const existing = await databaseService.getStudyGraph(id).catch(() => null)
    const nodes = existing?.nodes || []
    emitStudyGraphStream({
      subjectId: id,
      mermaid: `flowchart TB\nsubject["${name || '知识图谱'}"]`,
      streaming: true,
    })
    createChat({ title: `知识图谱 ${name || id}`, studySubjectId: id })
    if (rebuild && nodes.length) {
      try {
        await databaseService.setStudyGraph(id, [])
        window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId: id } }))
      } catch {
        // 清不掉也继续，按重画提示生成
      }
    }
    if (!nodes.length || rebuild) {
      await sendChatMessage(
        `请为学习科目「${name || '未命名'}」（subject_id=${id}）从零绘制知识图谱。${GRAPH_QUALITY}
${graphSubjectHint(name)}
用 patch_knowledge_graph，subject_id=${id}，add 里每次放 3–8 个节点。先写章，再给章补节。不要调用空的 set_knowledge_graph，不要问确认。画完用一两句话说明。`,
      )
      return
    }
    const chapters = nodes.filter((item) => !item.parent_id).map((item) => item.name).slice(0, 16).join('、')
    await sendChatMessage(
      `科目「${name || '未命名'}」（subject_id=${id}）已经有 ${nodes.length} 个节点。先 get_knowledge_graph。
${KEEP_GRAPH_HINT}
已有章：${chapters || '（见工具返回）'}
用户点了绘制：只补缺的章/节，或按这句话里的具体要求增删改。不要重画整张图，不要 set_knowledge_graph。
${graphSubjectHint(name)}
用 patch_knowledge_graph。做完用一两句话说明补了什么。`,
    )
    return
  }
  createChat({ title: '知识图谱' })
  await sendChatMessage(
    `请帮我在学习页处理知识图谱。先 list_subjects；有合适科目就 get_knowledge_graph。
已有图谱就按用户要求 patch，不要重画。没有科目或图谱为空再 create_subject 并从零画。
${GRAPH_QUALITY}`,
  )
}

export const startFileImportChat = async (input: {
  filePath: string
  folderId: number
  folderName: string
  folderPath?: string
}) => {
  const fileName = input.filePath.split(/[\\/]/).pop() || '文件'
  const folder = await resolveFolderRef(input)
  const fileAttachment: AgentChatAttachment = {
    kind: 'file',
    filePath: input.filePath,
    fileName,
    folderId: folder?.attachment.folderId,
    folderName: folder?.attachment.folderName,
    folderPath: folder?.attachment.folderPath,
  }
  const attachments = folder ? [fileAttachment, folder.attachment] : [fileAttachment]
  createChat({
    title: `导入 ${fileName}`,
    attachments,
  })
  await sendChatMessage(
    folder
      ? `请把附件「${fileName}」里的题目识别出来，保存到 ${folder.token}。`
      : `请把附件「${fileName}」里的题目识别出来，保存到「${input.folderName}」。`,
    attachments,
  )
}
