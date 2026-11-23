/** 从题库或学习页打开 Agent 对话。 */
import { databaseService } from '../app/database'
import { createChat, selectChat, setChatStudySubject } from './chatStore'
import { sendChatMessage } from './chatLoop'
import type { AgentChatAttachment } from './chatTypes'
import { encodeFolderToken } from './folderTokens'

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

export const draftStudyGraphChat = (input?: {
  subjectId: number
  subjectName?: string
}) => {
  const name = String(input?.subjectName || '').trim()
  selectChat(null)
  setChatStudySubject(input?.subjectId)
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'agent' }))
  window.dispatchEvent(new CustomEvent('prefill-agent-composer', {
    detail: name ? `请绘制或完善「${name}」的知识图谱。` : '请帮我绘制知识图谱。',
  }))
}

export const startFileImportChat = async (input: {
  filePath: string
  folderId?: number
  folderName?: string
  folderPath?: string
}) => {
  const fileName = input.filePath.split(/[\\/]/).pop() || '文件'
  // 题库内发起时沿用指定位置；首页导入交给 Agent 根据目录结构归类。
  const folder = input.folderId === undefined ? null : await resolveFolderRef({
    folderId: input.folderId, folderName: input.folderName || '文件夹', folderPath: input.folderPath,
  })
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
      : `请把附件「${fileName}」里的题目导入本地题库。根据上下文判断存放位置；未指定位置时，查看本地题库目录结构，自行选择合适的位置创建文件夹。`,
    attachments,
  )
}
