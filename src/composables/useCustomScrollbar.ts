import { onUnmounted, ref } from 'vue'

export const useCustomScrollbar = () => {
  const contentRef = ref<HTMLElement | null>(null)
  const barRef = ref<HTMLElement | null>(null)
  const thumbRef = ref<HTMLElement | null>(null)
  const visible = ref(false)
  const enabled = ref(false)

  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let cleanup: (() => void) | null = null

  const hide = () => {
    visible.value = false
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  const show = () => {
    const content = contentRef.value
    if (!content || content.scrollHeight <= content.clientHeight + 1) {
      enabled.value = false
      hide()
      return
    }
    enabled.value = true
    visible.value = true
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      visible.value = false
    }, 1500)
  }

  const updateThumb = () => {
    const content = contentRef.value
    const thumb = thumbRef.value
    const bar = barRef.value
    if (!content || !thumb || !bar) return

    const ratio = content.clientHeight / content.scrollHeight
    if (!Number.isFinite(ratio) || ratio >= 1) {
      enabled.value = false
      thumb.style.height = '0px'
      thumb.style.transform = 'translateY(0)'
      hide()
      return
    }
    enabled.value = true

    const thumbHeight = Math.max(ratio * bar.clientHeight, 32)
    const maxThumbTop = Math.max(bar.clientHeight - thumbHeight, 0)
    const maxScrollTop = Math.max(content.scrollHeight - content.clientHeight, 1)
    const thumbTop = (content.scrollTop / maxScrollTop) * maxThumbTop
    thumb.style.height = `${thumbHeight}px`
    thumb.style.transform = `translateY(${thumbTop}px)`
  }

  const onMousedown = (event: MouseEvent) => {
    const thumb = thumbRef.value
    const content = contentRef.value
    const bar = barRef.value
    if (!thumb || !content || !bar) return

    const dragStartY = event.clientY
    const dragStartScrollTop = content.scrollTop

    const onMouseMove = (moveEvent: MouseEvent) => {
      const maxThumbTravel = Math.max(bar.clientHeight - thumb.clientHeight, 1)
      const scrollRatio = (moveEvent.clientY - dragStartY) / maxThumbTravel
      content.scrollTop = dragStartScrollTop + scrollRatio * (content.scrollHeight - content.clientHeight)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    event.preventDefault()
    show()
  }

  const bind = () => {
    cleanup?.()
    const content = contentRef.value
    if (!content) return

    const onScroll = () => {
      updateThumb()
      show()
    }
    const onPointerEnter = () => {
      updateThumb()
      show()
    }

    content.addEventListener('scroll', onScroll, { passive: true })
    content.addEventListener('mouseenter', onPointerEnter)
    content.addEventListener('mouseleave', updateThumb)

    const resizeObserver = new ResizeObserver(updateThumb)
    resizeObserver.observe(content)
    const mutationObserver = new MutationObserver(() => {
      requestAnimationFrame(updateThumb)
    })
    mutationObserver.observe(content, { childList: true, subtree: true, characterData: true })

    requestAnimationFrame(updateThumb)
    cleanup = () => {
      content.removeEventListener('scroll', onScroll)
      content.removeEventListener('mouseenter', onPointerEnter)
      content.removeEventListener('mouseleave', updateThumb)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }

  onUnmounted(() => {
    cleanup?.()
    hide()
  })

  return {
    contentRef,
    barRef,
    thumbRef,
    visible,
    enabled,
    onMousedown,
    bind,
    update: updateThumb,
  }
}
