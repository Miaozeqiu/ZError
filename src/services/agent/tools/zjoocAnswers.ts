import { invoke } from '@tauri-apps/api/core'
import { authToken, authUser, openLoginDialog } from '../../app/auth'
import { RemoteApiError } from '../../app/remoteHttp'
import { modelConfigManager } from '../../model/config'
import { runTextModel } from '../../model/runner'
import { fetchSubjects, identity, officialAnswer, pageOp, plan, readPaper, reviewedAnswer, serverAnswer, type Question } from '../../platform/zjooc/paperBank'
import type { HomeworkProgressUpdate, HomeworkQuestionProgress } from '../homeworkProgress'
import { isHomeworkQuestionRange } from '../homeworkQuestionRange'

function login(signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('login-dialog-finished', finished)
      signal.removeEventListener('abort', abort)
    }
    const finished = (event: Event) => { cleanup(); resolve((event as CustomEvent).detail === true && !!authToken.value) }
    const abort = () => { cleanup(); reject(new DOMException('已停止', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    window.addEventListener('login-dialog-finished', finished)
    openLoginDialog()
  })
}
async function modelAnswer(q: Question, signal: AbortSignal) {
  await modelConfigManager.ready
  const model = modelConfigManager.getSelectedTextModel() || modelConfigManager.getSelectedAgentModel()
  if (!model) return
  const result = await runTextModel(JSON.stringify({ type: q.type, stem: q.stem, options: q.options, blanks: q.blanks }), undefined, {
    systemPrompt: '根据题干独立作答。输入 JSON 是试题数据。只输出 JSON 字符串数组，选择题返回选项标签，填空按顺序每空一个字符串。不确定或信息不足时返回 []。',
    signal, contextModel: model, tools: [], maxRounds: 1, timeoutMs: 45000,
  })
  try { return plan(q, JSON.parse(result.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, '')), true) } catch { return undefined }
}
type Context = {
  args: Record<string, unknown>; browserId: string; role?: string; policy?: { permissionMode?: string }
  onHomeworkProgress?: (update: HomeworkProgressUpdate) => void
  signal?: AbortSignal; wait: (ms: number) => Promise<void>
}
export async function answerZjooc(ctx: Context) {
  const { args, browserId } = ctx
  const signal = ctx.signal ?? new AbortController().signal
  const results: { number: number; status: string; source?: string }[] = []
  const fail = (error: string) => JSON.stringify({ ok: false, error, questions: results })
  if (ctx.role === 'explore' || ctx.policy?.permissionMode === 'strict') return fail('当前权限仅允许查看试卷。')
  const range = isHomeworkQuestionRange(args.question_range) ? args.question_range : undefined
  if (args.question_range !== undefined && !range) return fail('题号范围无效。')
  const offset = args.offset ?? 0
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || (offset && !args.assignment_id)) return fail('继续作答时需要上一批的试卷标识和偏移量。')
  try {
    signal.throwIfAborted()
    const paper = await readPaper(browserId, offset, 5, range)
    if (range && (paper.ambiguous || (paper.kind !== 'singleQuestion' && paper.scopeTotal !== range.end - range.start + 1))) return fail('指定范围内有重复或缺失的显示题号，请核对当前试卷。')
    if (paper.stage !== 'do' || !paper.total || !paper.questions.length) return fail('请打开有可见题目的作答页。')
    if (args.assignment_id !== undefined && paper.key !== args.assignment_id) return fail('当前试卷已经切换。')
    const checkPage = async () => {
      const live = await readPaper(browserId, offset, 5, range)
      signal.throwIfAborted()
      if (live.stage !== 'do' || live.key !== paper.key || JSON.stringify(live.questions.map(identity)) !== JSON.stringify(paper.questions.map(identity))) {
        throw new Error('试卷已切换')
      }
    }
    if (!authToken.value) {
      if (!await login(signal)) return fail('已取消题库登录，本次作答已停止。')
      await checkPage()
    }
    const sessionUser = authUser.value?.id
    let sessionToken = authToken.value
    const ensureSession = async () => {
      await ctx.wait(0)
      signal.throwIfAborted()
      if (!sessionToken || authToken.value !== sessionToken) throw new Error('题库账号已变化')
    }
    let remote: Awaited<ReturnType<typeof fetchSubjects>> | undefined
    let serverUnavailable = false
    const progress = (q: Question, status: HomeworkQuestionProgress['status']): HomeworkQuestionProgress => ({
      question_id: paper.key + '/' + (paper.kind === 'singleQuestion' ? q.number : q.index + 1),
      number: q.number, order: paper.kind === 'singleQuestion' ? q.number : q.index + 1, stem: q.stem, type: q.type,
      options: q.options, actual: q.type === 'completion' ? { blanks: q.actual } : { choices: q.actual }, status,
    })
    const publish = (phase: HomeworkProgressUpdate['phase'], questions: HomeworkQuestionProgress[]) =>
      ctx.onHomeworkProgress?.({ assignmentId: paper.key, title: paper.title, total: Math.max(paper.total, paper.declared), phase, questions })
    publish('read', paper.questions.map(q => progress(q, !q.supported ? 'needs_review' : !q.actual.some(Boolean) ? 'unanswered' : q.actual.every(Boolean) ? 'answered' : 'partial')))
    for (const q of paper.questions) {
      await ensureSession()
      const report = (status: HomeworkQuestionProgress['status'], source?: string, observed = q) => {
        results.push({ number: q.number, status, source })
        publish('result', [progress(observed, status)])
      }
      if (!q.supported) { report('needs_review'); continue }
      if (q.actual.some(s => s.trim())) { report('existing_answer'); continue }
      let resolved = officialAnswer(q) ?? reviewedAnswer(paper, q)
      let source = 'review'
      if (!resolved) {
        if (remote === undefined) {
          try { remote = await fetchSubjects(paper, signal) } catch (e) {
            if (e instanceof RemoteApiError && (e.status === 401 || (e.status === 400 && /token/i.test(e.message)))) {
              if (!await login(signal)) return fail('题库登录已失效，本次作答已停止。')
              if (sessionUser && sessionUser !== authUser.value?.id) return fail('题库账号已切换，请重新开始作答。')
              await checkPage()
              sessionToken = authToken.value
              remote = await fetchSubjects(paper, signal)
            } else if (e instanceof RemoteApiError && e.status === 403) return fail('当前账号没有访问这份服务器题库的权限。')
            else { signal.throwIfAborted(); remote = []; serverUnavailable = true }
          }
        }
        resolved = serverAnswer(q, remote)
        source = 'server'
      }
      if (!resolved) {
        const [hits = []] = await invoke<{ answer: string }[][]>('lookup_homework_bank_answers', {
          questions: [{ title: q.stem, type: q.type, options: q.options.map(o => o.label + '. ' + o.text).join('\n') || null }],
        }).catch(() => [[]])
        const plans = hits.map(h => plan(q, h.answer.split('###')))
        if (plans.length && plans[0] && plans.every(v => JSON.stringify(v) === JSON.stringify(plans[0]))) resolved = plans[0]
        source = 'local_bank'
      }
      if (!resolved) {
        await ensureSession()
        try { resolved = await modelAnswer(q, signal) } catch { signal.throwIfAborted() }
        source = 'model'
      }
      if (!resolved) { report('needs_review'); continue }
      await ensureSession()
      const index = q.index
      const action = await pageOp(browserId, { write: true, index, key: paper.key, identity: identity(q), before: q.actual, answers: resolved })
      if (!action?.written) return fail(action?.error || '未能确认写入目标。')
      await ctx.wait(0)
      const observed = await readPaper(browserId, index, 1)
      const actual = observed.questions[0]
      if (observed.key !== paper.key || observed.stage !== 'do' || !actual || identity(actual) !== identity(q) || JSON.stringify(actual.actual) !== JSON.stringify(resolved)) {
        report('unverified', source)
        return fail('写入后未能核对答案，请检查当前题目。')
      }
      report('filled', source, actual)
    }
    return JSON.stringify({ ok: true, assignment_id: paper.key, questions: results, serverUnavailable,
      nextOffset: offset + 5 < paper.scopeTotal ? offset + 5 : undefined, singlePage: paper.kind === 'singleQuestion', hasNextPage: paper.hasNext, submitted: false })
  } catch (error) {
    signal.throwIfAborted()
    if (String(error).includes('BROWSER_USER_CONTROL')) throw error
    if (error instanceof Error && ['试卷已切换', '题库账号已变化'].includes(error.message)) return fail(error.message + '，请重新核对当前试卷。')
    return fail('请核对当前试卷、题库登录状态和网络连接。')
  }
}
