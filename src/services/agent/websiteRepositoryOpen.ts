import { ZERROR_OPEN_ORIGIN } from '../app/openApi'
import { validateWebsiteSnapshot, type WebsiteSnapshot } from './websiteRepositoryCore'
import { limitedJson, WebsiteRepositoryHttpError } from './websiteRepositoryGitHub'
import { websiteManifest } from './websiteRepositoryManifest'

const commitSha = /^[a-f0-9]{40}$/

export function customWebsiteExperienceUrl(input: string): string {
  if (!/^https?:\/\//i.test(input.trim())) throw new Error('请输入完整的 HTTP 或 HTTPS 地址。')
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new Error('请输入完整的 HTTP 或 HTTPS 地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('请输入 HTTP 或 HTTPS 地址，地址中不能包含账号密码或锚点。')
  }
  return url.href
}

export async function downloadCustomWebsiteExperience(
  url: string,
  identity: { id?: string; host: string },
  request: typeof fetch,
): Promise<WebsiteSnapshot> {
  return fetchWebsiteExperience(customWebsiteExperienceUrl(url), identity, request)
}

export async function downloadOpenWebsiteExperience(
  identity: { id: string; host: string },
  previous: WebsiteSnapshot,
  request: typeof fetch,
): Promise<WebsiteSnapshot> {
  const url = new URL(ZERROR_OPEN_ORIGIN + '/v1/website-experience/' + encodeURIComponent(identity.host))
  return fetchWebsiteExperience(url.href, identity, request, previous)
}

async function fetchWebsiteExperience(
  endpoint: string,
  identity: { id?: string; host: string },
  request: typeof fetch,
  previous?: WebsiteSnapshot,
): Promise<WebsiteSnapshot> {
  const revision = previous?.website && previous.icon && commitSha.test(previous.revision) ? previous.revision : ''
  const url = new URL(endpoint)
  if (revision) url.searchParams.set('revision', revision)
  const headers = previous ? { Accept: 'application/json' } : { Accept: 'application/json', 'Cache-Control': 'no-cache' }
  const init: RequestInit & { maxRedirections: number } = {
    headers,
    signal: AbortSignal.timeout(previous ? 16000 : 8000),
    redirect: 'error',
    maxRedirections: 0,
    credentials: 'omit',
  }
  const response = await request(url.href, init).catch((error: unknown) => {
    if (previous) throw error
    throw new Error('无法连接自定义网站经验接口，请检查地址和服务状态。')
  })

  if (!response.ok) {
    const retry = Number(response.headers.get('retry-after'))
    throw new WebsiteRepositoryHttpError(
      `网站经验更新失败（HTTP ${response.status}），已保留本地内容`,
      Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : previous ? 60 : 10) * 1000,
    )
  }

  const data = await limitedJson(response, 13 * 1024 * 1024).catch((error: unknown) => {
    if (!previous && error instanceof SyntaxError) throw new Error('自定义地址应返回网站经验 JSON。')
    throw error
  })
  if (revision && data?.unchanged === true && data.revision === revision) {
    return { ...previous, checkedAt: Date.now() }
  }
  if (!data?.website || !data.icon || (previous && (typeof data.revision !== 'string' || !commitSha.test(data.revision)))) {
    throw new Error('网站经验快照不完整，已保留本地内容')
  }
  const website = websiteManifest(data.website)
  if (website.host !== identity.host || (identity.id && website.id !== identity.id)) {
    throw new Error('响应中的网站标识或域名与当前网站不一致。')
  }
  const snapshot: WebsiteSnapshot = {
    revision: typeof data.revision === 'string' && data.revision.trim() && data.revision.length <= 128 ? data.revision : 'custom-http',
    files: data.files,
    website,
    icon: data.icon,
    checkedAt: Date.now(),
    ...(!previous && typeof data.scriptManifest === 'string' && data.scriptManifest.length <= 2048 ? { scriptManifest: data.scriptManifest } : {}),
  }
  validateWebsiteSnapshot(snapshot, website)
  return snapshot
}
