import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const protocol = readFileSync(join(process.cwd(), 'src/services/browser/protocol.ts'), 'utf8')

describe('protocol locator', () => {
  it('不再把页内脚本当成 locator', () => {
    expect(protocol).not.toMatch(/by: 'script'/)
    expect(protocol).not.toMatch(/browser_cdp_click_box/)
    expect(protocol).not.toMatch(/browser_cdp_fill_box/)
  })
})
