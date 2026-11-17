const ORDER_HINT = '结果含数字键对象：JavaScript 会按整数键排序，键顺序不代表页面顺序。需要按页面顺序操作时，请重新返回有序数组，每项同时包含页面显示序号、原文及对应元素 ID/ref；不要从 ID 大小推断序号。'

// Advisory only: never sort or rewrite the browser's result. Bound traversal
// because an arbitrary page can return large, deeply nested objects.
export const resultOrderHint = (result: unknown): string | undefined => {
  const pending: { value: unknown; depth: number }[] = [{ value: result, depth: 0 }]
  const seen = new WeakSet<object>()
  let remaining = 256
  while (pending.length && remaining-- > 0) {
    const { value, depth } = pending.pop()!
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    const keys = Object.keys(value)
    if (!Array.isArray(value)) {
      let integerKeys = 0
      for (const key of keys) {
        const index = Number(key)
        // ECMAScript array-index property names are enumerated numerically.
        if (Number.isInteger(index) && index >= 0 && index < 0xffff_ffff && String(index) === key && ++integerKeys === 2) return ORDER_HINT
      }
    }
    if (depth < 6) for (const key of keys.slice(0, Math.max(0, remaining - pending.length))) {
      pending.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 })
    }
  }
  return undefined
}
