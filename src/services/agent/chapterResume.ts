import { takeToolImages } from '../model/toolImages'
import { studentChapterUrl } from '../chaoxing/host/chapterTasks'
import type { RunTextModelOptions } from '../model/runner'
import { validateToolCall } from './core/tools'
import type { AgentChatMessage } from './chatTypes'

const object = (value: string | undefined) => {
  try { return JSON.parse(value || '{}') || {} } catch { return {} }
}

export function chapterResumePlan(input: {
  command: string; previous?: AgentChatMessage; current?: AgentChatMessage; browserId: string; url: string
}) {
  const { command, previous, current, browserId } = input
  const chapter = studentChapterUrl(input.url)
  if (!/^(?:请)?(?:继续|接着播放|继续播放|恢复播放)(?:吧|一下)?[\s。！!]*$/.test(command)
    || !chapter || !previous?.run || current?.run?.recoveredFrom !== previous.run.id || previous.run.browserId !== browserId) return

  const prior = previous.steps.map(step => ({ step, result: object(step.result) }))
  const watched = [...prior].reverse().find(({ step, result }) =>
    ['browser_watch', 'browser_start_chapter_tasks', 'browser_complete_chapter'].includes(step.name)
    && result.watching === true && (!result.chapterKey || result.chapterKey === chapter.key)
    && /^[a-z\d_-]{1,100}$/i.test(String(result.videoMid || result.video?.mid || '')))
  if (!watched) return
  const mid = String(watched.result.videoMid || watched.result.video?.mid)
  const unresolved = current.run.operations.filter(op => op.state === 'uncertain' || op.state === 'pending')
  const priorWatchIndex = prior.indexOf(watched)
  const verified = unresolved.filter(op => {
    if (op.browserId !== browserId || previous.run?.operations.find(saved => saved.id === op.id)?.state !== 'dispatched') return false
    if (op.tool === watched.step.name && /_chapter/.test(op.tool)) {
      return op.at >= watched.step.startedAt && op.at <= (watched.step.finishedAt ?? previous.run.updatedAt)
    }
    if (op.tool !== 'browser_click') return false
    const receipts = prior.slice(0, priorWatchIndex).filter(({ step, result }) => step.name === 'browser_click'
      && step.status === 'done' && result.ok === true && step.startedAt <= op.at && (step.finishedAt ?? 0) >= op.at)
    if (receipts.length !== 1) return false
    const ref = object(receipts[0].step.arguments).ref
    if (!/^e\d+$/.test(ref || '')) return false
    const before = prior.slice(0, prior.indexOf(receipts[0])).reverse().find(({ result }) => typeof result.snapshot === 'string')
    return Boolean(before?.result.snapshot.split('\n').some((line: string) =>
      line.includes(`[ref=${ref}]`) && /\bbutton "(?:播放视频|播放|继续播放)"/.test(line)))
  })
  return { chapterKey: chapter.key, mid, operationIds: verified.length === unresolved.length ? verified.map(op => op.id) : null }
}

export function createHostToolRunner(
  options: Pick<RunTextModelOptions, 'tools' | 'executeTool' | 'onEvent' | 'onTurnTranscript'>,
  turnId: string,
) {
  let sequence = 0
  return async (name: string, args: Record<string, unknown>) => {
    const call = { id: `${turnId}-host-${++sequence}`, name, arguments: JSON.stringify(args) }
    const invalid = validateToolCall(options.tools || [], call)
    if (invalid) return { ok: false, error: invalid }
    if (!options.executeTool) return { ok: false, error: '当前没有可执行的工具。' }
    options.onEvent?.({ type: 'tool_start', ...call })
    const result = await options.executeTool(call)
    const { text } = takeToolImages(result)
    options.onEvent?.({ type: 'tool_end', id: call.id, name, result: text })
    options.onTurnTranscript?.([
      { role: 'assistant', content: '', tool_calls: [{ id: call.id, type: 'function', function: { name, arguments: call.arguments } }] },
      { role: 'tool', tool_call_id: call.id, name, content: text },
    ])
    return object(result)
  }
}

export async function runChapterResume(
  plan: NonNullable<ReturnType<typeof chapterResumePlan>>,
  run: ReturnType<typeof createHostToolRunner>,
) {
  const args = { chapter_key: plan.chapterKey, video_mid: plan.mid }
  const observed = await run('browser_review_chapter', args)
  if (observed.ok !== true || observed.chapterKey !== plan.chapterKey || observed.videoMid !== plan.mid) {
    return '【宿主续播核对】当前页面的原视频尚未核对到，请按原任务继续检查。'
  }
  if (!plan.operationIds) return '【宿主续播核对】已读取原视频和当前章节。存在需要核对的旧操作，请按宿主检查点处理。'
  for (const operation_id of plan.operationIds) {
    const checked = await run('browser_verify_operation', {
      operation_id, observation_id: observed.observation_id, outcome: 'completed',
      evidence: '先前的播放回执已确认视频开始，当前网页已重新核对同一小节和原视频。',
    })
    if (checked.ok !== true) return '【宿主续播核对】旧操作回执仍需核对。'
  }
  if (observed.chapterComplete || observed.videoJobDone) return '【宿主续播核对】原视频任务已有平台完成回执，检查原任务剩余部分。'
  const result = await run('browser_complete_chapter', { ...args, video_only: true })
  return `【宿主续播结果】${[result.title, result.status, result.hint || result.error].filter(Boolean).join(' · ').slice(0, 750)}`
}
