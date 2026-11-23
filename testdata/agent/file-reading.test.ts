import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { clearFileCaches, inspectLocalFile, readLocalFileDocument, readLocalFileRange } from '../../src/services/agent/import'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const files = new Map<string, string[]>()
let modified = 1
beforeEach(() => {
  clearFileCaches(); files.clear(); modified = 1; vi.clearAllMocks()
  vi.mocked(invoke).mockImplementation(async (name, args: any) => {
    const lines = files.get(args.path) || []
    if (name === 'stat_local_file') return { size: 100, modified } as any
    if (name === 'read_file_text') return lines.join('\n') as any
    if (name === 'read_excel_range') return lines.slice(args.start, args.end + 1).map(item => [item, '答案']) as any
    return lines.slice(args.start, args.end + 1) as any
  })
})
describe('Agent 文件分页与完整脚本输入', () => {
  it.each(['docx', 'doc', 'xlsx'])('%s 自动续读超过初始 2000 单元，末尾不重复', async ext => {
    const path = `fixture.${ext}`
    files.set(path, Array.from({ length: 2115 }, (_, i) => `第${i}段`))
    expect(await inspectLocalFile(path)).toMatchObject({ total: 2000, truncated: true })
    const tail = await readLocalFileRange(path, 2100, 2200)
    expect(tail).toMatchObject({ start: 2100, end: 2114, hasMore: false, nextStart: null, truncated: false })
    expect(tail.content).toContain('第2114段')
    expect(await readLocalFileRange(path, 2115, 2150)).toMatchObject({ content: '', hasMore: false })
    const document = await readLocalFileDocument(path)
    expect(document.lines).toHaveLength(2115)
    expect(document.lines[2000]).toContain('第2000段')
  })
  it('超过 8000 行的文本不被静默截断', async () => {
    files.set('long.txt', Array.from({ length: 8201 }, (_, i) => `line-${i}`))
    expect(await readLocalFileDocument('long.txt')).toMatchObject({ total: 8201 })
    expect((await readLocalFileRange('long.txt', 8200, 8300)).content).toBe('line-8200')
  })
  it('超长单段按字符游标续读，完整重建原文且 JSON 始终有效', async () => {
    const source = '题干"\n选项\\🙂'.repeat(1800)
    files.set('long.docx', [source, '最后一段'])
    let start = 0, offset = 0, restored = '', count = 0
    for (;;) {
      const result = await readLocalFileRange('long.docx', start, start, offset)
      expect(JSON.parse(JSON.stringify(result))).toEqual(result)
      restored += result.content
      count++
      if (result.nextStart !== 0) break
      start = result.nextStart; offset = result.nextOffset
    }
    expect(count).toBeGreaterThan(1)
    expect(restored).toBe(source)
    expect(await readLocalFileRange('long.docx', 1, 1)).toMatchObject({ content: '最后一段', hasMore: false })
  })
  it('文件修改后刷新缓存；并发首次读取只加载一次', async () => {
    files.set('changing.docx', ['原题'])
    await Promise.all([inspectLocalFile('changing.docx'), inspectLocalFile('changing.docx')])
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'read_docx_range')).toHaveLength(1)
    modified++; files.set('changing.docx', ['新题'])
    expect((await readLocalFileDocument('changing.docx')).lines).toEqual(['新题'])
  })
  it('并发续读不重复追加；非法范围和越界字符游标明确报错', async () => {
    files.set('parallel.docx', Array.from({ length: 2115 }, (_, i) => String(i)))
    await inspectLocalFile('parallel.docx')
    await Promise.all([readLocalFileRange('parallel.docx', 2000, 2050), readLocalFileRange('parallel.docx', 2051, 2115)])
    expect((await readLocalFileDocument('parallel.docx')).lines).toHaveLength(2115)
    await expect(readLocalFileRange('parallel.docx', -1, 10)).rejects.toThrow('非负整数')
    await expect(readLocalFileRange('parallel.docx', 0, 1, 100)).rejects.toThrow('offset')
  })
  it('恰好 20000 段可完整解析，超过上限明确失败', async () => {
    files.set('limit.docx', Array.from({ length:20_000 }, () => '题'))
    expect((await readLocalFileDocument('limit.docx')).total).toBe(20_000)
    files.set('over-limit.docx', Array.from({ length:20_001 }, () => '题'))
    await expect(readLocalFileDocument('over-limit.docx')).rejects.toThrow('20000')
  })
  it('取消和超大输入不会返回部分内容冒充全文', async () => {
    files.set('large.txt', ['x'.repeat(2_000_001)])
    await expect(readLocalFileDocument('large.txt')).rejects.toThrow('200 万')
    const controller = new AbortController(); controller.abort()
    await expect(readLocalFileDocument('large.txt', controller.signal)).rejects.toThrow()
  })
})
