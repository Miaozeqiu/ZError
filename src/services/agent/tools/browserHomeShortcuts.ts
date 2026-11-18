import { resolveResource } from '@tauri-apps/api/path'
import { browserHomeUrl, navigateBrowserView } from '../../browser/appBrowser'
import { evalBrowserViewMain } from '../../browser/eval'
import { invalidatePageSnap } from '../../browser/engine/pageSnap'
import { rememberPageRefs } from '../../browser/engine/refs'
import { videoWatchFor } from '../../platform/panelAccess'

type Context = {
  browserId: string
  role?: string
  args: Record<string, unknown>
  wait: (ms: number) => Promise<void>
  onNavigation?: () => void
}
type Reply = { ok: boolean; reason?: string; error?: string }
let pending = Promise.resolve()

async function homeUrls() {
  if (import.meta.env.DEV) return [browserHomeUrl(), 'http://localhost:1420/browser-home.html']
  const urls = [browserHomeUrl(), 'tauri://localhost/browser-home.html',
    'https://tauri.localhost/browser-home.html', 'http://tauri.localhost/browser-home.html']
  const resource = await resolveResource('browser-home.html').catch(() => '')
  if (resource.startsWith('/')) {
    urls.push(new URL('file://' + resource.split('/').map(encodeURIComponent).join('/')).href)
  }
  return urls
}

export function handleBrowserHomeShortcuts(context: Context) {
  const result = pending.then(() => manageShortcuts(context))
  pending = result.then(() => undefined, () => undefined)
  return result
}

async function manageShortcuts({ browserId, role, args, wait, onNavigation }: Context): Promise<string> {
  const fail = (reason: string, error: string, clickDispatched = false) => JSON.stringify({ ok: false, reason, error, clickDispatched })
  if (role === 'explore' || typeof args.action !== 'string' || !['list', 'add', 'update', 'remove'].includes(args.action)) {
    return fail('invalid', '无效的导航快捷入口操作。')
  }
  const urls = await homeUrls()
  const script = (command?: Record<string, unknown>) => `(function(){
    const href = location.href.split(/[?#]/, 1)[0];
    if (!${JSON.stringify(urls)}.includes(href)) return { ok: false, reason: 'wrong_page' };
    if (typeof window.__zerrorHomeShortcuts !== 'function') return { ok: false, reason: 'loading' };
    return ${command ? `window.__zerrorHomeShortcuts(${JSON.stringify(command)})` : '{ ok: true }'};
  })()`
  const inspect = async (): Promise<Reply | null> => {
    await wait(0)
    return evalBrowserViewMain(browserId, script()).catch(() => null)
  }
  let reply = await inspect()
  if (reply?.reason === 'wrong_page' || !reply) {
    const watch = videoWatchFor(browserId)
    if (watch && !['done', 'lost'].includes(watch.status)) return fail('invalid', '当前标签有视频监控。请在其他标签打开导航页后再编辑。')
    await wait(0)
    try { await navigateBrowserView(browserId, 'zerror://home') } catch (error) {
      if (String(error).includes('BROWSER_USER_CONTROL')) throw error
      return fail('stale', '未能打开 ZError 的导航首页。')
    }
    onNavigation?.()
  }
  for (let attempt = 0; !reply?.ok && attempt < 15; attempt++) {
    await wait(150)
    reply = await inspect()
  }
  if (!reply?.ok) return fail('not_found', '导航首页暂未加载，请先打开 ZError 的导航页。')
  await wait(0)
  const result: Reply | null = await evalBrowserViewMain(browserId, script(args)).catch(() => null)
  if (result?.reason === 'wrong_page' || result?.reason === 'loading') return fail('stale', '当前页面已变化，请重新打开导航首页。')
  if (result?.ok && args.action !== 'list') {
    invalidatePageSnap(browserId)
    rememberPageRefs(browserId, [])
  }
  if (result) return JSON.stringify(result)
  return fail('verification_required', '导航页未返回操作结果，请先查看当前入口列表。', args.action !== 'list')
}
