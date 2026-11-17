import type { AgentChatAttachment } from './chatTypes'

export const isFolderAttachment = (item: AgentChatAttachment) =>
  item.kind === 'folder' || item.filePath.startsWith('folder:')

export const isImageAttachment = (item: AgentChatAttachment) =>
  item.kind === 'image' || Boolean(item.imageUrl)

export const isFileAttachment = (item: AgentChatAttachment) =>
  !isFolderAttachment(item) && !isImageAttachment(item)

const FOLDER_TOKEN_SOURCE = '\\{\\{folder:(-?\\d+):([^:}]+)(?::([^}]+))?\\}\\}'

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const encodeFolderToken = (folder: {
  folderId: number
  folderName: string
  folderPath?: string
}) =>
  `{{folder:${folder.folderId}:${encodeURIComponent(folder.folderName)}:${encodeURIComponent(folder.folderPath || folder.folderName)}}}`

export type AgentMessagePart =
  | { type: 'text'; text: string }
  | { type: 'folder'; folderId: number; folderName: string }

export const parseFolderTokens = (text: string) => {
  const items: { folderId: number; folderName: string; folderPath: string }[] = []
  const re = new RegExp(FOLDER_TOKEN_SOURCE, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const folderName = safeDecode(match[2])
    items.push({
      folderId: Number(match[1]),
      folderName,
      folderPath: match[3] ? safeDecode(match[3]) : folderName,
    })
  }
  return items
}

export const parseMessageParts = (text: string): AgentMessagePart[] => {
  const parts: AgentMessagePart[] = []
  const re = new RegExp(FOLDER_TOKEN_SOURCE, 'g')
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ type: 'text', text: text.slice(last, match.index) })
    parts.push({
      type: 'folder',
      folderId: Number(match[1]),
      folderName: safeDecode(match[2]),
    })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

export const extractFolderAttachments = (text: string): AgentChatAttachment[] => {
  const seen = new Set<number>()
  const items: AgentChatAttachment[] = []
  for (const folder of parseFolderTokens(text)) {
    if (!Number.isFinite(folder.folderId) || folder.folderId < 0 || seen.has(folder.folderId)) continue
    seen.add(folder.folderId)
    items.push({
      kind: 'folder',
      filePath: `folder:${folder.folderId}`,
      fileName: folder.folderName,
      folderId: folder.folderId,
      folderName: folder.folderName,
      folderPath: folder.folderPath,
    })
  }
  return items
}

export const expandFolderTokens = (text: string, items?: AgentChatAttachment[]) => {
  const byId = new Map(
    (items || [])
      .filter((item) => isFolderAttachment(item) && item.folderId != null)
      .map((item) => [item.folderId as number, item]),
  )
  return text.replace(new RegExp(FOLDER_TOKEN_SOURCE, 'g'), (_all, id, rawName, rawPath) => {
    const folderId = Number(id)
    const name = safeDecode(rawName)
    const att = byId.get(folderId)
    const path = att?.folderPath || (rawPath ? safeDecode(rawPath) : name)
    return `${name}（folder_id=${folderId}，路径=${path}）`
  })
}
