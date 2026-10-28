import { invoke } from '@tauri-apps/api/core'
import type { ChatToolHandler } from './toolContext'
import { liveSession, sessions, persistSoon } from './chatStore'
import { redactObject, rememberRedaction } from '../security/secretRedaction'
import { isNativeSecureStore, redactNative, readSecureDocument } from '../security/secureStore'
import { refreshSiteAccounts } from './siteAccounts'
import { websiteAccountId } from './websiteIdentity'

export const protectCredentials: ChatToolHandler = async ({ args, ctx }) => {
  if (!isNativeSecureStore()) return JSON.stringify({ ok: false, error: '凭据登记需要桌面应用的系统安全存储；尚未保存。' })
  const session = liveSession(ctx.parentSessionId || ctx.sessionId)
  const source = args.source_message_id
    ? session?.messages.find(message => message.role === 'user' && message.id === args.source_message_id)
    : [...(session?.messages || [])].reverse().find(message => message.role === 'user')
  if (!source) return JSON.stringify({ ok: false, error: '来源用户消息不存在，不能登记其他来源的秘密。' })
  const fields: Record<string,string> = {}
  for (const field of ['account', 'password', 'api_key']) {
    if (args[field] === undefined) continue
    if (typeof args[field] !== 'string' || !args[field] || /^\{\{secret:/.test(args[field]) || !source.content.includes(args[field])) {
      return JSON.stringify({ ok: false, error: '凭据必须精确出现在指定用户消息中，且不能是已有变量。请核对原文。' })
    }
    fields[field] = args[field]
  }
  if (!Object.keys(fields).length) return JSON.stringify({ ok: false, error: '没有可登记的凭据。' })
  let references: Record<string,string> = {}
  let pending = false
  if (fields.api_key && (fields.account || fields.password)) return JSON.stringify({ ok: false, error: '网站账号与 API Key 请分别登记。' })
  if (fields.api_key) {
    const result = await invoke<{ references: Record<string,string> }>('secure_register_api', { provider: String(args.provider_id || ''), value: fields.api_key })
    references = result.references
  } else {
    const site = args.site ? websiteAccountId(String(args.site)) : `pending-${ctx.sessionId}`
    const result = await invoke<{ references: Record<string,string>; pending?: boolean }>('secure_register', { site, fields })
    references = result.references
    pending = result.pending === true || !args.site
  }
  for (const [field, value] of Object.entries(fields)) rememberRedaction(value, references[field])
  // Includes historical messages, in-flight tool steps, titles, summaries and children.
  // Preserve object identity so an active stream cannot write into detached sessions.
  for (const current of sessions.value) {
    const safe = await redactNative(redactObject(JSON.parse(JSON.stringify(current))))
    Object.assign(current, safe)
  }
  await refreshSiteAccounts()
  if (fields.api_key) {
    const [{ modelConfigManager }, { settingsManager }] = await Promise.all([import('../model/config'), import('../app/settings')])
    const config = await readSecureDocument<any>('model_settings')
    for (const row of config?.platforms || []) {
      const platform = modelConfigManager.getSettings().platforms.find(item => item.id === row.id)
      if (platform) platform.apiKey = row.apiKey
    }
    const settings = await readSecureDocument<any>('app_settings')
    if (settings?.search) Object.assign(settingsManager.getSettings().search, settings.search)
  }
  // A new registration may identify secrets in older experience files as well.
  let cleanupPending = false
  try { await invoke('secure_cleanup_legacy') } catch { cleanupPending = true }
  persistSoon(true)
  return JSON.stringify({ ok: true, references, history_replaced: true, cleanup_pending: cleanupPending,
    hint: !pending ? '之后只使用这些变量；browser_type 使用 secret_ref。' : '已加密暂存。需要用户在网站设置中关联所属网站后才能填写。' })
}
