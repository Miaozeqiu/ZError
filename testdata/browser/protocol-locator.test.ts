import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const protocol = readFileSync(join(process.cwd(), 'src/services/browser/protocol.ts'), 'utf8')
const homeworkAct = readFileSync(join(process.cwd(), 'src/services/chaoxing/homework/act.ts'), 'utf8')
const selectors = readFileSync(join(process.cwd(), 'src/services/chaoxing/host/selectors.ts'), 'utf8')

describe('protocol locator', () => {
  it('不再把页内脚本当成 locator', () => {
    expect(protocol).not.toMatch(/by: 'script'/)
    expect(protocol).not.toMatch(/browser_cdp_click_box/)
    expect(protocol).not.toMatch(/browser_cdp_fill_box/)
    expect(homeworkAct).not.toMatch(/by: 'script'/)
    expect(homeworkAct).not.toMatch(/evaluate\(/)
    expect(selectors).not.toMatch(/by: 'script'/)
    expect(selectors).not.toMatch(/evaluate\(/)
  })
})
