export const CHAOXING_LOGIN_URL =
  'https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com'

export const resolveChaoxingLoginUrl = (url: string) => {
  const raw = String(url || '').trim()
  if (!/passport2\.chaoxing\.com/i.test(raw)) return raw
  try {
    const parsed = new URL(raw)
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    if (path === '/' || path === '') return CHAOXING_LOGIN_URL
    if (/^\/login$/i.test(path) && !/newversion=true/i.test(parsed.search)) return CHAOXING_LOGIN_URL
  } catch {
    return CHAOXING_LOGIN_URL
  }
  return raw
}
