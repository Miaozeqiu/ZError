import { agentSkillsState, getSkillFileContent, listSkillFiles, parseSkillFrontmatter, saveSkillFileContent } from './agentSkills'
import { siteAccountsState } from './siteAccounts'
import { BUILTIN_WEBSITES, normalizeWebsiteHost, websiteAccountId, websitePrimaryHost, websiteIdentityForHost, loadWebsiteIdentities, saveWebsiteIdentity, websiteIdentityState } from './websiteIdentity'
import { createSkillMarkdown } from './skillFormat'
import { migrateWebsiteSkillOverrides } from './websiteDataMigration'
import { builtinWebsiteIcons } from './websiteIcons'

export type WebsiteSettingsItem = {
  id: string
  name: string
  host: string
  skillId: string
  siteHost?: string
  files: string[]
  builtin: boolean
  enabled: boolean
  loginHosts: string[]
  iconUrl?: string
}

/** Join by website identity; credentials stay in their existing store, never in public Skill files. */
export const listWebsiteSettings = async (): Promise<WebsiteSettingsItem[]> => {
  await loadWebsiteIdentities()
  await migrateWebsiteSkillOverrides()
  const [chaoxingFiles, learnedFiles] = await Promise.all([listSkillFiles('chaoxing'), listSkillFiles('site-learn')])
  const rows = new Map<string, WebsiteSettingsItem>()
  const enabled = agentSkillsState.items.find(item => item.id === 'site-learn')?.enabled ?? true
  for (const site of BUILTIN_WEBSITES) {
    rows.set(site.id, {
      ...site, name: websiteIdentityForHost(site.host)?.name || site.name, loginHosts: [...(websiteIdentityForHost(site.host)?.loginHosts || [])], builtin: true, skillId: site.id === 'chaoxing' ? 'chaoxing' : 'site-learn',
      siteHost: site.id === 'chaoxing' ? undefined : site.host,
      iconUrl: websiteIdentityForHost(site.host)?.iconDataUrl || builtinWebsiteIcons[site.host],
      files: site.id === 'chaoxing' ? chaoxingFiles : learnedFiles.filter(path => path.startsWith(`sites/${site.host}/`)),
      enabled: site.id === 'chaoxing' ? (agentSkillsState.items.find(item => item.id === site.id)?.enabled ?? true) : enabled,
    })
  }
  const hosts = new Set(learnedFiles.map(path => path.match(/^sites\/([^/]+)\//)?.[1]).filter((host): host is string => Boolean(host)))
  for (const profile of websiteIdentityState.profiles) if (profile.iconDataUrl) hosts.add(profile.host)
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
    rows.set(id, { id, name, host, skillId: 'site-learn', siteHost: host, files, builtin: false, enabled, loginHosts: [...(identity?.loginHosts || [])], iconUrl: identity?.iconDataUrl || identity?.iconUrl })
  }
  return [...rows.values()]
}

export const addWebsiteSettings = async (url: string, name: string, loginHosts?: string[], updateExisting = false) => {
  await loadWebsiteIdentities()
  const normalized = normalizeWebsiteHost(url.trim())
  if (!normalized) throw new Error('请输入有效的网站域名或网址')
  const host = websitePrimaryHost(normalized)
  const existing = (await listWebsiteSettings()).find(site => site.id === websiteAccountId(host))
  const hasMain = existing?.files.includes(existing.siteHost ? `sites/${existing.siteHost}/SKILL.md` : 'SKILL.md')
  if (hasMain && !updateExisting) return existing!
  const identity = websiteIdentityForHost(host)
  const label = name.trim() || existing?.name || identity?.name || host
  await saveWebsiteIdentity(host, label, loginHosts ?? identity?.loginHosts ?? [], undefined, true)
  if (!hasMain) {
    await saveSkillFileContent('site-learn', `sites/${host}/SKILL.md`, createSkillMarkdown(host, `${label}的操作经验与导航。`, label, `\n# ${label.replace(/[\r\n]/g, ' ')}\n\n网站：${host}\n\n尚未记录操作经验。Agent 验证流程后在此补充步骤。\n`))
  }
  return { id: websiteAccountId(host), name: label, host }
}
