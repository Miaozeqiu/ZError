import { clickByLocators, fillByLocators } from '../../browser/engine'
import type { LocateQuery } from '../../browser/protocol'

export type ClickTarget = LocateQuery | LocateQuery[]

const asList = (at: ClickTarget) => (Array.isArray(at) ? at : [at]).filter((item) => item.value)

const locatorOf = (at: LocateQuery) => ({
  by: at.by,
  value: at.value,
  nth: at.nth,
  frame: at.frame,
  exact: at.exact,
})

export const clickHomeworkBox = async (id: string, at: ClickTarget) => {
  const locators = asList(at).map(locatorOf)
  if (!locators.length) return { ok: false, text: '', error: '没有找到目标', via: 'cdp' }
  const acted = await clickByLocators(id, locators, 1600)
  return {
    ok: Boolean(acted.ok),
    text: String(acted.text || locators[0]?.value || ''),
    error: acted.ok ? undefined : (acted.error || '没有找到目标'),
    via: 'cdp',
  }
}

export const fillHomeworkBox = async (id: string, at: ClickTarget, text: string) => {
  const locators = asList(at).map(locatorOf)
  if (!locators.length) return { ok: false, filled: false, text, error: '没有找到输入框', via: 'cdp' }
  const acted = await fillByLocators(id, locators, text, 1800)
  return {
    ok: Boolean(acted.ok) && acted.filled !== false,
    filled: acted.filled !== false,
    text: String(acted.text || text),
    error: acted.ok ? undefined : (acted.error || '没有找到输入框'),
    via: 'cdp',
  }
}
