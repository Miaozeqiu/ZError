import { normalizeWebsiteHost, websitePrimaryHost } from './websiteIdentity'

/** A website's files have one owner, independent of the login host and selected builtin Skill. */
export const resolveWebsiteSkillTarget = (skillId: string, relativePath: string) => {
  const path = String(relativePath || '').trim().replace(/\\/g, '/').split('/').filter(part => part && part !== '.').join('/')
  const match = path.match(/^sites\/([^/]+)\/(.+)$/)
  if (!match || !['chaoxing', 'site-learn'].includes(skillId)) return { skillId, path }
  const host = normalizeWebsiteHost(match[1])
  if (!host) return { skillId, path }
  if (websitePrimaryHost(host) === 'chaoxing.com') return { skillId: 'chaoxing', path: match[2] }
  return { skillId: 'site-learn', path: `sites/${websitePrimaryHost(host)}/${match[2]}` }
}
