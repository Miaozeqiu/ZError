const IME_ENTER_GUARD_MS = 180

export type ComposerEnterAction = 'none' | 'submit' | 'break' | 'block'

export const composerEnterAction = (
  event: KeyboardEvent,
  composing: boolean,
  compositionEndedAt = 0,
): ComposerEnterAction => {
  if (event.key !== 'Enter') return 'none'
  if (event.shiftKey) return 'break'
  if (event.altKey || event.ctrlKey || event.metaKey) return 'none'
  if (event.isComposing || event.keyCode === 229 || composing) return 'none'
  if (compositionEndedAt && Date.now() - compositionEndedAt < IME_ENTER_GUARD_MS) return 'block'
  return 'submit'
}

export const shouldSubmitComposerEnter = (
  event: KeyboardEvent,
  composing: boolean,
  compositionEndedAt = 0,
) => composerEnterAction(event, composing, compositionEndedAt) === 'submit'
