import { computed, ref } from 'vue'
import { campusAvatarUrl, getUserCampus, uploadCampusAvatar } from './campus'
import {
  AUTH_API_BASE,
  RemoteApiError,
  readStoredAuthToken,
  rememberAuthToken,
  remoteJson,
} from './remoteHttp'

export interface AuthUser {
  id: number
  nickname: string
  created_at?: string
  api_call_count?: number
  status?: string
  is_trusted?: boolean
  is_bound_qq?: boolean
  class_id?: number | null
  campus_id?: number | null
  campus_name?: string | null
  api_token?: string
  avatar?: string | null
}

const USER_KEY = 'zerror-auth-user'

export const authToken = ref('')
export const authUser = ref<AuthUser | null>(null)
export const authReady = ref(false)
export const authLoading = ref(false)
export const isLoggedIn = computed(() => Boolean(authToken.value))

export function openLoginDialog() {
  window.dispatchEvent(new Event('open-login'))
}

const emitAuthChanged = () => {
  window.dispatchEvent(new CustomEvent('auth-changed', {
    detail: { loggedIn: isLoggedIn.value, user: authUser.value },
  }))
}

const persistUser = (user: AuthUser | null) => {
  persistUserLocalOnly(user)
  void writeAuthFile(authToken.value, user)
}

const persistToken = (token: string) => {
  rememberAuthToken(token)
  void writeAuthFile(token, authUser.value)
}

const parseCachedUser = (raw: string | null): AuthUser | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const user = parsed as AuthUser
    if (!Number.isFinite(Number(user.id)) || Number(user.id) <= 0) return null
    return user
  } catch {
    return null
  }
}

const readCachedUser = (): AuthUser | null => {
  try {
    return parseCachedUser(localStorage.getItem(USER_KEY))
  } catch {
    return null
  }
}

const writeAuthFile = async (token: string, user: AuthUser | null) => {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    if (!token) {
      await invoke('write_auth', { content: '' })
      return
    }
    await invoke('write_auth', {
      content: JSON.stringify({ token, user }, null, 2),
    })
  } catch {
    // 非 Tauri 或写盘失败时仍保留 localStorage
  }
}

const readAuthFile = async (): Promise<{ token: string; user: AuthUser | null }> => {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = await invoke<string>('read_auth')
    if (!raw?.trim()) return { token: '', user: null }
    const parsed = JSON.parse(raw)
    const token = String(parsed?.token || '').trim()
    const userRaw = parsed?.user
    const user = token && userRaw && typeof userRaw === 'object'
      ? parseCachedUser(JSON.stringify(userRaw))
      : null
    return { token, user }
  } catch {
    return { token: '', user: null }
  }
}

const hydrateLocalSession = (token: string, user: AuthUser | null) => {
  rememberAuthToken(token)
  persistUserLocalOnly(token ? user : null)
  authToken.value = token
  authUser.value = token ? user : null
}

const persistUserLocalOnly = (user: AuthUser | null) => {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    // ignore
  }
}

hydrateLocalSession(readStoredAuthToken(), readCachedUser())

const normalizeUser = (raw: any): AuthUser | null => {
  const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw
  if (!data || typeof data !== 'object') return null
  const id = Number(data.id)
  const nickname = String(data.nickname || '').trim()
  if (!Number.isFinite(id) || id <= 0) return null
  return {
    id,
    nickname: nickname || `用户${id}`,
    created_at: data.created_at,
    api_call_count: Number(data.api_call_count) || 0,
    status: data.status,
    is_trusted: Boolean(data.is_trusted),
    is_bound_qq: Boolean(data.is_bound_qq),
    class_id: data.class_id ?? null,
    campus_id: data.campus_id ?? null,
    campus_name: data.campus_name ?? null,
    api_token: data.api_token,
    avatar: String(data.avatar || '').trim() || null,
  }
}

const attachCampusAvatar = async (user: AuthUser) => {
  try {
    const identity = await getUserCampus(user.id)
    if (identity.avatar) user.avatar = identity.avatar
  } catch {
    // 校园接口失败时保留 zzx / 本地头像
  }
  return user
}

export async function fetchAuthUser() {
  const raw = await remoteJson(`${AUTH_API_BASE}/api/user/info`)
  const user = normalizeUser(raw)
  if (!user) throw new Error('无法读取用户信息')
  await attachCampusAvatar(user)
  authUser.value = user
  persistUser(user)
  emitAuthChanged()
  return user
}

export async function uploadAuthAvatar(file: File) {
  const avatar = await uploadCampusAvatar(file)
  if (!authUser.value) throw new Error('请先登录')
  authUser.value = { ...authUser.value, avatar }
  persistUser(authUser.value)
  emitAuthChanged()
  return avatar
}

export async function applyAuthSession(token: string, user?: AuthUser | null) {
  authToken.value = token
  persistToken(token)
  if (user) {
    authUser.value = user
    persistUser(user)
  }
  try {
    return await fetchAuthUser()
  } catch (error) {
    if (authUser.value) {
      emitAuthChanged()
      return authUser.value
    }
    throw error
  }
}

export function clearAuthSession() {
  authToken.value = ''
  authUser.value = null
  persistToken('')
  persistUser(null)
  emitAuthChanged()
}

export async function logoutAuth() {
  clearAuthSession()
}

export async function triggerWechatLogin() {
  const data = await remoteJson<{ verification_code?: string }>(
    `${AUTH_API_BASE}/trigger_login`,
    { method: 'POST', body: '{}' },
    false,
  )
  const code = String(data?.verification_code || '').trim()
  if (!code) throw new Error('没有拿到验证码，请重试')
  return code
}

export async function pollWechatLogin(verificationCode: string) {
  const data = await remoteJson<any>(
    `${AUTH_API_BASE}/polling`,
    {
      method: 'POST',
      body: JSON.stringify({ verification_code: verificationCode }),
    },
    false,
  )
  if (data?.error) {
    throw new Error(String(data.error))
  }
  if (!data?.logged_in) {
    return { loggedIn: false as const }
  }
  const token = String(data?.user?.token || '').trim()
  if (!token) throw new Error('登录成功但没有返回 Token')
  const nickname = String(data?.user?.nickname || '').trim()
  const user = await applyAuthSession(token, nickname ? {
    id: Number(data?.user?.id) || 0,
    nickname,
  } : null)
  return { loggedIn: true as const, user }
}

export async function restoreAuthSession() {
  if (authReady.value) return isLoggedIn.value
  authLoading.value = true
  try {
    const stored = await readAuthFile()
    const token = stored.token || readStoredAuthToken()
    const cached = stored.user || readCachedUser()
    hydrateLocalSession(token, cached)
    if (token && cached) emitAuthChanged()
    if (!token) return false

    void writeAuthFile(token, cached)

    try {
      await fetchAuthUser()
    } catch (error) {
      if (error instanceof RemoteApiError && (error.status === 401 || error.status === 404)) {
        clearAuthSession()
        return false
      }
      if (authUser.value) {
        emitAuthChanged()
        return true
      }
    }
    return isLoggedIn.value
  } finally {
    authLoading.value = false
    authReady.value = true
  }
}

export function userDisplayName(user = authUser.value) {
  return user?.nickname || '已登录'
}

export function userInitial(user = authUser.value) {
  const name = userDisplayName(user).trim()
  return name.slice(0, 1) || '我'
}

export function userAvatarSrc(user = authUser.value) {
  return campusAvatarUrl(user?.avatar)
}
