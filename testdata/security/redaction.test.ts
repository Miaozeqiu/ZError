import { describe, expect, it } from 'vitest'
import { redactObject, redactText, rememberRedaction, UNBOUND_SITE_CREDENTIAL } from '../../src/services/security/secretRedaction'
describe('literal secret replacement', () => {
  it('新输入的已知密码不继承学习通归属，既有引用和 API 引用保持完整', () => {
    const password = 'shared-password-from-chat'
    const reference = '{{secret:site/chaoxing/password}}'
    rememberRedaction(password, reference)
    rememberRedaction('separate-api-key', '{{secret:model/provider/apiKey}}')
    const safe = redactText(`在浙学密码 ${password}，显式引用 ${reference}，密钥 separate-api-key`, { unboundSiteCredentials: true })
    expect(safe).toBe(`在浙学密码 ${UNBOUND_SITE_CREDENTIAL}，显式引用 ${reference}，密钥 {{secret:model/provider/apiKey}}`)
    expect(redactText(password)).toBe(reference)
    expect(safe).not.toContain(password)
  })
  it('handles quotes, Unicode, regex syntax and overlapping values without corrupting references', () => {
    rememberRedaction('secret', '{{secret:site/test/password}}')
    rememberRedaction('a+b["密码\\!', '{{secret:site/test/account}}')
    const result = redactObject({ role: 'user', content: '使用 a+b["密码\\! 和 secret', arguments: JSON.stringify({ text: 'a+b["密码\\!' }) })
    expect(result.content).toBe('使用 {{secret:site/test/account}} 和 {{secret:site/test/password}}')
    expect(JSON.parse(result.arguments).text).toBe('{{secret:site/test/account}}')
    expect(redactText(result.content)).toBe(result.content)
  })
  it('does not replace short values inside tool names or ordinary words', () => {
    rememberRedaction('a', '{{secret:site/short/account}}')
    expect(redactObject({ name: 'browser_navigate', role: 'assistant', content: '账号 a', arguments: '{"text":"a"}' })).toEqual({
      name: 'browser_navigate', role: 'assistant', content: '账号 {{secret:site/short/account}}', arguments: '{"text":"{{secret:site/short/account}}"}',
    })
    expect(redactText('password')).toBe('password')
  })
})
