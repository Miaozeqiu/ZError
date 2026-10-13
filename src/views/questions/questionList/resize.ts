/** 详情面板拖宽。 */
import type { QuestionListCtx } from './types'

export const bindQuestionListResize = (ctx: QuestionListCtx) => {
  const handleResize = (event: MouseEvent) => {
    if (!ctx.isResizing.value) return
    const next = ctx.startWidth.value + (ctx.startX.value - event.clientX)
    ctx.overlayWidth.value = Math.max(300, Math.min(window.innerWidth * 0.8, next))
  }

  const stopResize = () => {
    ctx.isResizing.value = false
    document.removeEventListener('mousemove', handleResize)
    document.removeEventListener('mouseup', stopResize)
    document.body.classList.remove('resizing')
    document.body.style.cursor = ''
  }

  const startResize = (event: MouseEvent) => {
    ctx.isResizing.value = true
    ctx.startX.value = event.clientX
    ctx.startWidth.value = ctx.overlayWidth.value
    document.addEventListener('mousemove', handleResize)
    document.addEventListener('mouseup', stopResize)
    document.body.classList.add('resizing')
    event.preventDefault()
  }

  const showResizeCursor = () => {
    if (!ctx.isResizing.value) document.body.style.cursor = 'ew-resize'
  }

  const hideResizeCursor = () => {
    if (!ctx.isResizing.value) document.body.style.cursor = ''
  }

  return { startResize, handleResize, stopResize, showResizeCursor, hideResizeCursor }
}
