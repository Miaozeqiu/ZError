function (expectedUrl, rules) {
  if (location.href !== expectedUrl) return null
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible'
  const active = element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true'
  return rules.map(({ selector, kind, expected }) => {
    try {
      if (kind === 'parameter') return new URLSearchParams(location.search).get(selector) === expected
      const nodes = document.querySelectorAll(selector)
      if (nodes.length > 80) return false
      if (kind === 'visible') return [...nodes].some(visible)
      if (kind === 'editable') {
        const element = nodes[0]
        return element instanceof HTMLInputElement && active(element) && !element.readOnly
          && /^(text|tel|email|number|password)$/.test(element.type)
      }
      if (kind === 'text') return [...nodes].filter(element => visible(element)
        && !element.matches('input, textarea, select, [contenteditable], script, style, iframe')
        && !element.querySelector('input, textarea, select, [contenteditable], script, style, iframe'))
        .map(element => (element.innerText || element.textContent || '').slice(0, 512).trim())
      const element = nodes[0]
      if (kind === 'hidden_flag') {
        return nodes.length === 1 && element instanceof HTMLInputElement && element.type === 'hidden'
          && Boolean(element.value.trim() && !/^(?:0|false|no)$/i.test(element.value.trim()))
      }
      if (nodes.length !== 1 || !visible(element)) return false
      if (kind === 'frame_path') {
        if (!(element instanceof HTMLIFrameElement)) return false
        const src = new URL(element.src)
        return src.protocol === 'https:' ? src.origin + src.pathname : false
      }
      if (!(element instanceof HTMLImageElement) || !element.complete || !element.naturalWidth || element.naturalWidth > 400
        || !element.naturalHeight || element.naturalHeight > 160) return false
      const source = element.currentSrc || element.src
      const inline = source.length <= 400000 && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(source)
      if (!inline && new URL(source, location.href).origin !== location.origin) return false
      const canvas = document.createElement('canvas')
      canvas.width = element.naturalWidth
      canvas.height = element.naturalHeight
      canvas.getContext('2d').drawImage(element, 0, 0)
      return canvas.toDataURL('image/png')
    } catch {
      return false
    }
  })
}
