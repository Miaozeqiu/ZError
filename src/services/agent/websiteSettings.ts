import { agentSkillsState, getSkillFileContent, listSkillFiles, parseSkillFrontmatter, saveSkillFileContent } from './agentSkills'
import { removeWebsiteAccounts, siteAccountsState } from './siteAccounts'
import { BUILTIN_WEBSITES, defaultWebsiteDomains, websiteDomains, normalizeWebsiteHost, websiteAccountId, websitePrimaryHost, websiteIdentityForHost, loadWebsiteIdentities, saveWebsiteIdentity, removeWebsiteIdentity, websiteIdentityState } from './websiteIdentity'
import { createSkillMarkdown } from './skillFormat'
import { migrateWebsiteSkillOverrides, removeWebsiteSkillOverrides } from './websiteDataMigration'
import { builtinWebsiteIcons } from './websiteIcons'
import { websiteIdentityLocked, hasWebsiteRepository, websiteRepositoryHosts, removeWebsiteRepository, websiteRepositoryStates } from './websiteRepository'

export type WebsiteSettingsItem = {
  id: string
  name: string
  host: string
  skillId: string
  siteHost?: string
  files: string[]
  builtin: boolean
  enabled: boolean
  domains: string[]
  iconUrl?: string
  repositoryHost?: string
}

/** Join by website identity; credentials stay in their existing store, never in public Skill files. */
const websiteIcon = (host: string, fallback?: string) => {
  const state = websiteRepositoryStates[host]
  const identity = websiteIdentityForHost(host)
  return (state?.customUrl ? state.iconUrl : identity?.iconDataUrl || state?.iconUrl) || fallback || identity?.iconUrl
}

export const listWebsiteSettings = async (): Promise<WebsiteSettingsItem[]> => {
  await loadWebsiteIdentities()
  await migrateWebsiteSkillOverrides()
  const installed = await websiteRepositoryHosts()
  const [chaoxingFiles, learnedFiles] = await Promise.all([listSkillFiles('chaoxing'), listSkillFiles('site-learn')])
  const rows = new Map<string, WebsiteSettingsItem>()
  const enabled = agentSkillsState.items.find(item => item.id === 'site-learn')?.enabled ?? true
  for (const site of BUILTIN_WEBSITES) {
    const identity = websiteIdentityForHost(site.host)!
    const siteFiles = site.id === 'chaoxing' ? chaoxingFiles : learnedFiles.filter(path => path.startsWith(`sites/${site.host}/`))
    if (!installed.includes(site.host) && !siteFiles.length && !siteAccountsState.rows[site.id] && !identity.iconDataUrl && !identity.credentialsApproved) continue
    rows.set(site.id, {
      ...site, name: identity.name, domains: websiteDomains(identity), builtin: true, skillId: site.id === 'chaoxing' ? 'chaoxing' : 'site-learn',
      siteHost: site.id === 'chaoxing' ? undefined : site.host,
      iconUrl: websiteIcon(site.host, builtinWebsiteIcons[site.host]),
      ...(hasWebsiteRepository(site.host) ? { repositoryHost: site.host } : {}),
      files: siteFiles,
      enabled: site.id === 'chaoxing' ? (agentSkillsState.items.find(item => item.id === site.id)?.enabled ?? true) : enabled,
    })
  }
  const hosts = new Set(learnedFiles.map(path => path.match(/^sites\/([^/]+)\//)?.[1]).filter((host): host is string => Boolean(host)))
  for (const host of installed) hosts.add(host)
  for (const profile of websiteIdentityState.profiles) if (profile.iconDataUrl || profile.credentialsApproved) hosts.add(profile.host)
  for (const id of Object.keys(siteAccountsState.rows)) {
    if (normalizeWebsiteHost(id) === id) hosts.add(id)
  }
  for (const rawHost of hosts) {
    const host = websitePrimaryHost(rawHost)
    if (!host) continue
    const id = websiteAccountId(host)
    if (rows.has(id)) continue
    const files = learnedFiles.filter(path => path.startsWith(`sites/${host}/`))
    const main = files.includes(`sites/${host}/SKILL.md`) ? await getSkillFileContent('site-learn', `sites/${host}/SKILL.md`) : null
    const identity = websiteIdentityForHost(host)
    const recordedName = main ? parseSkillFrontmatter(main.content).displayName : ''
    const name = identity?.name !== host ? identity?.name || host : recordedName || host
    rows.set(id, { id, name, host, skillId: 'site-learn', siteHost: host, files, builtin: false, enabled, domains: identity ? websiteDomains(identity) : [host],
      iconUrl: websiteIcon(host),
      ...(hasWebsiteRepository(host) ? { repositoryHost: host } : {}) })
  }
  return [...rows.values()]
}

export const addWebsiteSettings = async (url: string, name: string, domains?: string[], updateExisting = false) => {
  await loadWebsiteIdentities()
  const normalized = normalizeWebsiteHost(url.trim())
  if (!normalized) throw new Error('请输入有效的网站域名或网址')
  const host = websitePrimaryHost(normalized)
  const existing = (await listWebsiteSettings()).find(site => site.id === websiteAccountId(host))
  const hasMain = existing?.files.includes(existing.siteHost ? `sites/${existing.siteHost}/SKILL.md` : 'SKILL.md')
  if (hasMain && !updateExisting) return existing!
  if (websiteIdentityLocked(host)) throw new Error('当前经验来源已锁定网站域名和名称')
  const identity = websiteIdentityForHost(host)
  const label = name.trim() || existing?.name || identity?.name || host
  // Built-in service domains already belong to the site. Displaying them must
  // not add new credential origins when saving an unrelated setting.
  const defaults = defaultWebsiteDomains(host)
  const additional = domains?.filter(domain => !defaults.includes(domain) || identity?.loginHosts.includes(domain))
  await saveWebsiteIdentity(host, label, additional, undefined, true, domains && defaults.filter(domain => !domains.includes(domain)))
  if (!hasMain) {
    await saveSkillFileContent('site-learn', `sites/${host}/SKILL.md`, createSkillMarkdown(host, `${label}的操作经验与导航。`, label, `\n# ${label.replace(/[\r\n]/g, ' ')}\n\n网站：${host}\n\n尚未记录操作经验。Agent 验证流程后在此补充步骤。\n`))
  }
  return { id: websiteAccountId(host), name: label, host }
}

export const deleteWebsiteSettings = async (host: string) => {
  await loadWebsiteIdentities()
  if (normalizeWebsiteHost(host) !== host || websitePrimaryHost(host) !== host) throw new Error('网站域名无效')
  await removeWebsiteRepository(host, async () => {
    await removeWebsiteAccounts(host)
    await removeWebsiteSkillOverrides(host)
    await removeWebsiteIdentity(host)
  })
}
