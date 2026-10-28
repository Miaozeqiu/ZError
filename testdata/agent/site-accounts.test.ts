import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetSiteAccount, rememberAccountsFromUserText, recoverSiteAccountsFromTexts, rememberLoginTyped, rememberSiteAccount, siteAccountOf, siteAccountsPrompt, platformFromUrl, siteAccountsReady, siteAccountsState } from '../../src/services/agent/siteAccounts'
const refs = (site: string) => ({ account: `{{secret:site/${site}/account}}`, password: `{{secret:site/${site}/password}}` })
beforeEach(async () => { await siteAccountsReady; await new Promise(resolve => setTimeout(resolve, 0)); siteAccountsState.rows = {} })
afterEach(() => { Object.keys(siteAccountsState.rows).forEach(forgetSiteAccount) })
describe('site credential references', () => {
  it('uses only references for the current website', () => {
    rememberSiteAccount('zjooc', refs('zjooc'))
    rememberSiteAccount('zhihuishu', refs('zhihuishu'))
    const prompt = siteAccountsPrompt('https://www.zjooc.cn/course')
    expect(prompt).toContain('在浙学')
    expect(prompt).toContain(refs('zjooc').password)
    expect(prompt).not.toContain(refs('zhihuishu').password)
    expect(prompt).toContain('secret_ref')
  })
  it('does not inject a just-entered plaintext value while encryption is pending', () => {
    rememberSiteAccount('chaoxing', { account: 'synthetic-user', password: 'synthetic-private-value' })
    const prompt = siteAccountsPrompt('https://passport2.chaoxing.com/login')
    expect(prompt).not.toContain('synthetic-user')
    expect(prompt).not.toContain('synthetic-private-value')
  })
  it('does not borrow credentials from another website or an unknown custom subdomain', () => {
    rememberSiteAccount('example.com', refs('example.com'))
    expect(siteAccountsPrompt('https://unknown.example.com')).toBe('')
    expect(siteAccountsPrompt('https://zjooc.cn')).toBe('')
    expect(platformFromUrl('https://www.example.com/login')).toBe('example.com')
  })
  it('shares references across a configured login domain', () => {
    rememberSiteAccount('menhu.haou.edu.cn', refs('menhu.haou.edu.cn'))
    expect(siteAccountsPrompt('https://authserver.open.ha.cn/login')).toContain(refs('menhu.haou.edu.cn').password)
  })
  it('does not parse, recover or overwrite credentials by scanning text or observing typing', () => {
    rememberSiteAccount('zjooc', refs('zjooc'))
    rememberAccountsFromUserText('在浙学账号 new-user 密码 new-value', 'https://zjooc.cn')
    recoverSiteAccountsFromTexts(['密码是 another-value'], 'https://zjooc.cn')
    rememberLoginTyped('https://zjooc.cn', 'input[type=password]', 'typed-value')
    expect(siteAccountOf('zjooc')).toMatchObject(refs('zjooc'))
  })
  it('cannot resurrect a forgotten credential from old user messages', () => {
    rememberSiteAccount('chaoxing', refs('chaoxing'))
    forgetSiteAccount('chaoxing')
    recoverSiteAccountsFromTexts(['学习通账号 old-user 密码 old-value'], 'https://passport2.chaoxing.com')
    expect(siteAccountOf('chaoxing')).toBeNull()
  })
})
