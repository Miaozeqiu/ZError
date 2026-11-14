// Runs at document start, only in the directly embedded campus website.
(() => {
  if (location.origin !== 'https://tiku.zerrorai.com' || window === window.top || parent !== top) return
  const channel = 'zerror-campus-auth-v1'
  let port = null
  let revision = -1
  let applying = false
  const keys = ['token', 'api_token', 'nickname', 'createdTime', 'user_id', 'userId', 'userStatus']
  const parentOrigins = new Set(['tauri://localhost', 'http://tauri.localhost', 'http://localhost:1420'])

  window.addEventListener('message', (event) => {
    if (event.source !== parent || !parentOrigins.has(event.origin)) return
    if (event.data?.channel !== channel || event.data?.type !== 'connect' || event.ports.length !== 1) return
    port?.close()
    port = event.ports[0]
    const current = port
    current.onmessage = ({ data }) => {
      if (port !== current || data?.type !== 'session' || !Number.isInteger(data.revision)) return
      if (data.revision < revision) return
      if (typeof data.token !== 'string') return
      revision = data.revision
      applying = true
      try {
        const changed = (localStorage.getItem('token') || '') !== data.token
        if (changed || !data.token) keys.forEach(key => localStorage.removeItem(key))
        if (data.token) {
          localStorage.setItem('token', data.token)
          localStorage.setItem('nickname', data.user?.nickname || '')
          localStorage.setItem('user_id', String(data.user?.id || ''))
          localStorage.setItem('createdTime', data.user?.created_at || '')
          localStorage.setItem('userStatus', data.user?.status || '')
        }
        // Reload on account changes to discard account-specific in-memory queries.
        if (changed) location.reload()
        else window.dispatchEvent(new Event('storage'))
      } catch {
        current.postMessage({ type: 'storage-error' })
      } finally {
        applying = false
      }
    }
  })

  const propose = () => {
    if (applying || revision < 0 || !port) return
    port.postMessage({ type: 'change', revision, token: localStorage.getItem('token') || '' })
  }
  window.addEventListener('ze-login-success', propose)
  window.addEventListener('ze-logout', propose)
  // This readiness message contains no credentials. The parent opens a private port.
  parent.postMessage({ channel, type: 'ready' }, '*')
})()
