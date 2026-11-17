import { describe, expect, it } from 'vitest'
import { locatorFromCache, rememberPageRefs } from '../../src/services/browser/engine/refs'
import { locatorScriptArg } from '../../src/services/browser/engine/types'

describe('快照 ref', () => {
  it('精确节点身份传到原生定位器，不退化为同名序号查找', () => {
    expect(locatorScriptArg({ by: 'role', value: 'button', name: '提交', backend: 99, frameId: 'top', loaderId: 'doc1' }))
      .toMatchObject({ backend: 99, frameId: 'top', loaderId: 'doc1' })
  })
  it('记住角色和帧，填写能认出章节按钮不是输入框', () => {
    rememberPageRefs('b1', [
      {
        id: 'e172',
        role: 'button',
        name: '4.5',
        locator: { by: 'text', value: '4.5', exact: true, frame: 'https://mooc1.chaoxing.com/mycourse/studentstudy' },
      },
      {
        id: 'e3',
        role: 'textbox',
        name: '账号',
        locator: { by: 'css', value: '#username', frame: 'https://background.zjooc.cn/gxptLogin', frameId: 'login', loaderId: 'document-2' },
      },
    ])
    const chapter = locatorFromCache('b1', 'e172')
    expect(chapter?.role).toBe('button')
    expect(chapter?.value).toBe('4.5')
    expect(/^(textbox|searchbox|combobox|spinbutton)$/.test(String(chapter?.role))).toBe(false)
    const box = locatorFromCache('b1', 'e3')
    expect(box?.role).toBe('textbox')
    expect(box?.frame).toContain('zjooc.cn')
    expect(box?.frameId).toBe('login')
    expect(box?.loaderId).toBe('document-2')
  })
})
