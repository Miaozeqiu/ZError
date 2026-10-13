/** 页面刷新闹钟：目录轮询、作业后台、课程壳共用。视频进度不走这里。 */

export const PARSER_CLOCK_MS = 8_000
export const PARSER_KICK_SOON_MS = 700

export type ParserClockReason = 'interval' | 'action'

export type ParserClockRunner = (browserId: string, reason: ParserClockReason) => Promise<void> | void

type Slot = {
  id: string
  runners: Map<string, ParserClockRunner>
  intervalMs: number
  timer: ReturnType<typeof setInterval> | 0
  soon: ReturnType<typeof setTimeout> | 0
  busy: boolean
  pending: ParserClockReason | null
  tail: Promise<void>
}

const slots = new Map<string, Slot>()

const preferReason = (prev: ParserClockReason | null, next: ParserClockReason): ParserClockReason => (
  prev === 'action' || next === 'action' ? 'action' : 'interval'
)

const runSlot = (slot: Slot, reason: ParserClockReason): Promise<void> => {
  slot.busy = true
  let current: ParserClockReason | null = reason
  const done = (async () => {
    try {
      while (current) {
        const why = current
        slot.pending = null
        for (const run of slot.runners.values()) {
          try {
            await run(slot.id, why)
          } catch {
            // 一只 runner 失败不挡其它，也不丢 pending
          }
        }
        current = slot.pending
      }
    } finally {
      slot.busy = false
    }
  })()
  slot.tail = done
  return done
}

const enqueue = (slot: Slot, reason: ParserClockReason): Promise<void> => {
  if (slot.busy) {
    slot.pending = preferReason(slot.pending, reason)
    return slot.tail
  }
  return runSlot(slot, reason)
}

const clearSoon = (slot: Slot) => {
  if (slot.soon) clearTimeout(slot.soon)
  slot.soon = 0
}

const clearTimer = (slot: Slot) => {
  if (slot.timer) clearInterval(slot.timer)
  slot.timer = 0
}

const armTimer = (slot: Slot) => {
  clearTimer(slot)
  if (!slot.runners.size || slot.intervalMs <= 0) return
  slot.timer = setInterval(() => {
    if (!slot.runners.size) return
    void enqueue(slot, 'interval')
  }, slot.intervalMs)
}

const slotOf = (browserId: string): Slot | null => {
  const id = String(browserId || '').trim()
  return id ? slots.get(id) || null : null
}

const ensureSlot = (browserId: string): Slot | null => {
  const id = String(browserId || '').trim()
  if (!id) return null
  const existing = slots.get(id)
  if (existing) return existing
  const slot: Slot = {
    id,
    runners: new Map(),
    intervalMs: PARSER_CLOCK_MS,
    timer: 0,
    soon: 0,
    busy: false,
    pending: null,
    tail: Promise.resolve(),
  }
  slots.set(id, slot)
  return slot
}

const dropIfEmpty = (slot: Slot) => {
  if (slot.runners.size) return
  clearSoon(slot)
  clearTimer(slot)
  slots.delete(slot.id)
}

/** 登记一只结构解析。同一 name 再登记会换函数，不叠闹钟。 */
export const watchParserClock = (
  browserId: string,
  name: string,
  run: ParserClockRunner,
  opts?: { intervalMs?: number },
) => {
  const key = String(name || '').trim()
  const slot = ensureSlot(browserId)
  if (!slot || !key) return
  slot.runners.set(key, run)
  const interval = Number(opts?.intervalMs)
  const nextMs = Number.isFinite(interval) && interval > 0
    ? (slot.runners.size === 1 ? interval : Math.min(slot.intervalMs, interval))
    : slot.intervalMs
  if (nextMs !== slot.intervalMs || !slot.timer) {
    slot.intervalMs = nextMs
    armTimer(slot)
  }
}

export const unwatchParserClock = (browserId: string, name?: string) => {
  const slot = slotOf(browserId)
  if (!slot) return
  const key = String(name || '').trim()
  if (key) slot.runners.delete(key)
  else slot.runners.clear()
  dropIfEmpty(slot)
}

/** 动作触发。busy 时只记一笔，当前这轮结束再跑一次。 */
export const kickParserClock = (browserId: string): Promise<void> => {
  const slot = slotOf(browserId)
  if (!slot || !slot.runners.size) return Promise.resolve()
  clearSoon(slot)
  return enqueue(slot, 'action')
}

/** 帧/导航成串到来时用：尾沿合并后再 kick。 */
export const kickParserClockSoon = (browserId: string, ms = PARSER_KICK_SOON_MS) => {
  const slot = slotOf(browserId)
  if (!slot || !slot.runners.size) return
  clearSoon(slot)
  const wait = Math.max(0, Number(ms) || PARSER_KICK_SOON_MS)
  slot.soon = setTimeout(() => {
    slot.soon = 0
    void enqueue(slot, 'action')
  }, wait)
}

export const parserClockWatching = (browserId: string, name?: string) => {
  const slot = slotOf(browserId)
  if (!slot) return false
  const key = String(name || '').trim()
  return key ? slot.runners.has(key) : slot.runners.size > 0
}

export const parserClockBusy = (browserId: string) => Boolean(slotOf(browserId)?.busy)

export const resetParserClocks = () => {
  for (const slot of slots.values()) {
    clearSoon(slot)
    clearTimer(slot)
  }
  slots.clear()
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resetParserClocks()
  })
}
