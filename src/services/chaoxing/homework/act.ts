import { act } from '../../browser/protocol'

export const clickHomeworkBox = async (id: string, script: string) => {
  const cdp = await act(id, { op: 'click', at: { by: 'script', value: script } })
  return {
    ok: Boolean(cdp.ok),
    text: String(cdp.text || ''),
    error: cdp.error,
    via: 'cdp',
  }
}

export const fillHomeworkBox = async (id: string, script: string, text: string) => {
  const cdp = await act(id, { op: 'type', text, at: { by: 'script', value: script } })
  return {
    ok: Boolean(cdp.ok) && cdp.filled !== false,
    filled: cdp.filled !== false,
    text: String(cdp.text || text),
    error: cdp.error,
    via: 'cdp',
  }
}
