import { expect, it } from 'vitest'
import { isReadOnlyBrowserScript } from '../../src/services/agent/core/scriptEffect'

it.each([
  'document.title',
  'document.querySelector("h1")?.textContent',
  'document.getElementById("player").getAttribute("src")',
  '(() => { const el = document.querySelector("h1"); return { title: el?.textContent, url: window.location.href } })()',
  '(() => document.body.innerText)()',
  'document.title.includes("foo")', // unknown call: conservatively journalled
])('classifies read expression conservatively: %s', script => {
  expect(isReadOnlyBrowserScript(script)).toBe(!script.includes('.includes('))
})

it.each([
  'document.title = "changed"', 'document.body.scrollTop++', 'delete document.title',
  'document.querySelector("video").play()', 'document.querySelector("button").click()',
  'fetch("/submit")', 'eval("document.title = 1")',
  '(() => { const f = document.querySelector; return f("h1") })()',
  '(() => { const document = window; return document.querySelector("h1") })()',
  'document[window.method]()', 'document.constructor("return fetch(\"/submit\")")()',
  'new Image()', '(() => { throw new Error("oops") })()',
  'var globalValue = document.title',
  'function invalid(', '',
])('retains the journal for side effects or unknown code: %s', script => {
  expect(isReadOnlyBrowserScript(script)).toBe(false)
})
