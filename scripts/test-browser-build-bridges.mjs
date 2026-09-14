import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (path, mocks, extra = '') => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    .replaceAll('import.meta.env.DEV', 'false')
    .replaceAll('import.meta.hot', 'false')
  const { outputText } = ts.transpileModule(`${source}\n${extra}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`)
      return mocks[name]
    },
    window: { setTimeout: (callback) => { callback(); return 1 } },
  }, { filename: path })
  return module.exports
}

const frameHarness = ({ available = true, acknowledged = true, failDispatch = false } = {}) => {
  const requests = []
  const invocations = []
  const page = { __ZE_CLICKED__: 'stale click' }
  if (available) {
    page.__ZE_ASK_FRAMES__ = (op, extra) => {
      requests.push({ op, text: extra.text })
      page.__ZE_CLICKED__ = acknowledged ? extra.text : ''
      return true
    }
  }
  const invoke = async (command, args) => {
    assert.equal(command, 'browser_eval')
    invocations.push(args)
    if (args.script === 'engine-act') {
      return JSON.stringify({ ok: false, reason: 'not_found', retry: true })
    }
    if (failDispatch && args.script.includes('__ZE_ASK_FRAMES__')) throw new Error('view closed')
    return JSON.stringify(vm.runInNewContext(args.script, { window: page }))
  }
  const helpers = loadModule('src/services/browser/eval.ts', { '@tauri-apps/api/core': { invoke } })
  return { helpers, requests, invocations, page }
}

test('frame click sends quoted text as data and returns the bridge acknowledgement', async () => {
  const { helpers, requests, page } = frameHarness()
  const text = 'Course "A" \\ path\nsecond line ${window.injected = true}'
  const result = await helpers.clickFrameText('fixture', ` ${text} `)
  assert.equal(result.ok, true)
  assert.equal(result.text, text)
  assert.equal(result.href, '')
  assert.deepEqual(requests, [{ op: 'click', text }])
  assert.equal(page.injected, undefined)
})

test('empty frame click does not dispatch a browser action', async () => {
  const { helpers, invocations } = frameHarness()
  assert.equal((await helpers.clickFrameText('fixture', '  ')).ok, false)
  assert.equal(invocations.length, 0)
})

test('missing or failed frame bridge cannot reuse a stale click acknowledgement', async () => {
  for (const options of [{ available: false }, { failDispatch: true }]) {
    const { helpers, invocations } = frameHarness(options)
    assert.equal((await helpers.clickFrameText('fixture', 'New click')).ok, false)
    assert.equal(invocations.length, 1)
  }
})

test('an unanswered frame click reports failure', async () => {
  const { helpers } = frameHarness({ acknowledged: false })
  const result = await helpers.clickFrameText('fixture', 'Not found')
  assert.equal(result.ok, false)
  assert.equal(result.text, '')
})

test('the action engine succeeds through the restored frame fallback', async () => {
  const { helpers, requests, invocations } = frameHarness()
  const engine = loadModule('src/services/browser/engine/act.ts', {
    '../eval': helpers,
    './script': { ENGINE_ACT_SCRIPT: () => 'engine-act' },
    './types': { ACT_POLL_MS: 120, ACT_TIMEOUT_MS: 1000 },
  })
  const result = await engine.clickByLocator('fixture', { by: 'text', value: 'Course A' })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'Course A')
  assert.equal(requests.length, 1)
  assert.equal(invocations.filter(({ script }) => script === 'engine-act').length, 1)
})

const cursorHarness = (clicked = { ok: true, text: 'Course A' }) => {
  const clicks = []
  const browser = { id: 'fixture', url: 'https://example.test/course', title: 'Fixture', updatedAt: 1 }
  const bridge = loadModule('src/services/agent/cursorBridge.ts', {
    '../browser/appBrowser': {
      listAppBrowsers: () => [browser],
      getSelectedBrowserId: () => browser.id,
      getBrowserState: async () => browser,
      clickBrowserText: async (id, text) => { clicks.push({ id, text }); return clicked },
    },
    '../browser/siteGraph': { siteGraphAgentSnap: () => ({ page: 'fixture' }) },
    '../chaoxing/homework': { inspectChaoxingHomework: async () => ({ questions: [] }) },
    './chat': { browserChatSessions: { value: [] } },
    '../model/config': {},
  }, 'export { runCommand }')
  return { bridge, clicks }
}

test('screenshot and snapshot explicitly report unavailable capture with page metadata', async () => {
  const { bridge } = cursorHarness()
  for (const action of ['screenshot', 'snapshot']) {
    const result = await bridge.runCommand({ id: 'cmd', action })
    assert.equal(result.ok, false)
    assert.match(result.error, /未提供浏览器截图能力/)
    assert.equal(result.url, 'https://example.test/course')
    assert.equal(Object.hasOwn(result, 'image'), false)
  }
})

test('state and list remain usable without screenshot support', async () => {
  const { bridge } = cursorHarness()
  const state = await bridge.runCommand({ action: 'state' })
  assert.equal(state.ok, true)
  assert.equal(state.title, 'Fixture')
  assert.equal(Object.hasOwn(state, 'error'), false)
  const list = await bridge.runCommand({ action: 'list' })
  assert.equal(list.ok, true)
  assert.equal(list.browsers[0].id, 'fixture')
})

test('click_text preserves the real click outcome and reports screenshot failure separately', async () => {
  for (const clicked of [{ ok: true, text: 'Course A' }, { ok: false, error: '没有找到元素' }]) {
    const { bridge, clicks } = cursorHarness(clicked)
    const result = await bridge.runCommand({ action: 'click_text', args: { text: 'Course A' } })
    assert.equal(result.ok, clicked.ok)
    assert.equal(result.error, clicked.error)
    assert.equal(result.clicked, clicked)
    assert.match(result.screenshotError, /未提供浏览器截图能力/)
    assert.equal(Object.hasOwn(result, 'image'), false)
    assert.deepEqual(clicks, [{ id: 'fixture', text: 'Course A' }])
  }
})

test('inspect preserves homework data while reporting unavailable screenshots', async () => {
  const { bridge } = cursorHarness()
  const result = await bridge.runCommand({ action: 'inspect' })
  assert.equal(result.ok, true)
  assert.equal(result.card.questions.length, 0)
  assert.match(result.screenshotError, /未提供浏览器截图能力/)
  assert.equal(Object.hasOwn(result, 'image'), false)
})
