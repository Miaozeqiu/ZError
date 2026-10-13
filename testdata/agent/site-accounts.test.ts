import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetSiteAccount,
  rememberAccountsFromUserText,
  rememberLoginTyped,
  rememberSiteAccount,
  siteAccountOf,
  siteAccountsPrompt,
  platformFromUrl,
} from '../../src/services/agent/siteAccounts'

const prevZhihuishu = siteAccountOf('zhihuishu')
const prevZjooc = siteAccountOf('zjooc')
const prevChaoxing = siteAccountOf('chaoxing')

afterEach(() => {
  if (prevZhihuishu) rememberSiteAccount('zhihuishu', prevZhihuishu)
  else forgetSiteAccount('zhihuishu')
  if (prevZjooc) rememberSiteAccount('zjooc', prevZjooc)
  else forgetSiteAccount('zjooc')
  if (prevChaoxing) rememberSiteAccount('chaoxing', prevChaoxing)
  else forgetSiteAccount('chaoxing')
})

describe('siteAccountsPrompt', () => {
  it('在浙学页优先用 zjooc 槽', () => {
    rememberSiteAccount('zjooc', { account: 'zjooc-id', password: 'zjooc-pw' })
    const text = siteAccountsPrompt('https://www.zjooc.cn/ucenter/student/course/study/x/plan')
    expect(text).toContain('在浙学')
    expect(text).toContain('zjooc-id')
    expect(text).toMatch(/不是智慧树/)
  })

  it('在浙学页不把已记账密标成智慧树', () => {
    rememberSiteAccount('zhihuishu', { account: 'test-zjooc-id', password: 'test-zjooc-pw' })
    forgetSiteAccount('zjooc')
    const text = siteAccountsPrompt('https://www.zjooc.cn/ucenter/student/course/study/x/plan/detail/y')
    expect(text).toContain('在浙学')
    expect(text).toContain('test-zjooc-id')
    expect(text).toMatch(/不是智慧树/)
    expect(text).not.toMatch(/智慧树 账号/)
  })

  it('智慧树页仍用智慧树标签', () => {
    rememberSiteAccount('zhihuishu', { account: 'test-zjooc-id', password: 'test-zjooc-pw' })
    const text = siteAccountsPrompt('https://onlineh5.zhihuishu.com/student/course')
    expect(text).toContain('智慧树 账号')
    expect(text).toContain('当前页用智慧树那套')
  })
})

describe('rememberAccountsFromUserText', () => {
  it('只说密码时按当前页更新在浙学', () => {
    rememberSiteAccount('zjooc', { account: '19703092478', password: 'old' })
    rememberAccountsFromUserText('密码是bingbaby928@，你更新下密码', 'https://www.zjooc.cn/login')
    expect(siteAccountOf('zjooc')?.password).toBe('bingbaby928@')
    expect(siteAccountOf('zjooc')?.account).toBe('19703092478')
  })

  it('没有网址且没点名站点时，只说密码不乱写', () => {
    rememberSiteAccount('chaoxing', { account: 'a', password: 'keep' })
    rememberAccountsFromUserText('密码是should-not-write')
    expect(siteAccountOf('chaoxing')?.password).toBe('keep')
  })

  it('文案点名在浙学也能只更新密码', () => {
    rememberSiteAccount('zjooc', { account: 'u', password: 'old' })
    rememberAccountsFromUserText('在浙学密码是newpass123')
    expect(siteAccountOf('zjooc')?.password).toBe('newpass123')
  })

  it('任务里夹着「密码是」也会记下', () => {
    rememberSiteAccount('zjooc', { account: '19703092478', password: 'old' })
    rememberAccountsFromUserText('你完成下在浙学，成衣课程的章节任务密码是bingbaby928@')
    expect(siteAccountOf('zjooc')?.password).toBe('bingbaby928@')
    expect(siteAccountOf('zjooc')?.account).toBe('19703092478')
  })
})

describe('rememberLoginTyped', () => {
  it('验证码不会盖掉密码', () => {
    rememberSiteAccount('zjooc', { account: '19703092478', password: 'old' })
    const url = 'https://background.zjooc.cn/gxptLogin?redirect_url=https://www.zjooc.cn'
    rememberLoginTyped(url, 'input[placeholder="请输入用户名/手机号"]', '19703092478')
    rememberLoginTyped(url, 'input[placeholder="请输入密码"]', 'bingbaby928@')
    rememberLoginTyped(url, 'input[placeholder="请输入验证码"]', '16290')
    expect(siteAccountOf('zjooc')?.account).toBe('19703092478')
    expect(siteAccountOf('zjooc')?.password).toBe('bingbaby928@')
  })
})

describe('platformFromUrl', () => {
  it('认在浙学主机', () => {
    expect(platformFromUrl('https://www.zjooc.cn/ucenter/student/course/build/list')).toBe('zjooc')
  })
})
