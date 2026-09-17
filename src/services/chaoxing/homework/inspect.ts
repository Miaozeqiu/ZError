import { writeDebugDump } from '../../agent/debugLog'
import { lastHomeworkCard, publishHomeworkCard } from '../../browser/abstractions'
import { asObject, clickFrameText, evalBrowserView, waitMs } from '../../browser/eval'
import { read as protocolRead } from '../../browser/protocol'
import type { ChaoxingHomeworkInfo } from './types'
import {
  cardFromHomeworkHtml,
  enrichQuestionsFromLiveText,
  homeworkReady,
  parseHomeworkText,
  questionImageCount,
  rebalanceHomeworkQuestion,
  toHomeworkCard,
} from './parse'
import { clickHomeworkBox } from './act'
import {
  LOCATE_HW_TAB,
  READ_HOMEWORK_LIVE,
} from './scripts'

const clickBrowserText = async (id: string, text: string) => {
  const { clickBrowserText: click } = await import('../../browser/appBrowser')
  return click(id, text)
}

const titlesMatch = (a: unknown, b: unknown) => {
  const left = String(a || '').replace(/[（(]\s*\d+\s*[）)]\s*$/g, '').replace(/\s+/g, ' ').trim()
  const right = String(b || '').replace(/[（(]\s*\d+\s*[）)]\s*$/g, '').replace(/\s+/g, ' ').trim()
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)))
}

const formatHomeworkLive = (
  live: Record<string, unknown>,
  card: ChaoxingHomeworkInfo,
  extra: { snapError?: unknown; imageRows?: number; evalError?: string; boxedError?: string },
) => {
  const counts = asObject(live.counts)
  const rows = (Array.isArray(live.rows) ? live.rows : []) as Array<{ i?: number; t?: string; n?: number }>
  const questions = card.questions || []
  const lines = [
    `# 作业页实时数据`,
    `ts: ${new Date().toISOString()}`,
    `url: ${live.url || card.url || ''}`,
    `title: ${live.title || card.title || ''}`,
    `asked: ${live.asked}`,
    `extras: ${live.extras}  extraQs: ${live.extraQs}`,
    `snapError: ${extra.snapError || ''}`,
    `boxedError: ${extra.boxedError || ''}`,
    `evalError: ${extra.evalError || ''}`,
    `card: page=${card.page || ''} questions=${card.questionCount || questions.length} images=${questionImageCount(questions)} imageRows=${extra.imageRows || 0}`,
    `hint: ${card.hint || ''}`,
    '',
    `## 选择器`,
    `questionLi=${counts.questionLi || 0}  singleQuesId=${counts.singleQuesId || 0}  mark_item=${counts.markItem || 0}  TiMu=${counts.TiMu || 0}  img=${counts.img || 0}`,
    '',
    `## 题框`,
    ...(rows.length
      ? rows.map((row) => `${row.i}. 图${row.n || 0}  ${(row.t || '').trim()}`)
      : ['没有 .questionLi / .singleQuesId']),
    '',
    `## 已解析题目`,
    ...questions.slice(0, 16).map((item) => (
      `${item.index}. [${item.typeName || item.type || ''}] ${(item.stem || '').slice(0, 80) || '（无题干）'}  图${item.images?.length || 0}  选项${(item.options || []).map((opt) => `${opt.letter}${opt.text || (opt.images?.length ? '图' : '')}`).join(' ')}`
    )),
    '',
    `## 正文摘要`,
    String(live.text || ''),
    '',
  ]
  return lines.join('\n')
}

const applyStashedQuestions = (
  info: ChaoxingHomeworkInfo,
  questions: NonNullable<ChaoxingHomeworkInfo['questions']>,
) => ({
  ...info,
  page: info.page === 'other' || !info.page ? 'do' : info.page,
  questions: questions.map(rebalanceHomeworkQuestion),
  questionCount: questions.length,
  filledCount: questions.filter((item) => item.filled).length,
})

const isChapterShellUrl = (url: string) =>
  /\/mycourse\/studentstudy|\/mycourse\/stu/i.test(url) && !/\/work\//i.test(url)

const readInspectDirect = async (id: string): Promise<ChaoxingHomeworkInfo | null> => {
  const dom = asObject(await protocolRead(id, 'homework').catch(() => ({})))
  const parsed = cardFromHomeworkHtml(dom)
  if (!homeworkReady(parsed)) return null
  // 章节壳上只有假列表、还没有嵌套测验题 → 当作未就绪，继续等 iframe
  if (isChapterShellUrl(String(parsed.url || dom.url || '')) && !(parsed.questions || []).length) {
    return null
  }
  return parsed
}

const readHomeworkListFast = async (id: string): Promise<ChaoxingHomeworkInfo> => {
  const direct = await readInspectDirect(id)
  if (direct) {
    const first = direct.pending?.[0]?.title || ''
    const card = toHomeworkCard({
      ...direct,
      page: direct.works?.length ? 'list' : direct.page,
      hint: first ? `直接 open「${first}」，不要再 list / get_page。` : direct.hint,
    })
    publishHomeworkCard(card)
    return card
  }
  await waitMs(350)
  const again = await readInspectDirect(id)
  const info = again || { page: 'other' as const }
  const first = info.pending?.[0]?.title || ''
  const card = toHomeworkCard({
    ...info,
    page: info.works?.length ? 'list' : info.page,
    hint: first ? `直接 open「${first}」，不要再 list / get_page。` : info.hint,
  })
  publishHomeworkCard(card)
  return card
}

export const retrySelectedHomeworkInspect = async () => {
  if (typeof window === 'undefined' || !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return null
  }
  const { currentBrowserId } = await import('../../browser/abstractions')
  const { getSelectedBrowserId } = await import('../../browser/appBrowser')
  const id = String(currentBrowserId.value || getSelectedBrowserId() || '').trim()
  if (!id) return null
  return inspectChaoxingHomework(id, { vision: false })
}

export const inspectChaoxingHomework = async (id: string, options?: { vision?: boolean; dump?: boolean }) => {
  const snap: Record<string, unknown> = {}
  let info: ChaoxingHomeworkInfo = { page: 'other' }
  let boxedError = ''
  const imageRows = 0
  try {
    const direct = await readInspectDirect(id)
    if (direct) info = { ...info, ...direct }
    if ((info.questions || []).length) {
      const { hydrateHomeworkImages } = await import('./homeworkImages')
      const hydrated = await hydrateHomeworkImages(info.questions || [], 80)
      if (hydrated.length) info = applyStashedQuestions(info, hydrated)
    }
  } catch (err) {
    boxedError = String(err)
  }
  if (!homeworkReady(info) || (!(info.questions || []).length && isChapterShellUrl(String(info.url || '')))) {
    for (const delay of [600, 1000, 1400]) {
      if ((info.questions || []).length) break
      await waitMs(delay)
      const again = await readInspectDirect(id)
      if (again) info = { ...info, ...again }
    }
  }
  if ((info.questions || []).length) {
    void import('./homeworkImages').then(async ({ hydrateHomeworkImages }) => {
      const hydrated = await hydrateHomeworkImages(info.questions || [], 40)
      if (!hydrated.length) return
      info = applyStashedQuestions(info, hydrated)
      publishHomeworkCard(toHomeworkCard(info))
    }).catch(() => undefined)
  }
  const liveEarly = asObject(await evalBrowserView(id, READ_HOMEWORK_LIVE()).catch((err) => ({ evalError: String(err) })))
  if (!(info.questions || []).length) {
    const parsed = parseHomeworkText(String(liveEarly.text || ''))
    if (parsed.length) {
      info = {
        ...info,
        page: 'do',
        url: String(liveEarly.url || info.url || ''),
        title: String(liveEarly.title || info.title || ''),
        questions: parsed,
        questionCount: parsed.length,
      }
    }
  }
  const liveRows = (Array.isArray(liveEarly.rows) ? liveEarly.rows : []) as Array<{ i?: number; t?: string }>
  if (liveRows.length && (info.questions || []).length) {
    info = {
      ...info,
      questions: enrichQuestionsFromLiveText(info.questions || [], liveRows),
    }
  }
  const questions = info.questions || []
  const { enrichHomeworkWithVision, applyHomeworkVisionCache } = await import('./homeworkVision')
  const { hasUsableVisionModel } = await import('../../model/config')
  const looksVisual = (item: NonNullable<typeof questions>[number]) => (
    Boolean(item.needsVision)
    || Number(item.imageCount) > 0
    || (item.images || []).length > 0
    || String(item.stem || '').length < 12
    || /（图像）|\(图像\)|公式图|显示不全/.test(String(item.stem || ''))
    || (item.options || []).some((opt) => !String(opt.text || '').trim() && (opt.image || opt.images?.length))
  )
  const visualIndexes = questions.filter(looksVisual).map((item) => item.index)
  const canVision = hasUsableVisionModel()
  const needVision = options?.vision !== false
    && canVision
    && (info.page === 'do' || info.page === 'view')
    && visualIndexes.length > 0
  // 已转写过的题直接用缓存文字，面板无视觉刷新也能补上
  info = applyHomeworkVisionCache(info)
  if (needVision) {
    info = await enrichHomeworkWithVision(id, info)
  } else if (!canVision && visualIndexes.length && (info.page === 'do' || info.page === 'view')) {
    info = {
      ...info,
      skippedVision: true,
      hint: `当前没有可用的视觉模型，第 ${visualIndexes.join('、')} 题是图像/公式，已跳过。只答能读到文字的题，不要猜图，不要再 inspect 等看图。`,
    }
  }
  info = {
    ...info,
    questions: (info.questions || []).map(rebalanceHomeworkQuestion),
  }
  const card = toHomeworkCard(info)
  const prev = lastHomeworkCard.value
  if (!homeworkReady(card) && prev && homeworkReady(prev)) {
    if (options?.dump !== false) {
      try {
        writeDebugDump('cx-homework-live', formatHomeworkLive(liveEarly, card, {
          snapError: snap.error,
          imageRows,
          boxedError,
          evalError: String(liveEarly.evalError || 'inspect empty, keep last card'),
        }), 'md')
      } catch {
        // ignore
      }
    }
    return prev
  }
  publishHomeworkCard(card)
  if (options?.dump === false) return card
  try {
    writeDebugDump('cx-homework-latest', JSON.stringify({
      ts: new Date().toISOString(),
      snapError: snap.error,
      asked: snap.asked,
      extras: Array.isArray(snap.extras) ? (snap.extras as unknown[]).length : 0,
      imageCount: questionImageCount(card.questions || []),
      sampleImages: (card.questions || []).slice(0, 3).map((item) => ({
        index: item.index,
        stem: item.stem,
        images: (item.images || []).map((src) => src.slice(0, 48)),
        optionImages: (item.options || []).map((opt) => (opt.images || []).map((src) => src.slice(0, 48))),
      })),
      ...card,
    }, null, 2), 'json')
    const live = Object.keys(liveEarly).length ? liveEarly : asObject(await evalBrowserView(id, READ_HOMEWORK_LIVE()).catch((err) => ({ evalError: String(err) })))
    writeDebugDump('cx-homework-live', formatHomeworkLive(live, card, {
      snapError: snap.error,
      imageRows,
      boxedError,
      evalError: String(live.evalError || ''),
    }), 'md')
  } catch {
    // ignore
  }
  return card
}

export const openChaoxingHomeworkList = async (id: string) => {
  const state = asObject(await evalBrowserView(id, `(function(){
    var href = location.href || '';
    var frames = [];
    try {
      var list = document.querySelectorAll('iframe[src]');
      for (var i = 0; i < list.length && frames.length < 6; i++) frames.push(String(list[i].src || ''));
    } catch (e) {}
    return { href: href, frames: frames };
  })()`).catch(() => ({})))
  const href = String(state.href || '')
  const frames = (Array.isArray(state.frames) ? state.frames : []).map((item) => String(item || ''))
  const alreadyList = /pageHeader=8/.test(href) || frames.some((src) => /\/work\/list|mooc2\/work/i.test(src))
  if (!alreadyList && /\/mycourse\/stu|stucoursemiddle/i.test(href)) {
    let tab = await clickHomeworkBox(id, LOCATE_HW_TAB()).catch(() => ({ ok: false }))
    if (!tab.ok) {
      await waitMs(800)
      tab = await clickBrowserText(id, '作业').catch(() => ({ ok: false })) as { ok?: boolean }
    }
    await waitMs(700)
  }
  return readHomeworkListFast(id)
}

const homeworkOpened = (info: ChaoxingHomeworkInfo | null) =>
  Boolean(info && (info.page === 'do' || info.page === 'view' || (info.questions || []).length))

export const openChaoxingHomeworkItem = async (id: string, title: string) => {
  const want = String(title || '').trim()
  if (!want) return toHomeworkCard({ ok: false, error: '缺少作业名' })
  const labels = [want, `${want} ; 未交`, `${want};未交`]
  let clicked: { ok?: boolean; text?: string } | null = null
  for (const label of labels) {
    const framed = await clickFrameText(id, label).catch(() => null)
    if (framed?.ok) {
      clicked = framed
      break
    }
    const hit = await clickBrowserText(id, label).catch(() => null) as { ok?: boolean; text?: string } | null
    if (hit?.ok) {
      clicked = hit
      break
    }
  }
  if (!clicked?.ok) {
    const list = await readHomeworkListFast(id)
    const row = (list.works || []).find((item) => titlesMatch(item.title, want) || item.title.includes(want))
    if (row?.title) {
      clicked = await clickBrowserText(id, row.title).catch(() => null) as { ok?: boolean; text?: string } | null
    }
    if (!clicked?.ok) {
      return toHomeworkCard({
        ...list,
        ok: false,
        error: `列表里点不开「${want}」。`,
        title: want,
        next: 'open',
      })
    }
  }
  await waitMs(900)
  const peek = await readHomeworkListFast(id)
  if (!homeworkOpened(peek)) {
    const names = (peek.pending || []).map((item) => item.title).filter(Boolean)
    return toHomeworkCard({
      ...peek,
      ok: false,
      error: '还在作业列表，没有打开作答页。不要 navigate / eval iframe。',
      title: peek.title || want,
      hint: names.length
        ? `列表还在。再 open，title 用未交任务点「${names[0]}」。`
        : '点了但还在列表。再 open 一次，不要 get_page。',
      next: 'open',
    })
  }
  const page = (peek.questions || []).length
    ? peek
    : await inspectChaoxingHomework(id, { vision: false, dump: false })
  return toHomeworkCard({
    ...page,
    ok: true,
    title: page.title || want,
    hint: (page.questions || []).length
      ? `已打开「${page.title || want}」，已读到 ${page.questions?.length} 道题。`
      : `已打开「${page.title || want}」。再 inspect 读题。`,
  })
}
