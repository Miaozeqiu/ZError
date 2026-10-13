import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { SNAPSHOT_SCRIPT } from '../../src/services/browser/engine/snapshot'
import { rememberPageRefs, locatorFromCache } from '../../src/services/browser/engine/refs'
import { buildLocateBoxScript } from '../../src/services/browser/engine/locate'

const html = `<!doctype html><html><body>
<form>
  <label>用户名</label>
  <input aria-label="用户名" placeholder="请输入用户名/手机号">
  <label for="password">密码</label>
  <input id="password" type="password" placeholder="请输入密码">
  <button type="submit">登录</button>
</form>
</body></html>`

describe('登录页快照定位', () => {
  it('textbox 的 ref 仍是 role 定位，并能命中用户名框', () => {
    const dom = new JSDOM(html, { url: 'https://background.zjooc.cn/gxptLogin', runScripts: 'dangerously' })
    const script = dom.window.document.createElement('script')
    script.textContent = `window.__zeSnap = ${SNAPSHOT_SCRIPT}`
    dom.window.document.body.appendChild(script)
    const snapshot = (dom.window as unknown as { __zeSnap: { refs: Array<{ id: string; role: string; name: string; locator: { by: string; value: string; name?: string } }> } }).__zeSnap
    const box = snapshot.refs.find((item) => item.role === 'textbox' && /用户名/.test(item.name))
    expect(box).toBeTruthy()
    expect(box?.locator.by).toBe('css')
    expect(box?.locator.value).toContain('placeholder')
    rememberPageRefs('login', snapshot.refs.map((item) => ({
      id: item.id,
      role: item.role,
      name: item.name,
      locator: item.locator as { by: 'role'; value: string; name?: string },
    })))
    const cached = locatorFromCache('login', box!.id)
    expect(cached?.by).toBe('css')
    expect(cached?.name).toMatch(/用户名/)
    const locate = buildLocateBoxScript({ by: 'css', value: '#login_name' })
    expect(locate).toContain('#login_name')
  })
})
