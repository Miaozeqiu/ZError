import { CHAOXING_HOMEWORK_FILL, CHAOXING_HOMEWORK_SUBMIT } from '../browserSkills/chaoxingHomework'
import { writeDebugDump } from '../agentDebugLog'
import { askFrames, asObject, evalBrowserView, waitMs } from '../browserEval'
import type { ChaoxingHomeworkInfo } from './types'
import { inspectChaoxingHomework } from './inspect'
import { applyHomeworkLiveState, readHomeworkLiveState } from './live'
import { toHomeworkCard } from './parse'
import { DEBUG_HW_BOX, READ_HW_FILL_STATE, READ_HW_PICKED } from './scripts'

const clickBrowserText = async (id: string, text: string) => {
  const { clickBrowserText: click } = await import('../appBrowser')
  return click(id, text)
}

export const fillChaoxingHomework = async (id: string, answers: unknown) => {
  const list = Array.isArray(answers) ? answers : []
  if (!list.length) return { ok: false, error: '缺少 answers', next: 'fill', hint: 'answers 只放一项：index、type、answer。' }
  const filled: string[] = []
  const missed: string[] = []
  const pickedOk = async (item: unknown) => {
    const row = item as { index?: number; answer?: string; value?: string }
    const index = Number(row?.index) || 0
    const want = String(row?.answer || row?.value || '').toUpperCase().replace(/[^A-H]/g, '')
    if (!index || !want) return false
    const state = asObject(await evalBrowserView(id, READ_HW_PICKED(index)).catch(() => null))
    const picked = String(state.picked || '')
    return want.split('').every((letter) => picked.includes(letter))
  }
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    const label = String((item as { id?: string; index?: number })?.id || (item as { index?: number })?.index || i + 1)
    const top = asObject(await evalBrowserView(id, `${CHAOXING_HOMEWORK_FILL}(${JSON.stringify([item])})`).catch(() => null))
    if (Number(top.filledCount) > 0) {
      filled.push(label)
      await waitMs(120)
      continue
    }
    // 页面可能异步更新选中态，稍等后按题号直接复核
    await waitMs(350)
    if (await pickedOk(item)) {
      filled.push(label)
      continue
    }
    await askFrames(id, 'hwfill', { answers: JSON.stringify([item]) })
    await waitMs(300)
    const via = asObject(await evalBrowserView(id, `(function(){ return window.__ZE_HW_FILLED__ || null; })()`).catch(() => null))
    if (Number(via.filled) > 0 || await pickedOk(item)) {
      filled.push(label)
    } else {
      missed.push(label)
      const debugIndex = Number((item as { index?: number })?.index) || i + 1
      const scene = await evalBrowserView(id, DEBUG_HW_BOX(debugIndex)).catch((err) => ({ error: String(err) }))
      writeDebugDump('cx-fill-debug', JSON.stringify({
        ts: new Date().toISOString(),
        item,
        topResult: top,
        scene,
      }, null, 2), 'json')
    }
    await waitMs(120)
  }
  // 只读各题已填/勾选（1 次轻量 eval），不做全量重读
  const live = await readHomeworkLiveState(id)
  const state = live || asObject(await evalBrowserView(id, READ_HW_FILL_STATE).catch(() => ({})))
  const rows = (Array.isArray(state.states) ? state.states : []) as Array<{ index?: number; selected?: string; filled?: boolean } | number>
  const normalized = rows.map((row, i) => (
    typeof row === 'number'
      ? { index: i + 1, selected: '', filled: Boolean(row) }
      : { index: Number(row.index) || i + 1, selected: String(row.selected || ''), filled: Boolean(row.filled) }
  ))
  applyHomeworkLiveState({ states: normalized })
  const filledCount = normalized.filter((item) => item.filled).length
  const leftIndexes = normalized.filter((item) => !item.filled).map((item) => item.index)
  return {
    ok: filled.length > 0,
    filled,
    missed,
    filledCount,
    questionCount: normalized.length,
    leftIndexes,
    next: leftIndexes.length ? 'fill' : 'save',
    hint: missed.length
      ? `没点上：${missed.join('、')}。再 fill 一次这道题。`
      : leftIndexes.length
        ? `已同步到网页。还剩 ${leftIndexes.length} 道没填：第 ${leftIndexes.join('、')} 题。继续答下一道并 fill。`
        : '全部填完。save 暂存，用户要交再 submit。',
  }
}

export const saveChaoxingHomework = async (id: string) => {
  const clicked = await clickBrowserText(id, '暂时保存').catch(() => null) as { ok?: boolean } | null
  await waitMs(600)
  const again = await inspectChaoxingHomework(id, { vision: false })
  return toHomeworkCard({
    ...again,
    ok: Boolean(clicked?.ok),
    hint: clicked?.ok ? '已暂时保存。用户要交再用 submit。' : '没点到暂时保存。再 save，不要 eval。',
  })
}

export const submitChaoxingHomework = async (id: string) => {
  const top = asObject(await evalBrowserView(id, CHAOXING_HOMEWORK_SUBMIT).catch(() => null))
  if (top.ok) {
    await waitMs(800)
    return toHomeworkCard({ ...top, ...(await inspectChaoxingHomework(id, { vision: false })) } as ChaoxingHomeworkInfo)
  }
  await askFrames(id, 'hwsubmit')
  await waitMs(500)
  const via = asObject(await evalBrowserView(id, `(function(){ return window.__ZE_HW_SUBMITTED__ || null; })()`).catch(() => null))
  if (via.href || via.op) {
    await waitMs(800)
    return toHomeworkCard({ ok: true, ...(await inspectChaoxingHomework(id, { vision: false })) })
  }
  const clicked = await clickBrowserText(id, '提交').catch(() => null) as { ok?: boolean } | null
  await waitMs(800)
  return toHomeworkCard({ ok: Boolean(clicked?.ok), ...(await inspectChaoxingHomework(id, { vision: false })) })
}
