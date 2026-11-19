import releaseSync from '@jitl/quickjs-wasmfile-release-sync'
import releaseWasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import { memoizePromiseFactory, newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core'
import { isNativeSecureStore } from '../security/secureStore'
import { limitedJson } from './websiteRepositoryGitHub'
import { websiteScriptSource } from './websiteRepository'

type Bundle = { revision: string; etag: string; sha256: string; code: string; checkedAt: number }
type SiteScriptSource = { url: string; manifest: string }
const cached = new Map<string, Bundle>()
const pending = new Map<string, Promise<Bundle>>()
const bundleLimit = 256 * 1024
// Vite prebundles the JS loader in development. Use the app's asset URL for its WASM.
const getQuickJS = memoizePromiseFactory(() => newQuickJSWASMModuleFromVariant(
  typeof window === 'undefined' ? releaseSync : newVariant(releaseSync, { wasmLocation: releaseWasmUrl }),
))

const scriptUrl = (relative: string, base: string, origin: string) => {
  const url = new URL(relative, base)
  if (url.origin !== origin || url.username || url.password || url.hash) throw new Error('脚本清单与产物必须使用已配置的 HTTP 来源。')
  return url.href
}

const readBundle = async (response: Response) => {
  if (Number(response.headers.get('content-length')) > bundleLimit || !response.body) throw new Error('网站脚本大小无效。')
  const bytes = new Uint8Array(bundleLimit)
  const reader = response.body.getReader()
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return bytes.slice(0, length)
      if (value.length + length > bundleLimit) throw new Error('网站脚本超过大小限制。')
      bytes.set(value, length)
      length += value.length
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

const fetchBundle = async (source: SiteScriptSource, siteId: string, capability: string, previous?: Bundle) => {
  const origin = new URL(source.url).origin
  const manifest = scriptUrl(source.manifest, source.url, origin)
  const request = isNativeSecureStore() ? (await import('@tauri-apps/plugin-http')).fetch as typeof fetch : globalThis.fetch
  const init: RequestInit & { maxRedirections: number } = {
    signal: AbortSignal.timeout(5000), credentials: 'omit', redirect: 'error', maxRedirections: 0,
  }
  const response = await request(manifest, { ...init, headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', ...(previous?.etag ? { 'If-None-Match': previous.etag } : {}) } })
  if (response.status === 304 && previous) return { ...previous, checkedAt: Date.now() }
  if (!response.ok) throw new Error(`无法加载网站脚本清单（HTTP ${response.status}）。`)
  const data = await limitedJson(response, 32 * 1024)
  const descriptor = data?.bundles?.[capability]
  if (data?.apiVersion !== 1 || data.siteId !== siteId || typeof data.revision !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(data.revision)
    || typeof descriptor?.url !== 'string' || !/^[0-9a-f]{64}$/.test(descriptor.sha256 ?? '')) throw new Error('网站脚本清单不兼容或缺少所需能力。')
  const url = scriptUrl(descriptor.url, manifest, origin)
  const etag = response.headers.get('etag') ?? ''
  if (previous?.sha256 === descriptor.sha256) return { ...previous, revision: data.revision, etag, checkedAt: Date.now() }
  const bundle = await request(url, { ...init, headers: { 'Cache-Control': 'no-cache' } })
  if (!bundle.ok) throw new Error(`无法加载网站脚本（HTTP ${bundle.status}）。`)
  const bytes = await readBundle(bundle)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (sha256 !== descriptor.sha256) throw new Error('网站脚本校验失败。')
  return { revision: data.revision, etag, sha256, checkedAt: Date.now(), code: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
}

async function withSandbox<T>(work: (evaluate: (source: string) => unknown) => T | Promise<T>): Promise<T> {
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  try {
    runtime.setMemoryLimit(8 * 1024 * 1024)
    runtime.setMaxStackSize(256 * 1024)
    let deadline = 0
    runtime.setInterruptHandler(() => performance.now() > deadline)
    const context = runtime.newContext()
    const evaluate = (source: string) => {
      deadline = performance.now() + 100
      const result = context.evalCode(source, 'website-adapter.js', { type: 'global' })
      if (!('value' in result)) { result.error.dispose(); throw new Error('网站脚本执行失败或超时。') }
      try { return JSON.parse(context.getString(result.value)) } finally { result.value.dispose() }
    }
    try { return await work(evaluate) } finally { context.dispose() }
  } finally { runtime.dispose() }
}

export function runIsolatedWebsiteScript(code: string, input: unknown): Promise<unknown> {
  return withSandbox(evaluate => evaluate(`${code}\n;JSON.stringify(ZErrorSiteScript.run(${JSON.stringify(input)}))`))
}

export const hasWebsiteScriptManifest = async (host: string) => Boolean(await websiteScriptSource(host))

export async function runWebsiteScript<T>(host: string, siteId: string, capability: string, input: unknown, validate: (result: unknown) => T, options?: { reuseForMs: number }): Promise<{ result: T; revision: string; cached?: boolean }> {
  const source = await websiteScriptSource(host)
  if (!source) throw new Error('当前网站经验来源未提供脚本清单。')
  const key = JSON.stringify([host, source.url, source.manifest, capability])
  const previous = cached.get(key)
  let candidate: Bundle | undefined
  const execute = async (bundle: Bundle) => ({ result: validate(await runIsolatedWebsiteScript(bundle.code, input)), revision: bundle.revision })
  try {
    if (previous && options && Date.now() - previous.checkedAt < options.reuseForMs) return await execute(previous)
    let loading = pending.get(key)
    if (!loading) {
      loading = fetchBundle(source, siteId, capability, previous).finally(() => pending.delete(key))
      pending.set(key, loading)
    }
    candidate = await loading
    const output = await execute(candidate)
    cached.set(key, candidate)
    if (cached.size > 32) cached.delete(cached.keys().next().value!)
    return output
  } catch (error) {
    if (!previous || candidate === previous) throw error
    return { ...await execute(previous), cached: true }
  }
}

/** The repository can propose commands. I/O runs only through the caller's validated host adapter. */
export async function runWebsiteWorkflow(
  host: string, siteId: string, capability: string, input: unknown,
  dispatch: (command: unknown, run: (input: unknown) => unknown) => Promise<unknown>,
): Promise<unknown> {
  const source = await websiteScriptSource(host)
  if (!source) throw new Error('当前网站经验来源未提供脚本清单。')
  const key = JSON.stringify([host, source.url, source.manifest, capability])
  const previous = cached.get(key)
  let bundle = previous
  if (!previous || Date.now() - previous.checkedAt >= 30_000) {
    let loading = pending.get(key)
    if (!loading) {
      loading = fetchBundle(source, siteId, capability, previous).finally(() => pending.delete(key))
      pending.set(key, loading)
    }
    bundle = await loading.catch(error => {
      if (!previous) throw error
      return previous
    })
  }
  if (!bundle) throw new Error('未取得网站流程脚本。')
  const selected = bundle
  return withSandbox(async evaluate => {
    evaluate(`${selected.code}\n;const __workflow = ZErrorSiteScript.workflow(${JSON.stringify(input)}); JSON.stringify(true)`)
    let response: unknown = null
    for (let i = 0; i < 512; i++) {
      const step = evaluate(`JSON.stringify(__workflow.next(${JSON.stringify(response ?? null)}))`) as { done: boolean; value: unknown }
      if (step.done === true) {
        cached.set(key, selected)
        if (cached.size > 32) cached.delete(cached.keys().next().value!)
        return step.value
      }
      // An interrupted workflow is never replayed after a command may have changed the page.
      response = await dispatch(step.value, data => evaluate(`JSON.stringify(ZErrorSiteScript.run(${JSON.stringify(data)}))`))
    }
    throw new Error('网站流程超过操作次数限制。')
  })
}
