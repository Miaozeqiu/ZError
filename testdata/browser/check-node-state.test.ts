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
  it('rejects a whole question containing multiple options instead of picking its first checkbox', () => {
    document.body.innerHTML = '<div><label><input type="checkbox">A</label><label><input type="checkbox">B</label></div>'
    expect(probe.call(document.querySelector('div'))).toEqual({ supported: false })
  })
})
