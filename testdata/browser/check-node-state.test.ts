// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// Run the actual read-only function deployed in the Rust CDP handler against real DOM.
const source = readFileSync(resolve('src-tauri/src/cef/browser.rs'), 'utf8')
const block = source.slice(source.indexOf('async fn check_node_state('))
const script = block.match(/"functionDeclaration": r#"([\s\S]*?)"#/)[1]
const probe = new Function(`return (${script})`)()
describe('native checked-state probe', () => {
  it('reads current input property rather than stale checked attributes', () => {
    document.body.innerHTML = '<label><input type="checkbox" checked>选项 A</label>'
    const input = document.querySelector('input')!
    input.checked = false
    expect(probe.call(document.querySelector('label'))).toMatchObject({ supported: true, checked: false, kind: 'checkbox', connected: true })
    input.checked = true
    expect(probe.call(input).checked).toBe(true)
  })
  it('recognizes associated labels, radios, disabled and detached nodes', () => {
    document.body.innerHTML = '<label for="x">选项</label><input id="x" type="radio" disabled>'
    const input = document.querySelector('input')!
    expect(probe.call(document.querySelector('label'))).toMatchObject({ kind: 'radio', disabled: true, checked: false })
    input.remove()
    expect(probe.call(input).connected).toBe(false)
  })
  it('supports accessible custom controls without treating ordinary elements as options', () => {
    document.body.innerHTML = '<div role="checkbox" aria-checked="true"></div><button>提交</button>'
    expect(probe.call(document.querySelector('div'))).toMatchObject({ supported: true, checked: true })
    expect(probe.call(document.querySelector('button'))).toEqual({ supported: false })
  })
  it.each(['a', 'button', 'div', 'li'])('does not validate a %s navigation target using a nested checkbox', tag => {
    document.body.innerHTML = `<${tag} id="chapter"><span>1.1 逻辑学是什么</span><label><input type="checkbox">任务点</label></${tag}>`
    expect(probe.call(document.querySelector('#chapter'))).toEqual({ supported: false })
  })
  it('supports an explicit custom checkbox delegating state to its single input', () => {
    document.body.innerHTML = '<div role="checkbox"><input type="checkbox" checked></div>'
    expect(probe.call(document.querySelector('div'))).toMatchObject({ supported: true, checked: true, kind: 'checkbox' })
  })
  it('rejects a whole question containing multiple options instead of picking its first checkbox', () => {
    document.body.innerHTML = '<div><label><input type="checkbox">A</label><label><input type="checkbox">B</label></div>'
    expect(probe.call(document.querySelector('div'))).toEqual({ supported: false })
  })
})

const visibleBlock = source.slice(source.indexOf('pub(crate) async fn visible_control_backend('))
const visibleScript = visibleBlock.match(/"functionDeclaration":r#"([\s\S]*?)"#/)[1]
const clickTarget = new Function(`return (${visibleScript})`)()
describe('native click target identity', () => {
  it.each(['a', 'button', 'div', 'li'])('keeps the requested %s instead of redirecting to a descendant label', tag => {
    document.body.innerHTML = `<${tag} id="chapter"><span>1.1 逻辑学是什么</span><label><input type="checkbox">任务点</label></${tag}>`
    const requested = document.querySelector('#chapter')!
    expect(clickTarget.call(requested)).toBe(requested)
  })
  it('still targets the enclosing label when its text is selected', () => {
    document.body.innerHTML = '<label><input type="radio"><span>选项 A</span></label>'
    expect(clickTarget.call(document.querySelector('span'))).toBe(document.querySelector('label'))
    expect(clickTarget.call(document.querySelector('input'))).toBe(document.querySelector('label'))
  })
  it('targets a visible associated label for an input without changing a surrounding link', () => {
    document.body.innerHTML = '<a id="chapter"><input id="x" type="checkbox"><label for="x">任务点</label></a>'
    const label = document.querySelector('label')!
    label.getBoundingClientRect = () => ({ width: 100, height: 20 } as DOMRect)
    expect(clickTarget.call(document.querySelector('input'))).toBe(label)
    expect(clickTarget.call(document.querySelector('a'))).toBe(document.querySelector('a'))
  })
})
