/** 设置页左右两列自定义滚动条。协议下拉关闭通过 hook 注入，避免和平台逻辑缠在一起。 */
import { ref } from 'vue'

export type SettingsScrollHooks = {
  onBeforeDetailScroll?: () => void
}

export const bindSettingsScroll = (hooks: SettingsScrollHooks = {}) => {
  const detailScrollWrap = ref<HTMLElement | null>(null)
  const detailContent = ref<HTMLElement | null>(null)
  const customScrollbar = ref<HTMLElement | null>(null)
  const customScrollbarThumb = ref<HTMLElement | null>(null)
  const platformListScrollWrap = ref<HTMLElement | null>(null)
  const platformListScroll = ref<HTMLElement | null>(null)
  const platformScrollbar = ref<HTMLElement | null>(null)
  const platformScrollbarThumb = ref<HTMLElement | null>(null)

  let isDraggingScrollbar = false
  let dragStartY = 0
  let dragStartScrollTop = 0
  let scrollHideTimer: ReturnType<typeof setTimeout> | null = null
  const scrollbarVisible = ref(false)
  let isDraggingPlatformScrollbar = false
  let platformDragStartY = 0
  let platformDragStartScrollTop = 0
  let platformScrollHideTimer: ReturnType<typeof setTimeout> | null = null
  const platformScrollbarVisible = ref(false)

  const showScrollbar = () => {
    scrollbarVisible.value = true
    if (scrollHideTimer) clearTimeout(scrollHideTimer)
    scrollHideTimer = setTimeout(() => {
      scrollbarVisible.value = false
    }, 1500)
  }

  const updateScrollbarThumb = () => {
    const content = detailContent.value
    const thumb = customScrollbarThumb.value
    const bar = customScrollbar.value
    if (!content || !thumb || !bar) return

    const ratio = content.clientHeight / content.scrollHeight
    if (ratio >= 1) return

    const thumbHeight = Math.max(ratio * bar.clientHeight, 32)
    const thumbTop = (content.scrollTop / (content.scrollHeight - content.clientHeight)) * (bar.clientHeight - thumbHeight)
    thumb.style.height = `${thumbHeight}px`
    thumb.style.transform = `translateY(${thumbTop}px)`
  }

  const onDetailScroll = () => {
    hooks.onBeforeDetailScroll?.()
    updateScrollbarThumb()
    showScrollbar()
  }

  const onScrollbarMousedown = (e: MouseEvent) => {
    const thumb = customScrollbarThumb.value
    const content = detailContent.value
    const bar = customScrollbar.value
    if (!thumb || !content || !bar) return

    isDraggingScrollbar = true
    dragStartY = e.clientY
    dragStartScrollTop = content.scrollTop

    const onMousemove = (event: MouseEvent) => {
      if (!isDraggingScrollbar) return
      const thumbHeight = thumb.clientHeight
      const barHeight = bar.clientHeight
      const delta = event.clientY - dragStartY
      const scrollRatio = delta / (barHeight - thumbHeight)
      content.scrollTop = dragStartScrollTop + scrollRatio * (content.scrollHeight - content.clientHeight)
    }

    const onMouseup = () => {
      isDraggingScrollbar = false
      document.removeEventListener('mousemove', onMousemove)
      document.removeEventListener('mouseup', onMouseup)
    }

    document.addEventListener('mousemove', onMousemove)
    document.addEventListener('mouseup', onMouseup)
    e.preventDefault()
  }

  const showPlatformScrollbar = () => {
    platformScrollbarVisible.value = true
    if (platformScrollHideTimer) clearTimeout(platformScrollHideTimer)
    platformScrollHideTimer = setTimeout(() => {
      platformScrollbarVisible.value = false
    }, 1500)
  }

  const updatePlatformScrollbarThumb = () => {
    const content = platformListScroll.value
    const thumb = platformScrollbarThumb.value
    const bar = platformScrollbar.value
    if (!content || !thumb || !bar) return

    const ratio = content.clientHeight / content.scrollHeight
    if (ratio >= 1) {
      thumb.style.height = '0px'
      thumb.style.transform = 'translateY(0)'
      platformScrollbarVisible.value = false
      return
    }

    const thumbHeight = Math.max(ratio * bar.clientHeight, 32)
    const thumbTop = (content.scrollTop / (content.scrollHeight - content.clientHeight)) * (bar.clientHeight - thumbHeight)
    thumb.style.height = `${thumbHeight}px`
    thumb.style.transform = `translateY(${thumbTop}px)`
  }

  const onPlatformListScroll = () => {
    updatePlatformScrollbarThumb()
    showPlatformScrollbar()
  }

  const onPlatformScrollbarMousedown = (e: MouseEvent) => {
    const thumb = platformScrollbarThumb.value
    const content = platformListScroll.value
    const bar = platformScrollbar.value
    if (!thumb || !content || !bar) return

    isDraggingPlatformScrollbar = true
    platformDragStartY = e.clientY
    platformDragStartScrollTop = content.scrollTop

    const onMousemove = (event: MouseEvent) => {
      if (!isDraggingPlatformScrollbar) return
      const thumbHeight = thumb.clientHeight
      const barHeight = bar.clientHeight
      const delta = event.clientY - platformDragStartY
      const scrollRatio = delta / (barHeight - thumbHeight)
      content.scrollTop = platformDragStartScrollTop + scrollRatio * (content.scrollHeight - content.clientHeight)
    }

    const onMouseup = () => {
      isDraggingPlatformScrollbar = false
      document.removeEventListener('mousemove', onMousemove)
      document.removeEventListener('mouseup', onMouseup)
    }

    document.addEventListener('mousemove', onMousemove)
    document.addEventListener('mouseup', onMouseup)
    e.preventDefault()
  }

  const cleanupScrollTimers = () => {
    if (scrollHideTimer) clearTimeout(scrollHideTimer)
    if (platformScrollHideTimer) clearTimeout(platformScrollHideTimer)
  }

  const observeDetailResize = () => {
    if (!detailContent.value) return
    const observer = new ResizeObserver(updateScrollbarThumb)
    observer.observe(detailContent.value)
    return observer
  }

  return {
    detailScrollWrap,
    detailContent,
    customScrollbar,
    customScrollbarThumb,
    platformListScrollWrap,
    platformListScroll,
    platformScrollbar,
    platformScrollbarThumb,
    isDraggingScrollbar,
    dragStartY,
    dragStartScrollTop,
    scrollHideTimer,
    scrollbarVisible,
    isDraggingPlatformScrollbar,
    platformDragStartY,
    platformDragStartScrollTop,
    platformScrollHideTimer,
    platformScrollbarVisible,
    showScrollbar,
    updateScrollbarThumb,
    onDetailScroll,
    onScrollbarMousedown,
    showPlatformScrollbar,
    updatePlatformScrollbarThumb,
    onPlatformListScroll,
    onPlatformScrollbarMousedown,
    cleanupScrollTimers,
    observeDetailResize,
  }
}
