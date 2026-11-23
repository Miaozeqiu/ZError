// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const highlight = vi.hoisted(() => vi.fn((source: string) => ({ value: `<span>${source}</span>` })))
vi.mock('../../src/utils/ui/highlightSetup', () => ({ hljs: { getLanguage: () => true, highlight, highlightAuto: highlight } }))
import { createThreadCodeHighlighter } from '../../src/utils/ui/threadCodeHighlight'
let pane: HTMLDivElement
let stop: () => void
const frames = new Map<number, FrameRequestCallback>()
let sequence = 0
const drain = async () => {
  await Promise.resolve()
  const queued = [...frames.values()]; frames.clear()
  queued.forEach(callback => callback(0))
  await Promise.resolve()
}
beforeEach(() => {
  highlight.mockClear(); frames.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  pane = document.createElement('div'); document.body.append(pane)
})
afterEach(() => { stop(); pane.remove(); vi.unstubAllGlobals() })
describe('incremental code highlighting', () => {
  it('streams one block without rescanning or rewriting earlier code and preserves selection', async () => {
    pane.innerHTML = '<div class="assistant-text"><p>Keep this selection</p><pre><code class="language-js">old</code></pre><pre><code class="language-js">new</code></pre></div>'
    const highlighter = createThreadCodeHighlighter(() => pane); stop = highlighter.dispose
    highlighter.schedule(); await drain(); await drain()
    expect(highlight).toHaveBeenCalledTimes(2)
    const codes = pane.querySelectorAll('code')
    const firstNode = codes[0].firstChild
    const selection = window.getSelection()!; const text = pane.querySelector('p')!.firstChild!
    selection.setBaseAndExtent(text, 0, text, 4)
    // A stream changes only its final code block; text elsewhere should never be rewritten.
    codes[1].textContent = 'new tokens'
    highlighter.schedule(); await drain(); await drain()
    expect(highlight).toHaveBeenCalledTimes(3)
    expect(codes[0].firstChild).toBe(firstNode)
    expect(selection.toString()).toBe('Keep')
  })
  it('leaves diagram blocks alone and cancels queued work when the view is removed', async () => {
    pane.innerHTML = '<div class="assistant-text"><pre><code class="language-mermaid">graph LR</code></pre><pre><code class="language-js">pending</code></pre></div>'
    const highlighter = createThreadCodeHighlighter(() => pane); stop = highlighter.dispose
    highlighter.schedule(); highlighter.dispose(); await drain()
    expect(highlight).not.toHaveBeenCalled()
    highlighter.schedule(); await drain()
    expect(highlight).toHaveBeenCalledExactlyOnceWith('pending', expect.anything())
  })
})
