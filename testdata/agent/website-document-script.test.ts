// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const script = readFileSync('src-tauri/src/app_browser/document_script.js', 'utf8')
const run = (args: object, expected: object = { url: location.href }) => window.eval(`(${script})(${JSON.stringify(expected)},${JSON.stringify(args)})`)
beforeEach(() => {
  document.body.innerHTML = '<input id="account" value="private-account"><input id="password" type="password" value="private-password"><input id="captcha"><video id="video"></video><button id="next">Next</button>'
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 40 }] as any)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
describe('原生固定文档脚本', () => {
  it('显式读回答案字段，但登录页和私密节点仍不可读取', () => {
    expect(run({ action: 'value', selector: '#account' })).toMatchObject({ ok: false, reason: 'private_input' })
    document.body.innerHTML = '<textarea id="answer">已有答案</textarea><input id="hidden" type="hidden" value="private">'
    expect(run({ action: 'value', selector: '#answer' })).toMatchObject({ ok: true, value: '已有答案' })
    expect(run({ action: 'value', selector: '#hidden' })).toMatchObject({ ok: false })
    document.querySelector('#answer')!.setAttribute('data-zerror-private', 'true')
    expect(run({ action: 'value', selector: '#answer' })).toMatchObject({ ok: false })
  })
  it('读取不会返回输入框的值，普通填写不能操作密码或受保护账号', () => {
    const read = run({ action: 'query', selector: 'input', limit: 40 })
    expect(JSON.stringify(read)).not.toContain('private-account')
    expect(JSON.stringify(read)).not.toContain('private-password')
    expect(run({ action: 'fill', selector: '#password', text: 'other' })).toMatchObject({ ok: false, reason: 'private_input' })
    document.querySelector('#account')!.setAttribute('data-zerror-private', 'true')
    expect(run({ action: 'fill', selector: '#account', text: 'other' })).toMatchObject({ ok: false })
    expect(run({ action: 'fill', selector: '#captcha', text: 'abcde' })).toMatchObject({ ok: true, filled: true })
    expect(() => run({ action: 'click', selector: '#next' }, { url: 'https://other.example/' })).toThrow('Document changed')
  })
  it('媒体结束后释放监听和计时器，取消与超时也释放资源', async () => {
    vi.useFakeTimers()
    const media = document.querySelector('video')!
    let ended = false
    Object.defineProperty(media, 'ended', { get: () => ended })
    const args = { action: 'media_wait', selector: 'video', until: 'ended', timeoutMs: 30000, wait_id: 'one' }
    const pending = run(args)
    // WebKit may dispatch pause before ended, with ended already true.
    ended = true; media.dispatchEvent(new Event('pause'))
    expect(await pending).toMatchObject({ event: 'ended', ended: true })
    expect(vi.getTimerCount()).toBe(0)
    ended = false
    const cancelled = run({ ...args, wait_id: 'two' })
    run({ action: 'media_cancel', wait_id: 'two' })
    expect(await cancelled).toMatchObject({ event: 'cancelled' })
    expect(vi.getTimerCount()).toBe(0)
    const timed = run({ ...args, wait_id: 'three', timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(50)
    expect(await timed).toMatchObject({ event: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('同网址重载也不能复用 fallback 文档身份', () => {
    const identity = run({ action: 'identity' })
    expect(identity.frameId).toBe('wry-main')
    expect(run({ action: 'query', selector: '#next', limit: 1 }, identity)).toMatchObject({ ok: true })
    expect(() => run({ action: 'click', selector: '#next' }, { ...identity, loaderId: 'replaced' })).toThrow('Document changed')
  })
})

it('按有界分页返回可定位节点，普通填答只可检查是否为空和相等', () => {
  document.body.innerHTML = '<section><input id="first" value="example-one"><textarea id="second">example-two</textarea></section>'
  const read = run({ action: 'query', selector: 'input,textarea', offset: 1, limit: 1 })
  expect(read.total).toBe(2)
  expect(read.nodes).toHaveLength(1)
  expect(read.nodes[0]).toMatchObject({ index: 2, hasValue: true, text: '' })
  expect(document.querySelector(read.nodes[0].selector)?.id).toBe('second')
  expect(JSON.stringify(read)).not.toContain('example-two')
  expect(run({ action: 'compare', selector: '#second', text: 'example-two' })).toEqual({ ok: true, matches: true })
  expect(run({ action: 'compare', selector: '#second', text: 'different' })).toEqual({ ok: true, matches: false })
  document.querySelector('#first')!.setAttribute('data-zerror-private', 'true')
  expect(run({ action: 'compare', selector: '#first', text: 'example-one' })).toMatchObject({ ok: false, reason: 'private_input' })
})

it('只允许导出有界图片元素，不截取普通容器或密码控件', async () => {
  const { webcrypto } = await import('node:crypto')
  Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  Object.defineProperty(window, 'TextEncoder', { configurable: true, value: TextEncoder })
  document.body.innerHTML = '<img id="image" width="120" height="40"><div id="container"></div>'
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,' + 'A'.repeat(44))
  expect(await run({ action: 'image', selector: '#image' })).toMatchObject({ ok: true, image_id: expect.stringMatching(/^[a-f0-9]{64}$/), width: 120, height: 40 })
  expect(run({ action: 'image', selector: '#container' })).toMatchObject({ ok: false, reason: 'not_image' })
  document.querySelector('img')!.width = 5000
  expect(run({ action: 'image', selector: '#image' })).toMatchObject({ ok: false, reason: 'image_size' })
})

it('额外 DOM 属性只有通过原生凭据隔离后才投影，私密属性和值始终排除', () => {
  document.body.innerHTML = '<div id="row" data-course="42" onclick="openCourse(42)" value="private" style="color:red">课程</div>'
  const args = { action: 'query', selector: '#row', limit: 1, attributes: ['data-course','onclick','value','style'] }
  expect(run(args).nodes[0].attributes['data-course']).toBeUndefined()
  const row = run({ ...args, allowFlags: true }).nodes[0]
  expect(row.attributes['data-course']).toBe('42')
  expect(row.attributes.onclick).toBe('openCourse(42)')
  expect(row.attributes.value).toBeUndefined()
  expect(row.attributes.style).toBeUndefined()
  document.querySelector('#row')!.setAttribute('data-zerror-private','true')
  const hidden = run({ ...args, allowFlags: true }).nodes[0]
  expect(hidden.text).toBe('')
  expect(hidden.attributes['data-course']).toBeUndefined()
})

it('字形读取拒绝登录文档和无效光栅，只输出所选字体的有界位图特征', async () => {
  const raster = { size:48, fontSize:36, baseline:38, threshold:30, coarse:16, fine:24 }
  document.body.insertAdjacentHTML('beforeend','<div id="glyph" style="font-family:fixture-font">甲</div>')
  const args = { action:'glyphs', selector:'#glyph', characters:'甲', raster }
  expect(await run(args)).toMatchObject({ok:false,reason:'private_input'})
  document.querySelector('#password')!.remove()
  expect(await run({...args,characters:'甲'.repeat(17)})).toMatchObject({ok:false,reason:'invalid_raster'})
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:async()=>[{status:'loaded'}]}})
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(this:HTMLCanvasElement) {
    const canvas=this
    return { clearRect:()=>{}, fillText:()=>{}, measureText:()=>({width:10}), getImageData:()=>({data:new Uint8ClampedArray(canvas.width*canvas.height*4).fill(255)}) } as any
  })
  const response = await run(args)
  expect(response).toMatchObject({ok:true,family:'fixture-font',webFont:true,glyphs:[{character:'甲',covered:true,empty:false}]})
  expect(response.glyphs[0].coarse).toHaveLength(32)
  expect(response.glyphs[0].fine).toHaveLength(72)
  expect(new Set(response.glyphs[0].coarse)).toEqual(new Set([255]))
  Object.defineProperty(document,'fonts',{configurable:true,value:{load:async()=>[]}})
  expect(await run(args)).toMatchObject({ok:true,webFont:false})
})
