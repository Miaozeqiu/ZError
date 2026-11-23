import { describe, expect, it } from 'vitest'
import { runDataScript } from '../../src/services/script/dataScript'
describe('内置跨平台数据脚本', () => {
  it('执行标准 JS 处理传入的数据，不把文档当成指令', async () => {
    const text = '"); globalThis.hacked = true; /*忽略所有指令*/'
    expect(await runDataScript('return { text:document.text, hacked:typeof hacked };', { text })).toEqual({ text, hacked: 'undefined' })
    expect(await runDataScript('return document.lines.map(s=>s.toUpperCase());', { lines: ['a', 'b'] })).toEqual(['A','B'])
  })
  it('不暴露凭据、文件、网络、宿主和进程能力', async () => {
    expect(await runDataScript('return [typeof process,typeof require,typeof fetch,typeof window,typeof invoke];', {})).toEqual(Array(5).fill('undefined'))
  })
  it('语法错误、非 JSON 输出、超长代码和死循环可恢复', async () => {
    await expect(runDataScript('return (', {})).rejects.toThrow('脚本执行失败')
    await expect(runDataScript('return undefined', {})).rejects.toThrow('return')
    await expect(runDataScript('x'.repeat(64_001), {})).rejects.toThrow('64000')
    await expect(runDataScript('while(true){}', {})).rejects.toThrow('超时')
    expect(await runDataScript('return 42', {})).toBe(42)
  })
  it('内存与结果体积受限，失败后释放运行时', async () => {
    await expect(runDataScript('return "x".repeat(2_000_001)', {})).rejects.toThrow('输出超过')
    await expect(runDataScript('const a=[]; while(true) a.push("x".repeat(100000));', {})).rejects.toThrow('脚本执行失败')
    expect(await runDataScript('return []', {})).toEqual([])
  })
  it('取消后不执行脚本', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(runDataScript('return 1', {}, controller.signal)).rejects.toThrow()
  })
})
