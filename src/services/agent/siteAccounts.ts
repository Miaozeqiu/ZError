import { reactive } from 'vue'
import { BUILTIN_WEBSITES, normalizeWebsiteHost, websiteAccountId, websiteLabel } from './websiteIdentity'
import { readSecureDocument, writeSecureDocument, isSecretReference } from '../security/secureStore'

export type SiteAccountId = string
/** account/password hold opaque references after secure persistence, never decrypted values. */
export type SiteAccount = { account: string; password: string; accountLabel?: string; note: string; updatedAt: number }
export const SITE_ACCOUNT_LABELS: Record<string, string> = { chaoxing: '学习通', zhihuishu: '智慧树', zjooc: '在浙学' }
export const SITE_ACCOUNT_IDS = ['chaoxing', 'zhihuishu', 'zjooc']
export const siteAccountsState = reactive({ rows: {} as Partial<Record<string, SiteAccount>>, ready: false, saveError: '' })
let revision = 0
const changedDuringLoad = new Set<string>()
export const siteAccountsReady = readSecureDocument<Partial<Record<string, SiteAccount>>>('site_accounts', 'zerror-site-accounts').then(rows => {
  const merged = rows || {}
  for (const id of changedDuringLoad) {
    if (siteAccountsState.rows[id]) merged[id] = siteAccountsState.rows[id]
    else delete merged[id]
  }
  siteAccountsState.rows = merged; siteAccountsState.ready = true
}).catch(() => { siteAccountsState.saveError = '安全存储未解锁，账号暂不可用。' })
const save = () => {
  const version = ++revision
  void siteAccountsReady.then(() => { if (!siteAccountsState.ready) throw new Error('安全存储尚未解锁'); return writeSecureDocument('site_accounts', JSON.parse(JSON.stringify(siteAccountsState.rows))) }).then(rows => {
    if (revision === version) siteAccountsState.rows = rows
    siteAccountsState.saveError = ''
  }).catch(() => { siteAccountsState.saveError = '账号未能安全保存，请解锁系统凭据存储后重试。' })
}
export const refreshSiteAccounts = async () => {
  await siteAccountsReady
  const rows = await readSecureDocument<Partial<Record<string, SiteAccount>>>('site_accounts')
  siteAccountsState.rows = rows || {}
}
export const siteAccountOf = (id: string) => siteAccountsState.rows[websiteAccountId(id)] || null
export const rememberSiteAccount = (id: string, patch: Partial<Pick<SiteAccount, 'account' | 'password' | 'note'>>) => {
  if (!BUILTIN_WEBSITES.some(site => site.id === id) && normalizeWebsiteHost(id) !== id) throw new Error('无效的网站标识')
  const canonical = websiteAccountId(id)
  if (!siteAccountsState.ready) changedDuringLoad.add(canonical)
  const previous = siteAccountOf(canonical)
  const next: SiteAccount = { account: previous?.account || '', password: previous?.password || '', note: previous?.note || '', ...patch, updatedAt: Date.now() }
  if (!next.account && !next.password && !next.note) delete siteAccountsState.rows[canonical]
  else siteAccountsState.rows[canonical] = next
  save(); return next
}
export const forgetSiteAccount = (id: string) => { if (!siteAccountsState.ready) changedDuringLoad.add(websiteAccountId(id)); delete siteAccountsState.rows[websiteAccountId(id)]; save() }
export const platformFromUrl = (url: string) => normalizeWebsiteHost(url) ? websiteAccountId(url) : null
// Credential recognition is performed by the model via protect_credentials.
// Replaying old user text or observing typing must never resurrect deleted secrets.
export const rememberAccountsFromUserText = (_text: string, _url = '') => undefined
export const recoverSiteAccountsFromTexts = (_texts: string[], _url = '') => undefined
export const rememberLoginTyped = (_url: string, _loc: string, _text: string) => undefined
export const siteAccountsPrompt = (url = '') => {
  const site = platformFromUrl(url)
  const row = site && siteAccountOf(site)
  if (!site || !row) return ''
  return `【凭据变量】${websiteLabel(site)}：账号 ${isSecretReference(row.account) ? row.account : '未配置'}，密码 ${isSecretReference(row.password) ? row.password : '未配置'}。只通过 browser_type(secret_ref=变量) 填写；不要读取真实值，也不要再次向用户索要已配置的凭据。`
}
export const siteAccountsHydrated = () => siteAccountsState.ready
