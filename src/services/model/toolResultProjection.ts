/** Full redacted text is archived separately; this projection always stays valid JSON. */
export const projectToolResult = (raw: unknown, max: number, reference?: string) => {
  const text = String(raw ?? '')
  if (text.length <= max) return text
  let data: any
  try { data = JSON.parse(text) } catch { /* plain text */ }
  const retained = data && typeof data === 'object' && !Array.isArray(data)
    ? Object.fromEntries(['ok', 'error', 'reason', 'denied', 'resultUncertain', 'operation_id', 'observation_id', 'pendingOperations', 'requiresRefresh', 'status', 'finished', 'summary', 'url', 'title', 'score', 'frameId', 'loaderId'].filter(key => data[key] !== undefined).map(key => [key, data[key]])) : {}
  // Error and summary strings themselves can be large. Opaque IDs are never cut.
  for (const key of ['error', 'reason', 'summary', 'url', 'title']) {
    const value = typeof retained[key] === 'object' ? JSON.stringify(retained[key]) : retained[key]
    if (typeof value === 'string') retained[key] = value.length > 800 ? value.slice(0, 800) + '…' : value
  }
  if (Array.isArray(retained.pendingOperations)) retained.pendingOperations = retained.pendingOperations.slice(-80).map((item: any) => ({ id: item?.id, tool: item?.tool, browserId: item?.browserId }))
  return JSON.stringify({ ...retained, truncated: true, originalChars: text.length,
    ...(reference ? { history_ref: reference, hint: '用 read_conversation_history 的 tool_call_id 读取完整记录；旧页面定位需重新读取快照。' } : {}),
    historyExcerpt: text.slice(0, Math.max(0, max - 512)) })
}
