import { setCheckedByLocator } from '../../browser/engine/act'
import { resolveRefLocator } from '../../browser/engine/refs'
import type { BrowserLocator } from '../../browser/engine/types'

type CheckItem = { ref?: string; selector?: string; nth?: number; frame?: string; checked: boolean }
export const handleCheckTool = async (browserId: string, args: Record<string, any>, beforeItem: () => Promise<void> = async () => {}) => {
  const items: CheckItem[] = args.items
  if (!Array.isArray(items) || !items.length || items.length > 40) return { ok: false, error: 'items 需要包含 1～40 个选项' }
  // 先验证整批参数及 ref，参数错误时不执行部分操作。
  const targets: Array<{ locator: BrowserLocator; checked: boolean }> = []
  for (const item of items) {
    if (!item || typeof item.checked !== 'boolean' || (!item.ref && !item.selector) || (item.nth != null && (!Number.isInteger(item.nth) || item.nth < 1))) {
      return { ok: false, error: '每项需要 ref 或 selector、checked 布尔值；nth 从 1 开始' }
    }
    const locator = item.ref ? await resolveRefLocator(browserId, String(item.ref)) : { by: 'css' as const, value: String(item.selector), nth: item.nth, frame: item.frame }
    if (!locator) return { ok: false, error: `选项 ref ${item.ref} 已失效，请重新读取页面` }
    targets.push({ locator, checked: item.checked })
  }
  const results: Array<Record<string, unknown>> = []
  for (const [index, target] of targets.entries()) {
    try {
      await beforeItem()
      const result = await setCheckedByLocator(browserId, target.locator, target.checked)
      results.push({ index: index + 1, ...result })
      if (!result.ok) return { ok: false, results, error: `第 ${index + 1} 项未确认成功，后续选项未执行；重新读取页面确认状态` }
    } catch (error) {
      results.push({ index: index + 1, ok: false, error: String(error) })
      return { ok: false, results, error: `第 ${index + 1} 项执行中断，后续选项未执行；请先确认当前状态` }
    }
  }
  return { ok: true, results, verified: 'checked_state', hint: '仅确认页面勾选状态符合请求，不代表答案正确、已保存或已提交。' }
}
