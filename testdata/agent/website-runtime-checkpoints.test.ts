import { describe, expect, it, vi } from 'vitest'
import { createWebsiteCheckpointStore, sameWorkflowInput, type WebsiteCheckpoint } from '../../src/services/agent/websiteRuntime/checkpoints'
import { runtimeBinding } from './fixtures/websiteRuntime'
const entry = (id = 'one', sessionId = 'chat'): WebsiteCheckpoint => ({ id, sessionId, browserId: 'tab', name: 'browser_site_academy__read_catalog',
  installed: { ...runtimeBinding(), source: 'repository-source' }, input: { course: 'example' }, state: { phase: 'waiting' }, updatedAt: 1000 })
describe('持久网站流程检查点', () => {
  it('跨实例重新读取原版本和状态，并隔离会话及网站的清理范围', async () => {
    let document: any = null
    const io = { read: async () => structuredClone(document), write: async (value: any) => { document = structuredClone(value) } }
    let store = createWebsiteCheckpointStore(io)
    await Promise.all([store.save(entry()), store.save(entry('two', 'other-chat'))])
    store = createWebsiteCheckpointStore(io)
    expect(await store.list('chat')).toEqual([entry()])
    await store.removeSession('chat')
    expect(await store.list('other-chat')).toEqual([entry('two', 'other-chat')])
    await store.removeHost('academy.example')
    expect(document.entries).toEqual([])
    expect(sameWorkflowInput({ a: 1, b: { x: 2 } }, { b: { x: 2 }, a: 1 })).toBe(true)
  })
  it('拒绝超限状态或损坏数据，写入失败不会覆盖已保存检查点', async () => {
    let document: any = { version: 1, entries: [entry()] }
    const write = vi.fn(async (value: any) => { document = structuredClone(value) })
    const store = createWebsiteCheckpointStore({ read: async () => structuredClone(document), write })
    await expect(store.save({ ...entry(), state: { text: 'x'.repeat(8193) } })).rejects.toThrow('超过限制')
    expect(write).not.toHaveBeenCalled()
    write.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(store.save(entry('two'))).rejects.toThrow('disk unavailable')
    expect(await store.list('chat')).toEqual([entry()])
    document = { version: 1, entries: [{ ...entry(), state: null }] }
    await expect(store.list('chat')).rejects.toThrow('无效')
    expect(write).toHaveBeenCalledTimes(1)
  })
})
