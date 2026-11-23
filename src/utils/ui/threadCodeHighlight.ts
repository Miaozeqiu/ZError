import { hljs } from './highlightSetup'

const CODE_LANG_LABELS: Record<string, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  md: 'Markdown',
  python: 'Python',
  py: 'Python',
  rust: 'Rust',
  sh: 'Shell',
  shell: 'Shell',
  sql: 'SQL',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
}

const resolveCodeLang = (el: HTMLElement, pre: Element | null) => {
  const attr = pre?.getAttribute('data-language') || el.getAttribute('data-language') || ''
  if (attr) return attr.toLowerCase()
  const match = `${pre?.className || ''} ${el.className}`.match(/(?:^|\s)language-([a-z0-9+#_-]+)/i)
  return match?.[1]?.toLowerCase() || ''
}

const formatCodeLang = (lang: string) => CODE_LANG_LABELS[lang] || lang

const decorateCodeLang = (el: HTMLElement, pre: HTMLElement | null, lang: string) => {
  if (!pre || !lang) return
  pre.dataset.language = lang
  pre.dataset.langLabel = formatCodeLang(lang)
  el.classList.add(`language-${lang}`)
}

export function createThreadCodeHighlighter(getRoot: () => HTMLElement | null) {
  let root: HTMLElement | null = null
  let observer: MutationObserver | null = null
  let frame = 0
  const dirty = new Set<HTMLElement>()
  const collect = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement
    if (!element) return
    const code = element.closest('pre code')
    if (code) dirty.add(code as HTMLElement)
    element.querySelectorAll<HTMLElement>('pre code').forEach(block => dirty.add(block))
  }
  const flush = () => {
    frame = 0
    for (const el of dirty) {
      if (!root?.contains(el) || !el.closest('.assistant-text')) continue
      if (el.closest('.d2-block-container, .mermaid-block-container, .infographic-block-container')) continue
      const pre = el.closest('pre') as HTMLElement | null
      const lang = resolveCodeLang(el, pre)
      if (['d2', 'd2lang', 'mermaid', 'infographic'].includes(lang)) continue
      decorateCodeLang(el, pre, lang)
      const source = el.textContent || ''
      if (!source.trim() || (el.dataset.hlSource === source && el.dataset.highlighted === 'yes')) continue
      delete el.dataset.highlighted
      el.classList.remove('hljs')
      try {
        el.innerHTML = lang && hljs.getLanguage(lang)
          ? hljs.highlight(source, { language: lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(source).value
        el.dataset.hlSource = source
        el.dataset.highlighted = 'yes'
        el.classList.add('hljs')
      } catch { /* preserve plain text */ }
    }
    dirty.clear()
  }
  const schedule = () => {
    const next = getRoot()
    if (next !== root) {
      observer?.disconnect()
      dirty.clear()
      root = next
      if (root) {
        collect(root)
        observer = new MutationObserver(records => {
          for (const record of records) {
            const element = record.target instanceof Element ? record.target : record.target.parentElement
            const block = element?.closest('pre code')
            if (block) dirty.add(block as HTMLElement)
            for (const added of record.addedNodes) collect(added)
          }
          if (dirty.size && !frame) frame = requestAnimationFrame(flush)
        })
        observer.observe(root, { subtree: true, childList: true, characterData: true })
      }
    }
    if (dirty.size && !frame) frame = requestAnimationFrame(flush)
  }
  return { schedule, dispose: () => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); dirty.clear(); root = null; frame = 0 } }
}
