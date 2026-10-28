import { isBuiltinRuntimeSkillFile } from './skillRuntimeFiles'
import { loadWebsiteIdentities, normalizeWebsiteHost, websitePrimaryHost, websiteIdentityState } from './websiteIdentity'

const ROOT = '.local/share/zerror/skill-overrides'
const BACKUP = '.local/share/zerror/backups/website-unify-v1/skill-overrides'
let pendingKey = ''
let pending: Promise<{ moved: number; conflicts: string[] }> | undefined

/** Copies are verified before old duplicates are removed. Different contents are never overwritten. */
export const migrateWebsiteSkillOverrides = async (): Promise<{ moved: number; conflicts: string[] }> => {
  await loadWebsiteIdentities()
  const key = JSON.stringify(websiteIdentityState.profiles.map(site => [site.host, site.loginHosts]))
  if (pending) {
    if (pendingKey === key) return pending
    const previous = pending
    await previous
    if (pending === previous) pending = undefined
    return migrateWebsiteSkillOverrides()
  }
  pendingKey = key
  pending = (async () => {
    const { readDir, readTextFile, writeTextFile, mkdir, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const options = { baseDir: BaseDirectory.Home }
    const read = async (path: string) => {
      try { return await readTextFile(path, options) } catch { return null }
    }
    const write = async (path: string, content: string) => {
      await mkdir(path.slice(0, path.lastIndexOf('/')), { ...options, recursive: true })
      await writeTextFile(path, content, options)
      if (await readTextFile(path, options) !== content) throw new Error('网站资料迁移校验失败，保留旧文件')
    }
    const result = { moved: 0, conflicts: [] as string[] }
    const walk = async (dir: string): Promise<string[]> => {
      const rows = await readDir(dir, options).catch(() => [])
      const files: string[] = []
      for (const row of rows) {
        const name = String(row.name || '')
        if (!name || name.includes('..') || /[\\/]/.test(name) || row.isSymlink) continue
        if (row.isDirectory) files.push(...(await walk(`${dir}/${name}`)).map(path => `${name}/${path}`))
        else if (row.isFile) files.push(name)
      }
      return files
    }
    for (const skill of ['chaoxing', 'site-learn']) {
      const sites = await readDir(`${ROOT}/${skill}/sites`, options).catch(() => [])
      for (const site of sites) {
        const host = String(site.name || '')
        if (!site.isDirectory || normalizeWebsiteHost(host) !== host) continue
        const primary = websitePrimaryHost(host)
        if (skill === 'site-learn' && primary === host) continue
        for (const file of await walk(`${ROOT}/${skill}/sites/${host}`)) {
          if (!isBuiltinRuntimeSkillFile(file)) continue
          const relative = `${skill}/sites/${host}/${file}`
          const source = `${ROOT}/${relative}`
          const destination = `${ROOT}/site-learn/sites/${primary}/${file}`
          const content = await read(source)
          if (content === null) continue
          const backup = `${BACKUP}/${relative}`
          const previousBackup = await read(backup)
          if (previousBackup === null) await write(backup, content)
          else if (previousBackup !== content) {
            result.conflicts.push(relative)
            continue
          }
          const target = await read(destination)
          if (target === null) await write(destination, content)
          else if (target !== content) {
            result.conflicts.push(relative)
            continue
          }
          // Recheck the source: concurrent edits must not be removed.
          if (await read(source) === content) {
            await remove(source, options)
            result.moved += 1
          }
        }
      }
    }
    return result
  })().catch(error => { pending = undefined; throw error })
  return pending
}
