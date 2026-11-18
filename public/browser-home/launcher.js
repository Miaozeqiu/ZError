(() => {
  const grid = document.querySelector('.grid')
  const status = document.querySelector('[role="status"]')
  const legacyOrderKey = 'zerror.browser-home.order'
  const orderKey = 'zerror.browser-home.shortcut-order'
  const entryPrefix = 'zerror.browser-home.shortcut.'
  const sites = () => Array.from(grid.querySelectorAll('a.site'))
  const defaults = new Map(sites().map(link => [
    link.dataset.shortcutId,
    { name: link.querySelector('.name').textContent, url: link.href, template: link.cloneNode(true) },
  ]))
  let drag = null
  let suppressClick = false
  const layoutKey = 'zerror.browser-home.layout'
  const heading = document.querySelector('h1')
  const panel = document.querySelector('.launcher-panel')
  let folderView = null
  let openFolder = null

  function siteUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null
    try {
      const url = new URL(value.trim())
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null
    } catch {
      return null
    }
  }
  const siteName = value => typeof value === 'string' && value.trim().length <= 80 ? value.trim() : ''
  const read = key => {
    try { return JSON.parse(localStorage.getItem(key)) } catch { return undefined }
  }

  function shortcuts() {
    const entries = new Map([...defaults].map(([id, { name, url }]) => [id, { id, name, url }]))
    const custom = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(entryPrefix)) continue
      const id = key.slice(entryPrefix.length)
      if (!entries.has(id) && !/^custom-[a-z\d-]+$/.test(id)) continue
      const edit = read(key)
      if (edit?.removed === true) {
        entries.delete(id)
        continue
      }
      const name = siteName(edit?.name)
      const url = siteUrl(edit?.url)
      if (!name || !url) continue
      const entry = { id, name, url: url.href }
      if (entries.has(id)) entries.set(id, entry)
      else custom.push(entry)
    }
    custom.sort((a, b) => a.id.localeCompare(b.id))
    for (const entry of custom) entries.set(entry.id, entry)
    let order = read(orderKey)
    const legacy = read(legacyOrderKey)
    if (!Array.isArray(order)) {
      const defaultIds = new Map([...defaults].map(([id, item]) => [item.url, id]))
      order = Array.isArray(legacy) ? legacy.map(url => defaultIds.get(url)).filter(Boolean) : []
    }
    if (Array.isArray(legacy)) {
      // Migrate URL-based ordering once; retired defaults have no ID in the current launcher.
      try {
        localStorage.setItem(orderKey, JSON.stringify(order))
        localStorage.removeItem(legacyOrderKey)
      } catch { /* Read-only storage still permits displaying the order. */ }
    }
    const ordered = []
    for (const id of order) {
      if (!entries.has(id)) continue
      ordered.push(entries.get(id))
      entries.delete(id)
    }
    return [...ordered, ...entries.values()]
  }

  function makeLink(entry) {
    const url = new URL(entry.url)
    const source = defaults.get(entry.id)
    const useIcon = source && new URL(source.url).origin === url.origin
    const link = useIcon ? source.template.cloneNode(true) : document.createElement('a')
    if (!useIcon) {
      link.className = 'site'
      link.rel = 'noreferrer'
      link.setAttribute('referrerpolicy', 'no-referrer')
      link.draggable = false
      const mark = document.createElement('span')
      mark.className = 'mark is-fallback'
      mark.setAttribute('aria-hidden', 'true')
      mark.append(document.createElement('span'))
      const label = document.createElement('span')
      label.className = 'name'
      link.append(mark, label)
    }
    link.dataset.shortcutId = entry.id
    link.href = url.href
    link.title = url.hostname
    link.querySelector('.name').textContent = entry.name
    if (!useIcon || entry.name !== source.name) {
      link.querySelector('.mark > span').textContent = Array.from(entry.name)[0].toUpperCase()
    }
    const img = link.querySelector('.mark img')
    if (img) {
      const useFallback = () => {
        img.hidden = true
        img.parentElement.classList.add('is-fallback')
      }
      img.addEventListener('error', useFallback, { once: true })
      if (img.complete && !img.naturalWidth) useFallback()
    }
    return link
  }

  // Shortcut records stay independent of placement, including entries added by the Agent.
  function layout(entries = shortcuts()) {
    const saved = read(layoutKey)
    const available = new Set(entries.map(entry => entry.id))
    const folders = new Map()
    for (const folder of Array.isArray(saved?.folders) ? saved.folders : []) {
      if (!/^folder-[a-z0-9-]+$/.test(folder?.id) || folders.has(folder.id) || !Array.isArray(folder.items)) continue
      const items = folder.items.filter(id => available.delete(id))
      if (items.length) folders.set(folder.id, { id: folder.id, name: siteName(folder.name) || '文件夹', items })
    }
    const remaining = new Set([...available, ...folders.keys()])
    const root = Array.isArray(saved?.root) ? saved.root.filter(id => remaining.delete(id)) : []
    const model = { root: [...root, ...remaining], folders }
    if (dissolveSmallFolders(model)) saveLayout(model)
    return model
  }

  function dissolveSmallFolders(model) {
    let changed = false
    for (const folder of model.folders.values()) {
      if (folder.items.length >= 2) continue
      model.root.splice(model.root.indexOf(folder.id), 1, ...folder.items)
      model.folders.delete(folder.id)
      changed = true
    }
    return changed
  }

  function saveLayout(model) {
    try {
      localStorage.setItem(layoutKey, JSON.stringify({ root: model.root, folders: [...model.folders.values()] }))
      return true
    } catch {
      status.textContent = '无法保存导航页布局'
      return false
    }
  }

  function makeFolder(folder, byId) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'site folder'
    button.dataset.shortcutId = folder.id
    button.setAttribute('aria-label', folder.name + '，文件夹，' + folder.items.length + ' 个网站')
    const preview = document.createElement('span')
    preview.className = 'folder-preview'
    preview.setAttribute('aria-hidden', 'true')
    for (const id of folder.items.slice(0, 4)) preview.append(makeLink(byId.get(id)).querySelector('.mark'))
    const label = document.createElement('span')
    label.className = 'name'
    label.textContent = folder.name
    button.append(preview, label)
    return button
  }

  function render(entries = shortcuts(), focusId = document.activeElement?.dataset.shortcutId) {
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const model = layout(entries)
    const folder = model.folders.get(openFolder)
    if (!folder) {
      openFolder = null
      if (folderView) removeFolderView()
    }
    if (folder) renderFolderName(folder)
    else heading.textContent = '导航'
    const tiles = (folder?.items || model.root).map(id => byId.has(id) ? makeLink(byId.get(id)) : makeFolder(model.folders.get(id), byId))
    grid.replaceChildren(...tiles)
    if (folderView?.preview && folder) {
      const marks = folder.items.slice(0, 4).map(id => makeLink(byId.get(id)).querySelector('.mark'))
      folderView.preview.replaceChildren(...marks)
      folderView.anchor.replaceChildren(...marks.map(mark => mark.cloneNode(true)))
    }
    tiles.find(tile => tile.dataset.shortcutId === focusId)?.focus({ preventScroll: true })
  }

  // Resolve IDs against the latest storage on release, so unrelated edits in another tab survive.
  function place(id, destination, anchor = null, after = false, createName = null) {
    const model = layout()
    const sourceFolder = [...model.folders.values()].find(folder => folder.items.includes(id))
    const source = sourceFolder?.items || model.root
    const dest = destination ? model.folders.get(destination)?.items : model.root
    if (!source.includes(id) || !dest || id === anchor || (model.folders.has(id) && (destination || createName))) return
    if (anchor && !dest.includes(anchor)) return
    if (createName && (!anchor || destination || model.folders.has(anchor))) return
    source.splice(source.indexOf(id), 1)
    if (createName) {
      const folderId = 'folder-' + crypto.getRandomValues(new Uint32Array(2)).join('-')
      const items = [anchor, id]
      dest.splice(dest.indexOf(anchor), 1, folderId)
      model.folders.set(folderId, { id: folderId, name: createName, items })
    } else {
      dest.splice(anchor ? dest.indexOf(anchor) + Number(after) : dest.length, 0, id)
    }
    dissolveSmallFolders(model)
    if (saveLayout(model)) status.textContent = '导航布局已更新'
    render(undefined, id)
    return true
  }

  function renderFolderName(folder) {
    const existing = heading.querySelector('input')
    if (existing) {
      if (existing !== document.activeElement) existing.value = folder.name
      return
    }
    const input = document.createElement('input')
    input.value = folder.name
    input.maxLength = 80
    input.enterKeyHint = 'done'
    input.setAttribute('aria-label', '文件夹名称')
    input.title = '重命名文件夹'
    let original = folder.name
    input.onfocus = () => {
      original = input.value
      input.select()
    }
    input.onblur = () => {
      if (openFolder !== folder.id) return
      const model = layout()
      const current = model.folders.get(folder.id)
      if (!current) return
      const name = siteName(input.value)
      input.value = current.name
      if (name && name !== original && name !== current.name) {
        current.name = name
        if (saveLayout(model)) input.value = name
      }
    }
    input.onkeydown = event => {
      if (event.isComposing || event.keyCode === 229 || !['Escape', 'Enter'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') input.value = original
      panel.focus({ preventScroll: true })
    }
    heading.replaceChildren(input)
  }

  function removeFolderView() {
    const view = folderView
    folderView = null
    view.motion?.cancel()
    view.fade?.cancel()
    view.previewFade?.cancel()
    view.preview?.remove()
    view.underlay.remove()
    view.shade.remove()
    document.documentElement.classList.remove('folder-open')
  }

  function finishClosing() {
    const id = openFolder
    openFolder = null
    render(undefined, id)
    if (drag?.exit && drag.ghost) {
      // The same grid still owns pointer capture. Reuse the lifted site's tile as
      // the home placeholder; its stored folder membership changes only on drop.
      grid.append(drag.tile)
      schedule()
    }
  }

  function closeFolder() {
    const view = folderView
    if (!view || view.closing) return
    view.closing = true
    if (!view.motion || reducedMotion()) { finishClosing(); return }
    // Start at the visible frame, even when the opening animation is interrupted.
    const style = getComputedStyle(panel)
    const from = { transform: style.transform, borderRadius: style.borderRadius }
    const shadeOpacity = Number(getComputedStyle(view.shade).opacity)
    const coverOpacity = getComputedStyle(view.preview).opacity
    view.motion.cancel()
    view.fade.cancel()
    view.previewFade.cancel()

    const to = collapsedFrame(view.anchor.getBoundingClientRect(), panel.getBoundingClientRect())
    const timing = {
      duration: 235 * Math.sqrt(shadeOpacity),
      easing: 'cubic-bezier(.28,.48,.24,1)',
      fill: 'both',
    }
    view.motion = panel.animate([from, to], timing)
    view.fade = view.shade.animate([{ opacity: shadeOpacity }, { opacity: 0 }], timing)
    view.previewFade = view.preview.animate([
      { opacity: coverOpacity }, { opacity: coverOpacity, offset: .42 }, { opacity: 1 },
    ], timing)
    view.motion.onfinish = finishClosing
  }

  const expandedFrame = { transform: 'none', borderRadius: '28px' }
  function collapsedFrame(origin, rect) {
    const x = origin.left + origin.width / 2 - rect.left - rect.width / 2
    const y = origin.top + origin.height / 2 - rect.top - rect.height / 2
    const sx = origin.width / rect.width
    const sy = origin.height / rect.height
    return {
      transform: 'translate(' + x + 'px,' + y + 'px) scale(' + sx + ',' + sy + ')',
      borderRadius: (17 / sx) + 'px / ' + (17 / sy) + 'px',
    }
  }

  function enterFolder(tile) {
    const preview = tile.querySelector('.folder-preview')
    const origin = preview.getBoundingClientRect()
    const underlay = document.createElement('div')
    underlay.className = 'home-underlay'
    underlay.inert = true
    underlay.setAttribute('aria-hidden', 'true')
    underlay.style.paddingTop = (grid.getBoundingClientRect().top - panel.getBoundingClientRect().top) + 'px'
    let anchor
    for (const site of grid.children) {
      const icon = document.createElement('span')
      icon.className = 'home-tile'
      icon.append(site.firstElementChild.cloneNode(true), site.lastElementChild.cloneNode(true))
      if (site === tile) {
        anchor = icon.firstElementChild
        icon.style.visibility = 'hidden'
      }
      underlay.append(icon)
    }
    const shade = document.createElement('div')
    shade.className = 'folder-shade'
    shade.setAttribute('aria-hidden', 'true')
    shade.onclick = closeFolder
    panel.before(underlay, shade)
    folderView = { underlay, shade, anchor, closing: false }
    document.documentElement.classList.add('folder-open')
    openFolder = tile.dataset.shortcutId
    render()
    if (!folderView) return
    panel.focus({ preventScroll: true })
    if (reducedMotion() || !panel.animate || !origin.width) return

    const rect = panel.getBoundingClientRect()
    const timing = { duration: 300, easing: 'cubic-bezier(.22,.75,.2,1)', fill: 'both' }
    folderView.motion = panel.animate([collapsedFrame(origin, rect), expandedFrame], timing)
    const cover = preview.cloneNode(true)
    cover.classList.add('folder-cover')
    panel.append(cover)
    folderView.preview = cover
    folderView.previewFade = cover.animate([{ opacity: 1 }, { opacity: 0, offset: .46 }, { opacity: 0 }], timing)
    folderView.fade = shade.animate([{ opacity: 0 }, { opacity: 1 }], timing)
  }

  panel.addEventListener('click', event => {
    if (openFolder && !event.target.closest('.site, input') && !event.defaultPrevented) closeFolder()
  })
  grid.addEventListener('click', event => {
    const tile = event.target.closest('.folder')
    if (tile && !openFolder) {
      event.stopPropagation()
      enterFolder(tile)
    }
  })
  function manage({ action, target, name, url }) {
    const fail = (reason, error) => ({ ok: false, reason, error })
    try {
      const entries = shortcuts()
      if (action === 'list') {
        const model = layout(entries)
        const byId = new Map(entries.map(entry => [entry.id, entry]))
        return { ok: true, shortcuts: model.root.flatMap(id => {
          const folder = model.folders.get(id)
          return folder ? folder.items.map(child => ({ ...byId.get(child), folder: folder.name })) : [byId.get(id)]
        }) }
      }
      if (drag) return fail('stale', '导航图标正在拖动，请等拖动结束。')
      if (!['add', 'update', 'remove'].includes(action)) return fail('invalid', '无效的导航快捷入口操作。')
      const needle = typeof target === 'string' ? target.trim() : ''
      const byId = entries.find(item => item.id === needle)
      const targetUrl = siteUrl(needle)?.href
      const matches = byId ? [byId] : entries.filter(item => item.name.toLowerCase() === needle.toLowerCase() || item.url === targetUrl)
      const current = action === 'add' ? undefined : matches[0]
      if (action !== 'add' && matches.length !== 1) {
        return matches.length ? { ...fail('ambiguous', '有多个匹配入口，请指定 ID 或完整网址。'), shortcuts: matches }
          : fail('not_found', '导航页没有这个快捷入口。')
      }
      if (action === 'remove') {
        if (defaults.has(current.id)) localStorage.setItem(entryPrefix + current.id, JSON.stringify({ removed: true }))
        else localStorage.removeItem(entryPrefix + current.id)
        render()
        status.textContent = `已删除${current.name}`
        return { ok: true, action, shortcut: current }
      }
      if (action === 'update' && name === undefined && url === undefined) return fail('invalid', '请提供要更新的名称或网址。')
      const nextName = name === undefined ? current?.name : siteName(name)
      const nextUrl = url === undefined ? current?.url : siteUrl(url)?.href
      if (!nextName || !nextUrl) return fail('invalid', '请提供有效名称和不含账号密码的 HTTP 或 HTTPS 网址。')
      const duplicate = entries.find(item => item.url === nextUrl && item.id !== current?.id)
      if (action === 'add' && duplicate?.name === nextName) return { ok: true, action, unchanged: true, shortcut: duplicate }
      if (duplicate) return { ...fail('ambiguous', '这个网址已有快捷入口。'), shortcut: duplicate }
      const id = current?.id ?? `custom-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`
      const entry = { id, name: nextName, url: nextUrl }
      localStorage.setItem(entryPrefix + id, JSON.stringify(entry))
      render()
      status.textContent = action === 'add' ? `已添加${nextName}` : `已更新${nextName}`
      return { ok: true, action, shortcut: entry }
    } catch {
      return fail('invalid', '无法读取或保存导航页的本地数据。')
    }
  }

  Object.defineProperty(window, '__zerrorHomeShortcuts', { value: manage })
  try { render() } catch { /* Unavailable storage leaves the built-in links in place. */ }
  window.addEventListener('storage', event => {
    if (event.key && ![layoutKey, orderKey, legacyOrderKey].includes(event.key) && !event.key.startsWith(entryPrefix)) return
    if (drag) drag.refreshPending = true
    else render()
  })

  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const tiles = () => [...grid.children]
  function previewOrder(target, after) {
    const { tile } = drag
    const sibling = after ? target.nextElementSibling : target
    if (sibling === tile || tile.nextElementSibling === sibling) return
    const neighbors = tiles().filter(item => item !== tile)
    const before = neighbors.map(item => item.getBoundingClientRect())
    grid.insertBefore(tile, sibling)
    if (reducedMotion()) return
    neighbors.forEach((item, index) => {
      item.getAnimations?.().forEach(animation => animation.cancel())
      const next = item.getBoundingClientRect()
      const x = before[index].left - next.left
      const y = before[index].top - next.top
      if (x || y) item.animate?.([{ transform: 'translate(' + x + 'px,' + y + 'px)' }, { transform: 'none' }],
        { duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)' })
    })
  }

  function lift() {
    if (!drag || drag.ghost) return
    const { tile } = drag
    // A drag can take over while the folder is still expanding.
    if (folderView?.motion?.playState === 'running' && !folderView.closing) {
      folderView.motion.finish()
      folderView.fade.finish()
      folderView.previewFade.finish()
    }
    const rect = tile.getBoundingClientRect()
    drag.ghost = tile.cloneNode(true)
    drag.ghost.classList.add('drag-icon')
    drag.ghost.setAttribute('aria-hidden', 'true')
    drag.ghost.inert = true
    drag.ghost.style.width = rect.width + 'px'
    drag.offsetX = drag.grabX * rect.width
    drag.offsetY = drag.grabY * rect.height
    document.body.append(drag.ghost)
    tile.classList.add('is-dragging')
    grid.classList.add('is-sorting')
    grid.setPointerCapture(drag.pointer)
    schedule()
  }

  function groupTarget(target) {
    if (target === drag.candidate) return
    clearTimeout(drag.groupTimer)
    drag.candidate?.classList.remove('is-group-target')
    drag.candidate = target
    drag.group = false
    if (!target) return
    const arm = () => {
      drag.group = true
      target.classList.add('is-group-target')
      status.textContent = target.classList.contains('folder') ? '松开以移入文件夹' : '松开以创建文件夹'
    }
    if (target.classList.contains('folder')) arm()
    else drag.groupTimer = setTimeout(arm, 430)
  }

  function updateDrag() {
    const { x, y, ghost, tile } = drag
    ghost.style.transform = 'translate3d(' + (x - drag.offsetX) + 'px,' + (y - drag.offsetY) + 'px,0)'
    drag.drop = null
    if (folderView) {
      if (folderView.closing) return
      const bounds = panel.getBoundingClientRect()
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
        drag.exit = { x, y }
        drag.placement = null
        groupTarget(null)
        closeFolder()
        return
      }
    }
    // Merely crossing the edge means "move to home". Require actual movement
    // there before targeting an icon that appeared underneath the pointer.
    if (drag.exit && !drag.exit.moved) {
      drag.exit.moved = Math.hypot(x - drag.exit.x, y - drag.exit.y) >= 5
      if (!drag.exit.moved) return
    }
    const rect = grid.getBoundingClientRect()
    if (x < rect.left - 8 || x > rect.right + 8 || y < rect.top - 8 || y > rect.bottom + 8) {
      groupTarget(null)
      return
    }
    // Hit-test the fixed grid slots, independent of the neighbors' settling animations.
    let nearest, dx, dy, best = Infinity
    for (const item of tiles()) {
      const deltaX = x - (rect.left + item.offsetLeft + item.offsetWidth / 2)
      const deltaY = y - (rect.top - grid.scrollTop + item.offsetTop + item.offsetHeight / 2)
      const distance = deltaX * deltaX + deltaY * deltaY
      if (distance < best) { best = distance; nearest = item; dx = deltaX; dy = deltaY }
    }
    if (!nearest) return
    if (nearest === tile) {
      groupTarget(null)
      drag.drop = drag.placement
      return
    }
    const center = !openFolder && !tile.classList.contains('folder') &&
      Math.abs(dx) < nearest.offsetWidth * .26 && Math.abs(dy + 10) < nearest.offsetHeight * .31
    groupTarget(center ? nearest : null)
    const after = center ? tiles().indexOf(tile) < tiles().indexOf(nearest) : dx >= 0
    drag.drop = { anchor: nearest.dataset.shortcutId, after }
    if (!center) {
      previewOrder(nearest, after)
      drag.placement = drag.drop
    }
  }

  function frame() {
    if (!drag?.ghost) return
    drag.frame = 0
    const edge = 48
    if (folderView?.closing) { updateDrag(); return }
    const bounds = openFolder ? grid.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
    const delta = drag.y < bounds.top + edge ? drag.y - bounds.top - edge : Math.max(0, drag.y - bounds.bottom + edge)
    const scroller = openFolder ? grid : document.scrollingElement
    const previous = scroller.scrollTop
    if (delta) scroller.scrollTop += Math.sign(delta) * Math.min(16, Math.ceil(Math.abs(delta) / 3))
    updateDrag()
    if (previous !== scroller.scrollTop) schedule()
  }
  function schedule() {
    if (drag?.ghost && !drag.frame) drag.frame = requestAnimationFrame(frame)
  }

  grid.addEventListener('pointerdown', event => {
    const tile = event.target.closest('.site')
    if (!tile || drag || !event.isPrimary || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (folderView?.closing) return
    const rect = tile.getBoundingClientRect()
    drag = { pointer: event.pointerId, tile,
      grabX: (event.clientX - rect.left) / rect.width, grabY: (event.clientY - rect.top) / rect.height,
      startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' }
    if (drag.touch) drag.holdTimer = setTimeout(lift, 320)
  })
  // Keep native scrolling before long press. Once lifted, the finger controls the tile.
  grid.addEventListener('touchmove', event => {
    if (drag?.ghost && event.cancelable) event.preventDefault()
  }, { passive: false })
  grid.addEventListener('contextmenu', event => {
    if (drag?.touch) event.preventDefault()
  })
  window.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (!drag.ghost) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < (drag.touch ? 9 : 5)) return
      if (drag.touch) { endDrag(false); return }
      lift()
    }
    schedule()
  })
  function endDrag(commit, event) {
    if (!drag || (event && event.pointerId !== drag.pointer)) return
    if (commit && drag.ghost && event) {
      drag.x = event.clientX
      drag.y = event.clientY
      updateDrag()
      if (drag.exit && folderView?.closing) {
        finishClosing()
        updateDrag()
      }
    }
    const state = drag
    drag = null
    clearTimeout(state.holdTimer)
    clearTimeout(state.groupTimer)
    if (!state.ghost) {
      if (state.refreshPending) render()
      return
    }
    cancelAnimationFrame(state.frame)
    suppressClick = true
    state.candidate?.classList.remove('is-group-target')
    grid.classList.remove('is-sorting')
    if (grid.hasPointerCapture(state.pointer)) grid.releasePointerCapture(state.pointer)
    const id = state.tile.dataset.shortcutId
    let changed = false
    if (commit && state.group && state.candidate) {
      const target = state.candidate.dataset.shortcutId
      changed = state.candidate.classList.contains('folder') ? place(id, target) : place(id, null, target, false, '文件夹')
    } else if (commit && state.drop) changed = place(id, openFolder, state.drop.anchor, state.drop.after)
    else if (commit && state.exit) changed = place(id, null)
    if (!changed) render(undefined, id)

    // Let the lifted copy settle while the real tile is already interactive.
    const landing = tiles().find(tile => tile.dataset.shortcutId === id)
    const ghost = state.ghost
    if (!landing || reducedMotion() || !ghost.animate) { ghost.remove(); return }
    const targetRect = landing.getBoundingClientRect()
    const flight = ghost.animate([
      { transform: ghost.style.transform, opacity: 1 },
      { transform: 'translate(' + targetRect.left + 'px,' + targetRect.top + 'px)', opacity: 0 },
    ], { duration: 150, easing: 'ease-out' })
    flight.onfinish = flight.oncancel = () => ghost.remove()
  }
  window.addEventListener('pointerup', event => endDrag(true, event))
  window.addEventListener('pointercancel', event => endDrag(false, event))
  grid.addEventListener('lostpointercapture', event => {
    if (event.target === grid) endDrag(false, event)
  })
  window.addEventListener('blur', () => endDrag(false))
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (drag) endDrag(false)
    else closeFolder()
  })
  window.addEventListener('click', event => {
    if (!suppressClick || !event.detail) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
  window.addEventListener('pointerdown', () => { suppressClick = false }, true)
  grid.addEventListener('keydown', event => {
    const tile = event.target.closest('.site')
    if (!tile || drag || !event.altKey) return
    const target = event.key === 'ArrowLeft' ? tile.previousElementSibling
      : event.key === 'ArrowRight' ? tile.nextElementSibling : null
    if (!target) return
    event.preventDefault()
    place(tile.dataset.shortcutId, openFolder, target.dataset.shortcutId, event.key === 'ArrowRight')
  })
})()
