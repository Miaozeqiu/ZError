import { invoke } from '@tauri-apps/api/core'
import { authToken, authUser, openLoginDialog } from '../../app/auth'
import { RemoteApiError } from '../../app/remoteHttp'
import { modelConfigManager } from '../../model/config'
import { runTextModel } from '../../model/runner'
import { fetchSubjects, identity, officialAnswer, paperBankRead, plan, reviewedAnswer, serverAnswer, type Question } from '../../platform/zjooc/paperBank'
import type { HomeworkProgressUpdate, HomeworkQuestionProgress } from '../homeworkProgress'
import { runWebsiteWorkflow } from '../websiteScripts'
import { isHomeworkQuestionRange } from '../homeworkQuestionRange'
import { websitePaperRules } from '../../browser/websitePaper'

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
  type Paper = Awaited<ReturnType<ReturnType<typeof paperBankRead>['read']>>
  type Status = HomeworkQuestionProgress['status']
  let batch: { paper: Paper; page: ReturnType<typeof paperBankRead>; checkPage: () => Promise<void> } | undefined
  let sessionUser = authUser.value?.id
  let sessionToken = authToken.value
  let remote: Awaited<ReturnType<typeof fetchSubjects>> | undefined
  let serverUnavailable = false
  let resolved: { answer: string[]; source: string } | undefined
  const tried = new Set<string>()
  const ensureSession = () => {
    signal.throwIfAborted()
    if (!sessionToken || authToken.value !== sessionToken) throw new Error('题库账号已变化。')
  }
  const progress = (q: Question, status: Status): HomeworkQuestionProgress => {
    const paper = batch!.paper
    return {
      question_id: paper.key + '/' + (paper.single ? q.number : q.index + 1),
      number: q.number, order: paper.single ? q.number : q.index + 1, stem: q.stem, type: q.type,
      options: q.options, actual: q.type === 'completion' ? { blanks: q.actual } : { choices: q.actual }, status,
    }
  }
  const publish = (phase: HomeworkProgressUpdate['phase'], questions: HomeworkQuestionProgress[]) => {
    const paper = batch!.paper
    ctx.onHomeworkProgress?.({ assignmentId: paper.key, title: paper.title, total: Math.max(paper.total, paper.declared), phase, questions })
  }
  const record = (q: Question, status: Status, source?: string) => {
    results.push({ number: q.number, status, source })
    publish('result', [progress(q, status)])
    tried.clear()
    resolved = undefined
  }
  const done = (paper: Paper) => ({
    ok: true, assignment_id: paper.key, questions: results, serverUnavailable,
    nextOffset: offset + 5 < paper.scopeTotal ? offset + 5 : undefined, singlePage: paper.single, hasNextPage: paper.hasNext, submitted: false,
  })
  try {
    const completion = await runWebsiteWorkflow('zjooc.cn', 'zjooc', 'homework', {}, async (raw, interpret) => {
      await ctx.wait(0)
      signal.throwIfAborted()
      const command = raw as Record<string, unknown> | null
      if (command?.op === 'read' && !batch) {
        const rules = websitePaperRules(interpret({ operation: 'paper_rules' }))
        const page = paperBankRead(browserId, rules)
        const paper = await page.read(offset, 5, range)
        if (range && (paper.ambiguous || (!paper.single && paper.scopeTotal !== range.end - range.start + 1))) {
          throw new Error('指定范围内有重复或缺失的显示题号，请核对当前试卷。')
        }
        if (paper.stage !== rules.exerciseStage || !paper.total || !paper.questions.length) throw new Error('请打开有可见题目的作答页。')
        if (args.assignment_id !== undefined && paper.key !== args.assignment_id) throw new Error('当前试卷已经切换。')
        const checkPage = async () => {
          const live = await page.read(offset, 5, range)
          signal.throwIfAborted()
          if (live.stage !== paper.stage || live.url !== paper.url || live.key !== paper.key
            || JSON.stringify(live.questions.map(identity)) !== JSON.stringify(paper.questions.map(identity))) {
            throw new Error('试卷已切换。')
          }
        }
        if (!authToken.value) {
          if (!await login(signal)) throw new Error('已取消题库登录，本次作答已停止。')
          await checkPage()
        }
        batch = { paper, page, checkPage }
        sessionUser = authUser.value?.id
        sessionToken = authToken.value
        publish('read', paper.questions.map(q => progress(q, !q.supported ? 'needs_review'
          : !q.actual.some(Boolean) ? 'unanswered' : q.actual.every(Boolean) ? 'answered' : 'partial')))
        return { questions: paper.questions.map(q => ({ index: q.index, supported: q.supported, answered: q.actual.some(s => s.trim()) })) }
      }
      if (!batch) throw new Error('请先读取当前作答批次。')
      const { paper, page, checkPage } = batch
      const q = paper.questions[results.length]
      if (!q || command?.index !== q.index) throw new Error('请求的题号与授权作答批次不一致。')
      const answered = q.actual.some(s => s.trim())
      ensureSession()
      if (command.op === 'record') {
        const status = !q.supported ? 'needs_review' : answered ? 'existing_answer' : 'needs_review'
        if (command.status !== status || resolved) throw new Error('试题记录状态无效。')
        record(q, status)
        return { ok: true }
      }
      if (!q.supported || answered) throw new Error('当前题目需要人工处理，或已有作答。')
      if (command.op === 'lookup') {
        const source = command.source
        if (typeof source !== 'string' || tried.has(source) || resolved) throw new Error('题库查询请求无效。')
        tried.add(source)
        let answer: string[] | undefined
        switch (source) {
          case 'review':
            answer = officialAnswer(q) ?? reviewedAnswer(paper, q)
            break
          case 'server':
            if (remote === undefined) {
              try { remote = await fetchSubjects(paper, signal) } catch (error) {
                if (error instanceof RemoteApiError && (error.status === 401 || (error.status === 400 && /token/i.test(error.message)))) {
                  if (!await login(signal)) throw new Error('题库登录已失效，本次作答已停止。')
                  if (sessionUser && sessionUser !== authUser.value?.id) throw new Error('题库账号已切换，请重新开始作答。')
                  await checkPage()
                  sessionToken = authToken.value
                  remote = await fetchSubjects(paper, signal)
                } else if (error instanceof RemoteApiError && error.status === 403) {
                  throw new Error('当前账号没有访问这份服务器题库的权限。')
                } else { signal.throwIfAborted(); remote = []; serverUnavailable = true }
              }
            }
            answer = serverAnswer(q, remote)
            break
          case 'local_bank': {
            const [hits = []] = await invoke<{ answer: string }[][]>('lookup_homework_bank_answers', {
              questions: [{ title: q.stem, type: q.type, options: q.options.map(o => o.label + '. ' + o.text).join('\n') || null }],
            }).catch(() => [[]])
            const candidates = hits.map(hit => plan(q, hit.answer.split('###')))
            if (candidates[0] && candidates.every(value => JSON.stringify(value) === JSON.stringify(candidates[0]))) answer = candidates[0]
            break
          }
          case 'model':
            try { answer = await modelAnswer(q, signal) } catch { signal.throwIfAborted() }
            break
          default:
            throw new Error('网站请求了未授权的题库来源。')
        }
        if (answer) resolved = { answer, source }
        return { found: Boolean(resolved) }
      }
      if (command.op !== 'fill' || !resolved) throw new Error('当前题目缺少经过核对的答案。')
      const action = await page.pageOp({ write: true, index: q.index, url: paper.url, key: paper.key,
        identity: identity(q), before: q.actual, answers: resolved.answer })
      if (!action?.written) return { ok: false, error: action?.error || '未能确认写入目标。' }
      await ctx.wait(0)
      const observed = await page.read(q.index, 1)
      const actual = observed.questions[0]
      if (observed.key !== paper.key || observed.url !== paper.url || observed.stage !== paper.stage || !actual
        || identity(actual) !== identity(q) || JSON.stringify(actual.actual) !== JSON.stringify(resolved.answer)) {
        record(q, 'unverified', resolved.source)
        return { ok: false, error: '写入后未能核对答案，请检查当前题目。' }
      }
      record(actual, 'filled', resolved.source)
      return { ok: true }
    })
    const status = completion as { done?: unknown; error?: unknown } | null
    if (status?.done !== true || !batch || results.length !== batch.paper.questions.length) {
      return fail(typeof status?.error === 'string' ? status.error.slice(0, 300) : '网站答题流程未完成。')
    }
    return JSON.stringify(done(batch.paper))
  } catch (error) {
    signal.throwIfAborted()
    if (String(error).includes('BROWSER_USER_CONTROL')) throw error
    return fail(error instanceof Error ? error.message : '请核对当前试卷、题库登录状态和网络连接。')
  }
}
