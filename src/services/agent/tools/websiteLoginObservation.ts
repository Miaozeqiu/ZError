type Call = (id: string, op: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>
type Rule = { kind: string; selector: string; pattern?: string }
type Run = (input: unknown) => unknown

const validateRules = (value: unknown): Rule[] => {
  const rules = (value as { rules?: unknown })?.rules
  if (!Array.isArray(rules) || rules.length > 32 || rules.some(rule => !rule
    || !['text', 'visible', 'editable', 'hidden_flag', 'frame_path', 'image', 'parameter'].includes(rule.kind)
    || typeof rule.selector !== 'string' || rule.selector.length > 512
    || (['text', 'parameter'].includes(rule.kind) && (typeof rule.pattern !== 'string' || rule.pattern.length > 512)))) {
    throw new Error('网站登录脚本返回了无效的页面观察规则。')
  }
  return rules.map(({ kind, selector, pattern }) => ({ kind, selector, pattern: ['text', 'parameter'].includes(kind) ? pattern : undefined }))
}

export function loginObserver(call: Call, id: string, host: string) {
  let previousUrl: string | undefined
  return async (captureCaptcha: boolean, run: Run): Promise<Record<string, unknown>> => {
    const get = (url?: string, rules?: Rule[]) => call(id, 'login_observe', { url, rules })
    const parse = (raw: unknown) => {
      if (typeof raw !== 'string' || !URL.canParse(raw)) return null
      const url = new URL(raw)
      return url.protocol === 'https:' && !url.port && !url.username && !url.password
        && (url.hostname === host || url.hostname.endsWith('.' + host)) ? url : null
    }
    const probe = async (url: URL) => {
      const input = { operation: 'observe', origin: url.origin, path: url.pathname, captureCaptcha }
      const rules = validateRules(run(input))
      const observation = await get(url.href, rules)
      return { input, rules, observation }
    }
    let url = parse(previousUrl)
    if (!url) {
      const observation = await get()
      if (observation.unsupported) return { kind: 'unsupported', url: observation.url }
      previousUrl = typeof observation.url === 'string' ? observation.url : undefined
      url = parse(previousUrl)
      if (!url) return { kind: 'other' }
    }
    let { input, rules, observation } = await probe(url)
    if (observation.url && observation.url !== url.href) {
      previousUrl = typeof observation.url === 'string' ? observation.url : undefined
      const next = parse(previousUrl)
      if (!next) return { kind: 'other' }
      url = next
      const nextProbe = await probe(url)
      input = nextProbe.input
      rules = nextProbe.rules
      observation = nextProbe.observation
    }
    previousUrl = typeof observation.url === 'string' ? observation.url : undefined
    const { url: observedUrl, frameId, loaderId, supportsLoginAction, matches } = observation
    if (observedUrl !== url.href || !Array.isArray(matches) || matches.length !== rules.length) {
      return { url: observedUrl, kind: 'loading' }
    }
    const sanitized = matches.map((match, index) => {
      if (rules[index]?.kind === 'image') return typeof match === 'string'
      if (rules[index]?.kind === 'frame_path' && typeof match === 'string' && match.length <= 1024) return match
      return match === true
    })
    const result = (() => {
      const value = run({ ...input, matches: sanitized })
      const result = value as { modern?: unknown; kind?: unknown; imageRule?: unknown; rejected?: unknown; rejection?: unknown; challenge?: unknown }
      if (!['space', 'other', 'guest', 'passport', 'loading', 'challenge', 'form', 'reset', 'rejected'].includes(String(result?.kind))) {
        throw new Error('网站登录脚本返回了无效的页面状态。')
      }
      return result
    })()
    const index = typeof result.imageRule === 'number' ? result.imageRule : -1
    const captchaImage = captureCaptcha && rules[index]?.kind === 'image' ? matches[index] : undefined
    return { url: observedUrl, frameId, loaderId, supportsLoginAction, captchaImage,
      kind: result.kind, modern: result.modern === true, rejected: result.rejected === true, rejection: ['credentials', 'captcha', 'unknown'].find(value => value === result.rejection), challenge: result.challenge === true }
  }
}
