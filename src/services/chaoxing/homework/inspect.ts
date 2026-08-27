import { CHAOXING_CLICK_HOMEWORK_TAB } from '../../browser/skills/chaoxingHomework'
import { writeDebugDump } from '../../agent/debugLog'
import { publishHomeworkCard } from '../../browser/abstractions'
import { askFrames, asObject, evalBrowserView, waitMs } from '../../browser/eval'
import type { ChaoxingHomeworkInfo } from './types'
import {
  applyHwImageMap,
  cardFromSnaps,
  homeworkReady,
  parseHomeworkText,
  questionImageCount,
  rebalanceHomeworkQuestion,
  toHomeworkCard,
} from './parse'
import {
  READ_HOMEWORK_LIVE,
  READ_HOMEWORK_SNAPS,
  READ_HW_IMG_CHUNK,
  READ_HW_IMG_META,
  STASH_HOMEWORK,
  START_HW_IMG,
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

const readStashedHomework = async (
  id: string,
  onPartial?: (questions: NonNullable<ChaoxingHomeworkInfo['questions']>) => void,
  options?: { harvest?: boolean },
) => {
  const stash = asObject(await evalBrowserView(id, STASH_HOMEWORK).catch(() => ({ error: 'stash failed' })))
  const total = Number(stash.questions || 0)
  const rows: NonNullable<ChaoxingHomeworkInfo['questions']> = []
  for (let i = 0; i < Math.min(total, 40); i += 1) {
    // eval 偶发超时会丢题，重试到读到为止（最多 3 次）
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const row = asObject(await evalBrowserView(id, `(function(){ return (window.__ZE_HW_CARD__ || [])[${i}] || null; })()`).catch(() => null))
      if (row.index || row.stem || row.options) {
        rows.push(row as NonNullable<ChaoxingHomeworkInfo['questions']>[number])
        break
      }
      await waitMs(150)
    }
  }
  const ready = applyHwImageMap(rows, {})
  if (ready.length) onPartial?.(ready)
  const { hydrateHomeworkImages } = await import('../homeworkImages')
  // 图片一律由本机带完整浏览器头拉取（Rust 端有磁盘缓存），页面内逐块搬运只留作兜底
  const hydrated = await hydrateHomeworkImages(ready, 40)
  const hydratedGot = hydrated.filter((item) => (item.images || []).some((src) => src.startsWith('data:'))).length
  if (options?.harvest === false || hydratedGot > 0) {
    return { stash, questions: hydrated, imageGot: hydratedGot }
  }
  const n = Number(stash.images || (await evalBrowserView(id, `(function(){ return (window.__ZE_HW_IMGELS__ || []).length; })()`).catch(() => 0)) || 0)
  const map: Record<string, string> = {}
  const harvestUntil = Date.now() + 8000
  for (let i = 0; i < Math.min(n, 48); i += 1) {
    if (Date.now() > harvestUntil) break
    await evalBrowserView(id, START_HW_IMG(i)).catch(() => null)
    let ready = false
    for (let t = 0; t < 30; t += 1) {
      const meta = asObject(await evalBrowserView(id, READ_HW_IMG_META).catch(() => ({ wait: 1 })))
      if (!meta.wait) {
        ready = true
        break
      }
      await waitMs(40)
    }
    if (!ready) continue
    let data = ''
    let key = ''
    for (let c = 0; c < 80; c += 1) {
      const part = asObject(await evalBrowserView(id, READ_HW_IMG_CHUNK).catch(() => ({ d: true, c: '' })))
      if (part.wait) {
        await waitMs(40)
        continue
      }
      key = String(part.key || key)
      data += String(part.c || '')
      if (part.d) break
    }
    if (key && (data.indexOf('data:image') === 0 || /^https?:\/\//.test(data))) map[key] = data
  }
  const harvested = await hydrateHomeworkImages(applyHwImageMap(rows, map), 40)
  return {
    stash,
    questions: harvested,
    imageGot: Object.keys(map).length,
  }
}

export const inspectChaoxingHomework = async (id: string, options?: { vision?: boolean }) => {
  await askFrames(id, 'snap')
  let snap = asObject(await evalBrowserView(id, READ_HOMEWORK_SNAPS).catch((err) => ({ error: String(err) })))
  let info = cardFromSnaps(snap)
  if (!homeworkReady(info)) {
    await waitMs(600)
    await askFrames(id, 'snap')
    snap = asObject(await evalBrowserView(id, READ_HOMEWORK_SNAPS).catch((err) => ({ error: String(err) })))
    info = cardFromSnaps(snap)
  }
  let boxedError = ''
  let imageRows = 0
  try {
    const stashed = await readStashedHomework(id, (partial) => {
      info = {
        ...info,
        page: info.page === 'other' ? 'do' : info.page,
        questions: partial.map(rebalanceHomeworkQuestion),
        questionCount: partial.length,
        filledCount: partial.filter((item) => item.filled).length,
      }
      publishHomeworkCard(toHomeworkCard(info))
    }, { harvest: options?.vision !== false })
    boxedError = stashed.stash.error ? String(stashed.stash.error) : ''
    imageRows = stashed.imageGot
    if (stashed.questions.length) {
      info = {
        ...info,
        page: info.page === 'other' ? 'do' : info.page,
        questions: stashed.questions.map(rebalanceHomeworkQuestion),
        questionCount: stashed.questions.length,
        filledCount: stashed.questions.filter((item) => item.filled).length,
      }
    }
  } catch (err) {
    boxedError = String(err)
  }
  if (!(info.questions || []).length) {
    const liveFallback = asObject(await evalBrowserView(id, READ_HOMEWORK_LIVE).catch(() => ({})))
    const parsed = parseHomeworkText(String(liveFallback.text || ''))
    if (parsed.length) {
      info = {
        ...info,
        page: 'do',
        url: String(liveFallback.url || info.url || ''),
        title: String(liveFallback.title || info.title || ''),
        questions: parsed,
        questionCount: parsed.length,
      }
    }
  }
  const questions = info.questions || []
  const needVision = options?.vision !== false
    && (info.page === 'do' || info.page === 'view')
    && questions.some((item) => (
      item.needsVision
      || Number(item.imageCount) > 0
      || (item.images || []).length > 0
      || String(item.stem || '').length < 12
      || /（图像）|\(图像\)|公式图|显示不全/.test(String(item.stem || ''))
      || (item.options || []).some((opt) => !String(opt.text || '').trim() && (opt.image || opt.images?.length))
    ))
  const { enrichHomeworkWithVision, applyHomeworkVisionCache } = await import('../homeworkVision')
  // 已转写过的题直接用缓存文字，面板无视觉刷新也能补上
  info = applyHomeworkVisionCache(info)
  if (needVision) {
    info = await enrichHomeworkWithVision(id, info)
  }
  info = {
    ...info,
    questions: (info.questions || []).map(rebalanceHomeworkQuestion),
  }
  const card = toHomeworkCard(info)
  publishHomeworkCard(card)
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
    const live = asObject(await evalBrowserView(id, READ_HOMEWORK_LIVE).catch((err) => ({ evalError: String(err) })))
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
  const onStudent = await evalBrowserView(id, `(function(){ return /\\/mycourse\\/stu/.test(location.href || ''); })()`).catch(() => false)
  if (onStudent) {
    await evalBrowserView(id, CHAOXING_CLICK_HOMEWORK_TAB).catch(() => null)
    await waitMs(800)
  }
  let info = await inspectChaoxingHomework(id)
  if (!homeworkReady(info)) {
    await clickBrowserText(id, '作业').catch(() => null)
    await waitMs(1000)
    info = await inspectChaoxingHomework(id)
  }
  return toHomeworkCard(info)
}

export const openChaoxingHomeworkItem = async (id: string, title: string) => {
  const want = String(title || '').trim()
  if (!want) return { ok: false, error: '缺少作业名' }
  let info = await inspectChaoxingHomework(id)
  if (info.page === 'course' || info.page === 'other' || !(info.works || []).length) {
    info = await openChaoxingHomeworkList(id)
  }
  const hit = (info.works || []).find((item) => titlesMatch(item.title, want) || item.title.includes(want))
  const clicked = await clickBrowserText(id, hit?.title || want).catch(() => null) as { ok?: boolean; text?: string } | null
  await waitMs(1200)
  const page = await inspectChaoxingHomework(id)
  return toHomeworkCard({
    ...page,
    ok: Boolean(clicked?.ok || (page.questions || []).length),
    title: page.title || hit?.title || want,
  })
}
