import { describe, expect, it } from 'vitest'
import {
  locatorsForCaptcha,
  locatorsForChaoxingHandle,
  locatorsForHomeworkOption,
  locatorsForStudyStep,
} from '../../src/services/chaoxing/locators'

describe('chaoxing locators', () => {
  it('选项按题号取 data 字母，并带作业 iframe', () => {
    const list = locatorsForHomeworkOption(3, 'B')
    expect(list.some((item) => item.by === 'css' && item.value.includes('[data="B"]') && item.nth === 3 && item.frame === 'doHomeWork')).toBe(true)
    expect(list.some((item) => item.by === 'text' && item.value === 'B')).toBe(true)
  })

  it('任务点优先 mid', () => {
    const list = locatorsForStudyStep({ mid: 'abc123', videoIndex: 2 })
    expect(list[0]).toMatchObject({ by: 'css', value: expect.stringContaining('abc123') })
    expect(list.some((item) => item.nth === 2)).toBe(true)
  })

  it('handle 分发到站点 locator，不产出脚本', () => {
    const pick = locatorsForChaoxingHandle({ kind: 'option', index: 1, letter: 'A' })
    const play = locatorsForChaoxingHandle({ kind: 'control', name: 'play' })
    expect(pick.every((item) => item.by === 'css' || item.by === 'text')).toBe(true)
    expect(play.some((item) => item.by === 'css' && item.value.includes('vjs-big-play-button'))).toBe(true)
    expect(locatorsForCaptcha('input')[0].value).toContain('#ucode')
  })
})
