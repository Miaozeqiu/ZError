import { ZERROR_OPEN_ORIGIN } from '../app/openApi'
import { validateWebsiteSnapshot, type WebsiteSnapshot } from './websiteRepositoryCore'
import { limitedJson, WebsiteRepositoryHttpError } from './websiteRepositoryGitHub'

const commitSha = /^[a-f0-9]{40}$/

export async function downloadOpenWebsiteExperience(
  identity: { id: string; host: string },
  previous: WebsiteSnapshot,
  request: typeof fetch,
): Promise<WebsiteSnapshot> {
  const revision = previous.website && previous.icon && commitSha.test(previous.revision) ? previous.revision : ''
  const url = new URL(ZERROR_OPEN_ORIGIN + '/v1/website-experience/' + encodeURIComponent(identity.host))
  if (revision) url.searchParams.set('revision', revision)
  const response = await request(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(16000),
    redirect: 'error',
    credentials: 'omit',
  })

  if (!response.ok) {
    const retry = Number(response.headers.get('retry-after'))
    throw new WebsiteRepositoryHttpError(
      `网站经验更新失败（HTTP ${response.status}），已保留本地内容`,
      Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000,
    )
  }

  const data = await limitedJson(response, 13 * 1024 * 1024)
  if (revision && data?.unchanged === true && data.revision === revision) {
    return { ...previous, checkedAt: Date.now() }
  }
  if (typeof data?.revision !== 'string' || !commitSha.test(data.revision) || !data.website || !data.icon) {
    throw new Error('网站经验快照不完整，已保留本地内容')
  }
  const snapshot: WebsiteSnapshot = {
    revision: data.revision,
    files: data.files,
    website: data.website,
    icon: data.icon,
    checkedAt: Date.now(),
  }
  validateWebsiteSnapshot(snapshot, identity)
  return snapshot
}
