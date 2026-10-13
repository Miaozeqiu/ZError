import { reactive } from 'vue'

export type SiteAccountId = 'chaoxing' | 'zhihuishu' | 'zjooc'

export type SiteAccount = {
  account: string
  password: string
  note: string
  updatedAt: number
}

const STORAGE_KEY = 'zerror-site-accounts'
const FILE_NAME = 'site-accounts.json'

export const SITE_ACCOUNT_LABELS: Record<SiteAccountId, string> = {
  chaoxing: '学习通',
  zhihuishu: '智慧树',
  zjooc: '在浙学',
}

export const SITE_ACCOUNT_IDS: SiteAccountId[] = ['chaoxing', 'zhihuishu', 'zjooc']

const LABELS = SITE_ACCOUNT_LABELS

const isPlatform = (value: string): value is SiteAccountId => (
  value === 'chaoxing' || value === 'zhihuishu' || value === 'zjooc'
)

/** 供设置页响应式读取 */
export const siteAccountsState = reactive({
  rows: {} as Partial<Record<SiteAccountId, SiteAccount>>,
  ready: false,
})

let memory: Partial<Record<SiteAccountId, SiteAccount>> = {}
let fileReady = false

const asRow = (row: Partial<SiteAccount> | undefined): SiteAccount | null => {
  const account = String(row?.account || '').trim()
  const password = String(row?.password || '')
  const note = String(row?.note || '').trim()
  if (!account && !password && !note) return null
  return {
    account,
    password,
    note,
    updatedAt: Number(row?.updatedAt) || Date.now(),
  }
}

const mergeRow = (prev: SiteAccount | undefined, next: SiteAccount) => {
  const newer = !prev || (next.updatedAt || 0) >= (prev.updatedAt || 0)
  return {
    account: (newer ? next.account : prev.account) || next.account || prev?.account || '',
    password: (newer ? next.password : prev.password) || next.password || prev?.password || '',
    // 备注允许显式清空，不能用 || 回落到旧值
    note: newer ? String(next.note || '') : String(prev?.note || next.note || ''),
    updatedAt: Math.max(next.updatedAt || 0, prev?.updatedAt || 0, Date.now()),
  }
}

const syncState = (all: Partial<Record<SiteAccountId, SiteAccount>>) => {
  memory = all
  siteAccountsState.rows = { ...all }
  siteAccountsState.ready = fileReady
}

const readLocal = (): Partial<Record<SiteAccountId, SiteAccount>> => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, SiteAccount>
    const out: Partial<Record<SiteAccountId, SiteAccount>> = {}
    for (const [key, row] of Object.entries(raw || {})) {
      if (!isPlatform(key)) continue
      const parsed = asRow(row)
      if (parsed) out[key] = parsed
    }
    return out
  } catch {
    return {}
  }
}

const writeLocal = (all: Partial<Record<SiteAccountId, SiteAccount>>) => {
  syncState(all)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // quota
  }
}

const persistFile = (all: Partial<Record<SiteAccountId, SiteAccount>>) => {
  void import('@tauri-apps/plugin-fs').then(async ({ writeTextFile, mkdir, BaseDirectory }) => {
    await mkdir('.local/share/zerror', { baseDir: BaseDirectory.Home, recursive: true }).catch(() => undefined)
    await writeTextFile(`.local/share/zerror/${FILE_NAME}`, JSON.stringify(all), {
      baseDir: BaseDirectory.Home,
    })
  }).catch(() => undefined)
}

const loadFile = async (): Promise<Partial<Record<SiteAccountId, SiteAccount>>> => {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = JSON.parse(await readTextFile(`.local/share/zerror/${FILE_NAME}`, {
      baseDir: BaseDirectory.Home,
    })) as Record<string, SiteAccount>
    const out: Partial<Record<SiteAccountId, SiteAccount>> = {}
    for (const [key, row] of Object.entries(raw || {})) {
      if (!isPlatform(key)) continue
      const parsed = asRow(row)
      if (parsed) out[key] = parsed
    }
    return out
  } catch {
    return {}
  }
}

const mergeAll = (
  ...lists: Partial<Record<SiteAccountId, SiteAccount>>[]
) => {
  const out: Partial<Record<SiteAccountId, SiteAccount>> = {}
  for (const list of lists) {
    for (const id of SITE_ACCOUNT_IDS) {
      const row = list[id]
      if (!row) continue
      out[id] = mergeRow(out[id], row)
    }
  }
  return out
}

const loadAll = (): Partial<Record<SiteAccountId, SiteAccount>> => {
  syncState(mergeAll(memory, readLocal()))
  return memory
}

const saveAll = (all: Partial<Record<SiteAccountId, SiteAccount>>) => {
  writeLocal(all)
  persistFile(all)
}

memory = readLocal()
syncState(memory)
void loadFile().then((file) => {
  fileReady = true
  syncState(mergeAll(memory, file))
  writeLocal(memory)
})

export const siteAccountOf = (id: SiteAccountId) => loadAll()[id] || null

export const rememberSiteAccount = (
  id: SiteAccountId,
  patch: Partial<Pick<SiteAccount, 'account' | 'password' | 'note'>>,
) => {
  const account = patch.account !== undefined ? String(patch.account || '').trim() : undefined
  const password = patch.password !== undefined ? String(patch.password || '') : undefined
  const note = patch.note !== undefined ? String(patch.note || '').trim() : undefined
  if (account === undefined && password === undefined && note === undefined) {
    return siteAccountOf(id)
  }
  const all = loadAll()
  const prev = all[id]
  const next = mergeRow(prev, {
    account: account !== undefined ? account : (prev?.account || ''),
    password: password !== undefined ? password : (prev?.password || ''),
    note: note !== undefined ? note : (prev?.note || ''),
    updatedAt: Date.now(),
  })
  if (!next.account && !next.password && !next.note) {
    delete all[id]
    saveAll(all)
    return null
  }
  all[id] = next
  saveAll(all)
  return next
}

export const forgetSiteAccount = (id: SiteAccountId) => {
  const all = loadAll()
  delete all[id]
  saveAll(all)
}

export const platformFromUrl = (url: string): SiteAccountId | null => {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    if (host.endsWith('zhihuishu.com')) return 'zhihuishu'
    if (host.endsWith('chaoxing.com')) return 'chaoxing'
    if (host.endsWith('zjooc.cn')) return 'zjooc'
  } catch {
    if (/zhihuishu\.com/i.test(url)) return 'zhihuishu'
    if (/chaoxing\.com/i.test(url)) return 'chaoxing'
    if (/zjooc\.cn/i.test(url)) return 'zjooc'
  }
  return null
}

const platformFromText = (text: string): SiteAccountId => {
  if (/在浙学|zjooc/i.test(text)) return 'zjooc'
  if (/智慧树|zhihuishu/i.test(text)) return 'zhihuishu'
  return 'chaoxing'
}

const PASSWORD_TOKEN = '([^\\s，。；;！!？?、]{3,64})'
const ACCOUNT_TOKEN = '(\\S{3,32})'

const takePair = (text: string) => {
  const raw = String(text || '')
  const accountFirst = raw.match(new RegExp(`账[户号][:：\\s]*${ACCOUNT_TOKEN}[\\s\\S]{0,48}(?:密码|pwd|password)[:：\\s]*${PASSWORD_TOKEN}`, 'i'))
  if (accountFirst) return { account: accountFirst[1], password: accountFirst[2] }
  const passwordFirst = raw.match(new RegExp(`(?:密码|pwd|password)[:：\\s]*${PASSWORD_TOKEN}[\\s\\S]{0,48}账[户号][:：\\s]*${ACCOUNT_TOKEN}`, 'i'))
  if (passwordFirst) return { account: passwordFirst[2], password: passwordFirst[1] }
  const phoneFirst = raw.match(new RegExp(`(1\\d{10})[\\s\\S]{0,24}(?:密码|pwd|password)[:：\\s]*${PASSWORD_TOKEN}`, 'i'))
  if (phoneFirst) return { account: phoneFirst[1], password: phoneFirst[2] }
  return null
}

const takePasswordOnly = (text: string) => {
  const raw = String(text || '')
  // 「密码是 xxx」「更新密码：xxx」；不要吃「忘记密码」链接文案
  if (/忘记密码|找回密码/.test(raw) && !/密码是|密码[:：]|更新.*密码|改.*密码|换.*密码/.test(raw)) {
    return null
  }
  const hit = raw.match(new RegExp(`(?:密码|pwd|password)[:：是为]\\s*${PASSWORD_TOKEN}`, 'i'))
    || raw.match(new RegExp(`(?:更新|改|换)(?:一下)?密码[:：是为\\s]+${PASSWORD_TOKEN}`, 'i'))
  return hit?.[1] || null
}

export const rememberAccountsFromUserText = (text: string, url = '') => {
  const raw = String(text || '')
  if (!raw.trim()) return
  const fromUrl = platformFromUrl(url)
  // 「忘记密码」是登录页链接，不能当成用户要忘掉已记账号
  if (/(忘掉|删掉|清除)(我的)?(学习通|智慧树|在浙学|超星)?(账号|密码)/.test(raw) || /不要再记(住)?(账号|密码)/.test(raw)) {
    if (/在浙学|zjooc/i.test(raw)) forgetSiteAccount('zjooc')
    if (/智慧树|zhihuishu/i.test(raw)) forgetSiteAccount('zhihuishu')
    if (/学习通|超星|chaoxing/i.test(raw)) forgetSiteAccount('chaoxing')
    if (!/在浙学|zjooc|智慧树|zhihuishu|学习通|超星|chaoxing/i.test(raw)) {
      forgetSiteAccount(fromUrl || 'chaoxing')
    }
    return
  }
  const platform = fromUrl || platformFromText(raw)
  const pair = takePair(raw)
  if (pair) {
    rememberSiteAccount(platform, pair)
    return
  }
  // 只说密码：要有当前页网址或文案点名站点，避免误写到别的槽
  const password = takePasswordOnly(raw)
  if (password && (fromUrl || /在浙学|zjooc|智慧树|zhihuishu|学习通|超星|chaoxing/i.test(raw))) {
    rememberSiteAccount(platform, { password })
  }
}

export const recoverSiteAccountsFromTexts = (texts: string[], url = '') => {
  for (const text of texts) rememberAccountsFromUserText(text, url)
}

export const rememberLoginTyped = (url: string, loc: string, text: string) => {
  const platform = platformFromUrl(url)
  const value = String(text || '').trim()
  if (!platform || !value) return
  const where = String(loc || '')
  // 验证码框经常紧挨着密码。整页 zjooc.cn 都算登录页时，验证码会把刚记下的密码盖掉。
  if (/验证码|captcha|captchacode|ucode|yzm/i.test(where)) return
  if (/phone|#phone|uname|login[_-]?name|username|账号|用户名|手机号|超星号/i.test(where) || /^1\d{10}$/.test(value)) {
    rememberSiteAccount(platform, { account: value })
    return
  }
  if (/pwd|password|#pwd|密码|type=["']?password/i.test(where)) {
    rememberSiteAccount(platform, { password: value })
  }
}

const accountLine = (label: string, row: SiteAccount) => {
  const note = row.note ? `（${row.note}）` : ''
  return `${label} 账号 ${row.account} 密码 ${row.password}${note}`
}

export const siteAccountsPrompt = (url = '') => {
  const all = loadAll()
  if (/zjooc\.cn/i.test(url)) {
    // 旧版曾把在浙学账密写进智慧树/学习通槽，这里兜底读一次
    const row = (all.zjooc?.account && all.zjooc.password)
      ? all.zjooc
      : (all.zhihuishu?.account && all.zhihuishu.password)
        ? all.zhihuishu
        : (all.chaoxing?.account && all.chaoxing.password)
          ? all.chaoxing
          : null
    if (!row) return '【站点】当前页是在浙学（zjooc.cn），不是智慧树。'
    return `【已记账号】${accountLine('在浙学', row)}。登录页直接填，不要问。当前页是在浙学（zjooc.cn），不是智慧树。`
  }
  const lines = (Object.entries(all) as [SiteAccountId, SiteAccount][])
    .filter(([, row]) => row.account && row.password)
    .map(([id, row]) => accountLine(LABELS[id], row))
  if (!lines.length) return ''
  const current = platformFromUrl(url)
  const bits = [`【已记账号】${lines.join('；')}。这是跨对话长期记忆，用户不用再报。登录页直接填，不要问用户要密码。`]
  if (current) bits.push(`当前页用${LABELS[current]}那套。`)
  return bits.join(' ')
}

export const siteAccountsHydrated = () => fileReady
