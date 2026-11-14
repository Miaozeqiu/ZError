(() => {
  const grid = document.querySelector('.grid')
  const status = document.querySelector('[role="status"]')
  const storageKey = 'zerror.browser-home.order'
  const sites = () => Array.from(grid.querySelectorAll('a.site'))
  let drag = null
  let suppressClick = false

  try {
    const order = JSON.parse(localStorage.getItem(storageKey))
    if (Array.isArray(order)) {
      const links = new Map(sites().map(link => [link.href, link]))
      for (const href of order) {
        const link = links.get(href)
        if (link) {
          grid.append(link)
          links.delete(href)
        }
      }
      // Shortcuts added after the order was saved go at the end.
      grid.append(...links.values())
    }
  } catch {
    // Keep the default order when storage is unavailable or invalid.
  }

  for (const img of grid.querySelectorAll('.mark img')) {
    const useFallback = () => {
      img.hidden = true
      img.parentElement.classList.add('is-fallback')
    }
    img.addEventListener('error', useFallback, { once: true })
    if (img.complete && !img.naturalWidth) useFallback()
  }

  function reorder(link, target) {
    if (!target || link === target) return
    const current = sites()
    const destination = current.indexOf(target)
    const insertionPoint = current.indexOf(link) < destination ? target.nextElementSibling : target
    grid.insertBefore(link, insertionPoint)
    try {
      localStorage.setItem(storageKey, JSON.stringify(sites().map(site => site.href)))
    } catch {
      // The new order still works in this tab.
    }
    status.textContent = `${link.querySelector('.name').textContent}已移到第 ${destination + 1} 位`
  }

  function siteAt(event) {
    return document.elementFromPoint(event.clientX, event.clientY)?.closest('a.site')
  }

  grid.addEventListener('pointerdown', event => {
    const link = event.target.closest('a.site')
    if (!link || drag || !event.isPrimary || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    drag = { id: event.pointerId, link, x: event.clientX, y: event.clientY, icon: null, target: null }
    link.setPointerCapture(event.pointerId)
  })

  grid.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return
    if (!drag.icon) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return
      drag.icon = drag.link.querySelector('.mark').cloneNode(true)
      drag.icon.classList.add('drag-icon')
      drag.link.classList.add('is-dragging')
      grid.classList.add('is-sorting')
      document.body.append(drag.icon)
    }
    drag.icon.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`
    const target = siteAt(event)
    drag.target?.classList.remove('is-drop-target')
    drag.target = target !== drag.link ? target : null
    drag.target?.classList.add('is-drop-target')
  })

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return
    const { link, icon, target } = drag
    drag = null
    if (!icon) return

    suppressClick = true
    icon.remove()
    target?.classList.remove('is-drop-target')
    link.classList.remove('is-dragging')
    grid.classList.remove('is-sorting')
    if (event.type === 'pointerup') reorder(link, siteAt(event))
  }

  grid.addEventListener('pointerup', endDrag)
  grid.addEventListener('pointercancel', endDrag)
  grid.addEventListener('lostpointercapture', endDrag)
  // Capture before the native host's document listener can open the dragged link.
  window.addEventListener('click', event => {
    if (!suppressClick || !event.detail) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
  window.addEventListener('pointerdown', () => { suppressClick = false }, true)

  grid.addEventListener('keydown', event => {
    const link = event.target.closest('a.site')
    if (!link || drag || !event.altKey) return
    const target = event.key === 'ArrowLeft' ? link.previousElementSibling
      : event.key === 'ArrowRight' ? link.nextElementSibling : null
    if (!target) return
    event.preventDefault()
    reorder(link, target)
    link.focus()
  })
})()
