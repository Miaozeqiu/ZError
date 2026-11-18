export type WebsiteManifest = { version: 1; id: string; name: string; host: string; icon: string }
export type GitHubWebsiteSource = { owner: string; name: string; branch: string; root: string; url: string }
export type WebsiteRepositoryIcon = { path: string; dataUrl: string }
const domain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
export const websiteManifestIdentity = (value: unknown): Pick<WebsiteManifest, 'id' | 'name' | 'host'> => {
  const data = value as WebsiteManifest
  if (!data || typeof data.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.id) || data.id.length > 64
    || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80
    || typeof data.host !== 'string' || data.host.length > 253 || !domain.test(data.host) || data.host.startsWith('www.')) throw new Error('网站仓库 website.json 域名或标识无效')
  const reserved: Record<string, string> = { chaoxing: 'chaoxing.com', zjooc: 'zjooc.cn', zhihuishu: 'zhihuishu.com' }
  if ((reserved[data.id] && reserved[data.id] !== data.host) || Object.entries(reserved).some(([id, host]) => host === data.host && id !== data.id)
    || ['site-learn', 'site-graph', 'campus-bank', 'question-import', 'knowledge-graph', 'quiz-practice', 'folder-admin', 'skill-edit'].includes(data.id)) throw new Error('网站标识与内置资源冲突')
  return { id: data.id, name: data.name.trim(), host: data.host }
}
export const websiteManifest = (value: unknown): WebsiteManifest => {
  const identity = websiteManifestIdentity(value)
  const data = value as WebsiteManifest
  if (data.version !== 1 || typeof data.icon !== 'string' || !/^assets\/[a-zA-Z0-9_-]+\.(?:png|ico|jpg|jpeg|webp|gif)$/.test(data.icon)) {
    throw new Error('网站仓库 website.json 无效；需提供网站 id、name、host 与 assets/ 下的图标文件')
  }
  return { version: 1, ...identity, icon: data.icon }
}
export const parseGitHubWebsiteUrl = (input: string): { owner: string; name: string; branch?: string; root?: string; url: string } => {
  const raw = input.trim()
  let url: URL
  try { url = new URL(raw.includes('://') ? raw : `https://github.com/${raw}`) } catch { throw new Error('请输入 GitHub 仓库链接或 owner/repo') }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) throw new Error('仅支持公开 GitHub 仓库的 HTTPS 链接')
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  const [owner, rawName] = parts
  const name = rawName?.replace(/\.git$/, '')
  if (!owner || !name || !/^[a-zA-Z0-9-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new Error('GitHub 仓库链接无效')
  if (parts.length !== 2 && !(parts.length >= 5 && parts[2] === 'tree')) throw new Error('请填写仓库链接，或 tree/分支/网站目录链接')
  const branch = parts.length > 2 ? parts[3] : undefined
  const root = parts.length > 2 ? parts.slice(4).join('/') : undefined
  if (branch && !/^[a-zA-Z0-9_.-]+$/.test(branch)) throw new Error('此目录链接的分支名不支持，请使用仓库首页链接')
  if (root && !/^(?:skills|\.agents\/skills)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(root)) throw new Error('网站包目录应为 skills/<id> 或 .agents/skills/<id>')
  return { owner, name, branch, root, url: `https://github.com/${owner}/${name}` }
}
export const repositoryIcon = (path: string, bytes: Uint8Array): WebsiteRepositoryIcon => {
  if (!bytes.length || bytes.length > 256 * 1024) throw new Error('网站仓库图标为空或超过 256 KB')
  const signature = new TextDecoder().decode(bytes.slice(0, 12))
  let mime = ''
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) mime = 'image/png'
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg'
  else if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) mime = 'image/x-icon'
  else if (/^GIF8[79]a/.test(signature)) mime = 'image/gif'
  else if (signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP') mime = 'image/webp'
  if (!mime) throw new Error('网站图标不是支持的图片，不能用网页、脚本或外部链接代替')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { path, dataUrl: `data:${mime};base64,${btoa(binary)}` }
}
