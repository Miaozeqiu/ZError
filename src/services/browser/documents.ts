import { callProtocol } from './protocol'

export type BrowserDocument = { frameId: string; loaderId: string; url: string }
export const sameBrowserDocument = (one: BrowserDocument, two: BrowserDocument) =>
  one.frameId === two.frameId && one.loaderId === two.loaderId && one.url === two.url
export const documentRecord = (value: unknown): BrowserDocument => {
  const row = value as BrowserDocument | null
  if (!row || !['frameId', 'loaderId', 'url'].every(key => typeof row[key as keyof BrowserDocument] === 'string' && row[key as keyof BrowserDocument])) {
    throw new Error('缺少页面文档身份，请重新读取')
  }
  return { frameId: row.frameId, loaderId: row.loaderId, url: row.url }
}
export async function browserDocuments(browserId: string, host: string) {
  const result = await callProtocol(browserId, 'website_document', { host, action: 'list' })
  if (result.ok !== true || !Array.isArray(result.documents) || !result.documents.length || result.documents.length > 2048) {
    throw new Error(String(result.error || '无法验证页面文档身份'))
  }
  return { documents: result.documents.map(documentRecord), blockedFrames: Number(result.blockedFrames) || 0,
    childFramesSupported: result.childFramesSupported === true }
}
