/** Only expose selections belonging to this chat; leave editor/other-pane ranges alone. */
export const readThreadSelection = (root: HTMLElement | null): string => {
  const selection = root?.ownerDocument.getSelection()
  if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return ''
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return ''
  // Selection.toString preserves the engine's rendered line breaks, unlike Range.toString.
  return selection.toString().replace(/\u200B/g, '').trim()
}

export const clearThreadSelection = (root: HTMLElement | null) => {
  const selection = root?.ownerDocument.getSelection()
  if (root && selection && root.contains(selection.anchorNode) && root.contains(selection.focusNode)) {
    selection.removeAllRanges()
  }
}
