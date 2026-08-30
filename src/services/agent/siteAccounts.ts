export type SiteAccountId = 'chaoxing' | 'zhihuishu'

export type SiteAccount = {
  account: string
  password: string
  updatedAt: number
}

const STORAGE_KEY = 'zerror-site-accounts'
const FILE_NAME = 'site-accounts.json'

const LABELS: Record<SiteAccountId, string> = {
  chaoxing: '学习通',
  zhihuishu: '智慧树',
}

const isPlatform = (value: string): value is SiteAccountId => (
  value === 'chaoxing' || value === 'zhihuishu'
)

let memory: Partial<Record<SiteAccountId, SiteAccount>> = {}
let fileReady = false

const asRow = (row: Partial<SiteAccount> | undefined): SiteAccount | null => {
  const account = String(row?.account || '').trim()
  const password = String(row?.password || '')
  if (!account && !password) return null
  return {
    account,
    password,
    updatedAt: Number(row?.updatedAt) || Date.now(),
  }
}

const mergeRow = (prev: SiteAccount | undefined, next: SiteAccount) => {
  const newer = !prev || (next.updatedAt || 0) >= (prev.updatedAt || 0)
  return {
    account: (newer ? next.account : prev.account) || next.account || prev?.account || '',
    password: (newer ? next.password : prev.password) || next.password || prev?.password || '',
    updatedAt: Math.max(next.updatedAt || 0, prev?.updatedAt || 0, Date.now()),
  }
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
  memory = all
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
    for (const id of ['chaoxing', 'zhihuishu'] as SiteAccountId[]) {
      const row = list[id]
      if (!row) continue
      out[id] = mergeRow(out[id], row)
    }
  }
  return out
}

const loadAll = (): Partial<Record<SiteAccountId, SiteAccount>> => {
  memory = mergeAll(memory, readLocal())
  return memory
}

const saveAll = (all: Partial<Record<SiteAccountId, SiteAccount>>) => {
  writeLocal(all)
  persistFile(all)
}

memory = readLocal()
void loadFile().then((file) => {
  memory = mergeAll(memory, file)
  writeLocal(memory)
  fileReady = true
})

export const siteAccountOf = (id: SiteAccountId) => loadAll()[id] || null

export const rememberSiteAccount = (
  id: SiteAccountId,
  patch: Partial<Pick<SiteAccount, 'account' | 'password'>>,
) => {
  const account = String(patch.account || '').trim()
  const password = String(patch.password || '')
  if (!account && !password) return siteAccountOf(id)
  const all = loadAll()
  const next = mergeRow(all[id], {
    account,
    password,
    updatedAt: Date.now(),
  })
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
  if (/zhihuishu\.com/i.test(url)) return 'zhihuishu'
  if (/chaoxing\.com/i.test(url)) return 'chaoxing'
  return null
}

const platformFromText = (text: string): SiteAccountId => {
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

export const rememberAccountsFromUserText = (text: string) => {
  const raw = String(text || '')
  if (!raw.trim()) return
  // 「忘记密码」是登录页链接，不能当成用户要忘掉已记账号
  if (/(忘掉|删掉|清除)(我的)?(学习通|智慧树|超星)?(账号|密码)/.test(raw) || /不要再记(住)?(账号|密码)/.test(raw)) {
    if (/智慧树|zhihuishu/i.test(raw)) forgetSiteAccount('zhihuishu')
    if (/学习通|超星|chaoxing/i.test(raw) || !/智慧树|zhihuishu/i.test(raw)) forgetSiteAccount('chaoxing')
    return
  }
  const pair = takePair(raw)
  if (!pair) return
  rememberSiteAccount(platformFromText(raw), pair)
}

export const recoverSiteAccountsFromTexts = (texts: string[]) => {
  for (const text of texts) rememberAccountsFromUserText(text)
}

export const rememberLoginTyped = (url: string, loc: string, text: string) => {
  const platform = platformFromUrl(url)
  const value = String(text || '').trim()
  if (!platform || !value) return
  const where = String(loc || '')
  const onLogin = /passport2|\/login/i.test(url)
  if (/phone|#phone|uname|账号|手机号|超星号/i.test(where) || /^1\d{10}$/.test(value)) {
    rememberSiteAccount(platform, { account: value })
    return
  }
  if (/pwd|password|#pwd|密码/i.test(where) || (onLogin && value.length >= 4 && !/^1\d{10}$/.test(value))) {
    rememberSiteAccount(platform, { password: value })
  }
}

export const siteAccountsPrompt = () => {
  const all = loadAll()
  const lines = (Object.entries(all) as [SiteAccountId, SiteAccount][])
    .filter(([, row]) => row.account && row.password)
    .map(([id, row]) => `${LABELS[id]} 账号 ${row.account} 密码 ${row.password}`)
  if (!lines.length) return ''
  return `【已记账号】${lines.join('；')}。这是跨对话长期记忆，用户不用再报。登录页直接填，不要问用户要密码。`
}

export const siteAccountsHydrated = () => fileReady
