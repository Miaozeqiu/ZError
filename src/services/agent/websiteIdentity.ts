import { reactive } from 'vue'

export const BUILTIN_WEBSITES = [
  { id: 'chaoxing', name: '学习通', host: 'chaoxing.com' },
  { id: 'zhihuishu', name: '智慧树', host: 'zhihuishu.com' },
  { id: 'zjooc', name: '在浙学', host: 'zjooc.cn' },
] as const

export type WebsiteIdentity = { host: string; name: string; loginHosts: string[]; credentialsApproved?: boolean; iconUrl?: string; iconDataUrl?: string }
// Verified service relationship. It does not create a website card until the site is used.
const VERIFIED_WEBSITES: WebsiteIdentity[] = [
  { host: 'menhu.haou.edu.cn', name: '河南开放大学·云上河开', loginHosts: ['authserver.open.ha.cn'] },
]
const KEY = 'zerror-website-identities'
const FILE = '.local/share/zerror/website-identities.json'
export const websiteIdentityState = reactive({ profiles: [] as WebsiteIdentity[], ready: false })
let revision = 0
let hydrated: Promise<void> | undefined
let persistence = Promise.resolve()

export const normalizeWebsiteHost = (value: string): string | null => {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
    if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host)) return null
    return host
  } catch { return null }
}

const seedProfiles = (): WebsiteIdentity[] => [
  ...BUILTIN_WEBSITES.map(site => ({ host: site.host, name: site.name, loginHosts: [] as string[] })),
  ...VERIFIED_WEBSITES.map(site => ({ ...site, loginHosts: [...site.loginHosts] })),
]
const mergeProfiles = (rows: unknown): WebsiteIdentity[] => {
  const merged = seedProfiles()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.host !== 'string' || normalizeWebsiteHost(row.host) !== row.host) continue
    // A login host cannot become another website's primary host.
    if (merged.some(site => site.host !== row.host && site.loginHosts.includes(row.host))) continue
    const previous = merged.find(site => site.host === row.host)
    const loginHosts = [...new Set([...(VERIFIED_WEBSITES.find(site => site.host === row.host)?.loginHosts || []), ...(Array.isArray(row.loginHosts) ? row.loginHosts : previous?.loginHosts || [])])]
      .filter((host): host is string => typeof host === 'string' && normalizeWebsiteHost(host) === host && host !== row.host)
      .filter(host => !merged.some(site => site.host !== row.host && (site.host === host || site.loginHosts.includes(host))))
    const next = {
      host: row.host, name: String(row.name || previous?.name || row.host).trim(), loginHosts,
      credentialsApproved: row.credentialsApproved === true,
      ...(typeof row.iconUrl === 'string' && /^https?:\/\//i.test(row.iconUrl) ? { iconUrl: row.iconUrl } : {}),
      ...(typeof row.iconDataUrl === 'string' && /^data:image\/(?:png|jpeg|gif|webp|x-icon|svg\+xml);base64,[a-zA-Z0-9+/=]+$/.test(row.iconDataUrl) && row.iconDataUrl.length <= 360000 ? { iconDataUrl: row.iconDataUrl } : {}),
    }
    if (previous) Object.assign(previous, next)
    else merged.push(next)
  }
  return merged
}
const readLocal = () => {
  try { const rows = JSON.parse(localStorage.getItem(KEY) || '{}').profiles; return Array.isArray(rows) ? rows : [] } catch { return [] }
}
const writeLocal = () => {
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, profiles: websiteIdentityState.profiles })) } catch { /* non-browser tests/quota */ }
}
websiteIdentityState.profiles = mergeProfiles(readLocal())

export const loadWebsiteIdentities = () => {
  if (hydrated) return hydrated
  const startedAt = revision
  hydrated = (async () => {
    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const stored = JSON.parse(await readTextFile(FILE, { baseDir: BaseDirectory.Home }))
      if (revision === startedAt) websiteIdentityState.profiles = mergeProfiles([
        ...(Array.isArray(stored?.profiles) ? stored.profiles : []), ...readLocal(),
      ])
    } catch { /* first run */ }
    websiteIdentityState.ready = true
    writeLocal()
  })()
  return hydrated
}

export const websiteIdentityForHost = (input: string): WebsiteIdentity | null => {
  const known = BUILTIN_WEBSITES.find(site => site.id === input)
  const host = known?.host || normalizeWebsiteHost(input)
  if (!host) return null
  const exact = websiteIdentityState.profiles.find(site => site.host === host || site.loginHosts.includes(host))
  if (exact) return exact
  const family = BUILTIN_WEBSITES.find(site => host.endsWith(`.${site.host}`))
  if (family) return websiteIdentityState.profiles.find(site => site.host === family.host) || null
  return { host, name: host, loginHosts: [] }
}
export const websitePrimaryHost = (input: string) => websiteIdentityForHost(input)?.host || ''
export const websiteAccountId = (input: string): string => {
  const host = websitePrimaryHost(input)
  return BUILTIN_WEBSITES.find(site => site.host === host)?.id || host || input
}
export const websiteLabel = (id: string) => websiteIdentityForHost(id)?.name || id
export const websiteHostPattern = (input: string) => {
  const site = websiteIdentityForHost(input)
  if (!site) return ''
  const hosts = [site.host, ...site.loginHosts].map(host => host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return `^https?://(?:www\\.)?(?:${hosts.join('|')})(?::\\d+)?(?:[/?#]|$)`
}

export const saveWebsiteIdentity = async (hostInput: string, name: string, loginInputs?: string[], icon?: { url: string; dataUrl: string }, credentialsApproved = false) => {
  await loadWebsiteIdentities()
  const pending = persistence.then(async () => {
    const host = websitePrimaryHost(hostInput)
    if (!host) throw new Error('请输入有效的网站网址')
    const old = websiteIdentityForHost(host)
    const loginHosts: string[] = []
    for (const value of loginInputs ?? old?.loginHosts ?? []) {
      const alias = normalizeWebsiteHost(value.trim())
      if (!alias) throw new Error(`登录域名无效：${value}`)
      if (alias === host) continue
      const owner = websiteIdentityForHost(alias)
      if (owner?.host !== alias && owner?.host !== host) throw new Error('登录域名已关联其他网站')
      if (websiteIdentityState.profiles.some(site => site.host !== host && (site.host === alias || site.loginHosts.includes(alias)))) throw new Error('登录域名已属于其他网站')
      if (!loginHosts.includes(alias)) loginHosts.push(alias)
    }
    const required = VERIFIED_WEBSITES.find(site => site.host === host)?.loginHosts || []
    const next: WebsiteIdentity = {
      host, name: name.trim() || old?.name || host, credentialsApproved: credentialsApproved || old?.credentialsApproved === true, loginHosts: [...new Set([...required, ...loginHosts])],
      ...(old?.iconUrl ? { iconUrl: old.iconUrl } : {}),
      ...(old?.iconDataUrl ? { iconDataUrl: old.iconDataUrl } : {}),
      ...(icon ? { iconUrl: icon.url, iconDataUrl: icon.dataUrl } : {}),
    }
    const profiles = websiteIdentityState.profiles.filter(site => site.host !== host)
    profiles.push(next)
    const snapshot = JSON.stringify({ version: 1, profiles }, null, 2)
    const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir('.local/share/zerror', { baseDir: BaseDirectory.Home, recursive: true })
    await writeTextFile(FILE, snapshot, { baseDir: BaseDirectory.Home })

    revision += 1
    websiteIdentityState.profiles = profiles
    writeLocal()
    return next
  })
  persistence = pending.then(() => undefined, () => undefined)
  return pending
}
