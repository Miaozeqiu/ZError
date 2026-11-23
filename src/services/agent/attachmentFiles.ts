import { fileExtOf } from '../../utils/ui/fileKind'

export const AGENT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']
export const AGENT_DOCUMENT_EXTENSIONS = ['txt', 'md', 'csv', 'xlsx', 'xls', 'docx', 'doc', 'pdf']
export const AGENT_ATTACHMENT_EXTENSIONS = [...AGENT_DOCUMENT_EXTENSIONS, ...AGENT_IMAGE_EXTENSIONS]
export const MAX_AGENT_IMAGES = 4
export const MAX_AGENT_ATTACHMENT_BYTES = 40 * 1024 * 1024

export const agentAttachmentKind = (name: string): 'image' | 'file' | null => {
  const ext = fileExtOf(name)
  if (AGENT_IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (AGENT_DOCUMENT_EXTENSIONS.includes(ext)) return 'file'
  return null
}
export const agentImageMime = (name: string) => {
  const ext = fileExtOf(name)
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png'
}
