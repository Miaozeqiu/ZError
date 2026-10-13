/** 从对话事件里数 eval、语法错，以及挂上监控之后又问了几轮。 */

const toolNames = (row) => {
  const calls = row.toolCalls || row.tool_calls || []
  return calls.map((call) => String(call?.name || call?.function?.name || '')).filter(Boolean)
}

export const createAgentMetrics = () => ({
  evalCalls: 0,
  browserCalls: 0,
  syntaxErrors: 0,
  usedCoursePlan: false,
  watchRounds: [],
  sessions: new Map(),
})

export const noteAgentRow = (metrics, row) => {
  const id = String(row.sessionId || row.session || 'session')
  const bucket = metrics.sessions.get(id) || { watching: false, watchRounds: 0 }
  if (row.kind === 'model_request') {
    if (bucket.watching) bucket.watchRounds += 1
  }
  const names = toolNames(row)
  if (row.type === 'tool_start') names.push(String(row.name || ''))
  for (const name of names) {
    if (name.startsWith('browser_')) metrics.browserCalls += 1
    if (name === 'browser_eval') metrics.evalCalls += 1
    if (name === 'browser_course_plan') metrics.usedCoursePlan = true
  }
  const blob = JSON.stringify(row.result || row.error || '')
  if (row.type === 'tool_end' && /SyntaxError/.test(blob)) metrics.syntaxErrors += 1
  if (row.kind === 'model_response' || row.type === 'tool_end') {
    if (names.includes('browser_watch') || row.name === 'browser_watch') bucket.watching = true
    if (names.includes('browser_finish') || row.name === 'browser_finish') {
      if (bucket.watching) metrics.watchRounds.push(bucket.watchRounds || 0)
      bucket.watching = false
      bucket.watchRounds = 0
    }
  }
  metrics.sessions.set(id, bucket)
}

export const finishAgentMetrics = (metrics) => {
  const watchRounds = metrics.watchRounds.slice()
  for (const bucket of metrics.sessions.values()) {
    if (bucket.watching) watchRounds.push(bucket.watchRounds || 0)
  }
  const { evalCalls, browserCalls } = metrics
  return {
    evalCalls,
    browserCalls,
    evalShare: browserCalls ? Number((evalCalls / browserCalls).toFixed(3)) : 0,
    syntaxErrors: metrics.syntaxErrors,
    usedCoursePlan: metrics.usedCoursePlan,
    watchRounds,
    maxWatchRounds: watchRounds.length ? Math.max(...watchRounds) : 0,
  }
}

export const countAgentSignals = (rows) => {
  const metrics = createAgentMetrics()
  for (const row of rows) noteAgentRow(metrics, row)
  return finishAgentMetrics(metrics)
}

export const gradeCourseRun = (signals) => {
  const problems = []
  if (signals.evalCalls > 2) problems.push('eval 超过 2 次')
  if (signals.syntaxErrors) problems.push('有 SyntaxError')
  if (!signals.usedCoursePlan) problems.push('没有 course_plan')
  if (signals.maxWatchRounds > 3) problems.push('看视频期间轮次超过 3')
  return { ok: problems.length === 0, problems }
}
