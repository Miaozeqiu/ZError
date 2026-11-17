import type { LocateQuery } from '../../browser/protocol'

const PLAY_CSS = '.vjs-big-play-button, button.vjs-big-play-button, .vjs-play-control.vjs-paused, .vjs-poster, video'
const PAUSE_CSS = '.vjs-play-control.vjs-playing, button.vjs-playing'
const PLAYER_FRAME = 'ananas/modules/video'
const WORK_FRAMES = ['doHomeWork', 'mooc-ans', 'work/do']
const BLANK_CSS = 'input[type="text"], input.blank, input.blankInput, textarea'

const css = (value: string, extra: Partial<LocateQuery> = {}): LocateQuery => ({ by: 'css', value, ...extra })
const text = (value: string, exact = false, extra: Partial<LocateQuery> = {}): LocateQuery => (
  { by: 'text', value, ...(exact ? { exact: true } : {}), ...extra }
)

/** 每个作业框一条，再加一条不限框。 */
const fan = (query: LocateQuery): LocateQuery[] => [
  ...WORK_FRAMES.map((frame) => ({ ...query, frame })),
  { ...query },
]

const bareTitle = (title: string) => title.replace(/^\d+(?:\.\d+)*\s*/, '').replace(/"/g, '').trim() || title.replace(/"/g, '')

export const locatorsForHomeworkOption = (index: number, letter: string): LocateQuery[] => {
  const nth = Math.max(1, Number(index) || 1)
  const mark = String(letter || '').toUpperCase().replace(/[^A-H]/g, '').slice(0, 1)
  if (!mark) return []
  return [
    ...fan(css(`[data="${mark}"]`, { nth })),
    ...fan(css(`[data="${mark}"]`)),
    ...fan(text(mark, true, { nth })),
  ]
}

export const locatorsForHomeworkBlank = (index: number, slot = 0): LocateQuery[] => {
  const at = Math.max(1, Number(index) || 1)
  const blank = Math.max(0, Number(slot) || 0)
  const first = at + blank
  const second = blank + 1
  const out: LocateQuery[] = []
  if (first >= 1) out.push(...fan(css(BLANK_CSS, { nth: first })))
  if (second >= 1) out.push(...fan(css(BLANK_CSS, { nth: second })))
  return out
}

export const locatorsForHomeworkControl = (name: string): LocateQuery[] => {
  if (name === 'save') {
    return [
      text('暂时保存', true),
      css('a.btnSave, #tempsave, a[onclick*="noSubmit"]'),
      ...fan(text('暂时保存', true)),
    ]
  }
  if (name === 'submit') {
    return [
      text('提交', true),
      css('a.btnSubmit, #submitBtn, a[onclick*="btnBlueSubmit"], input[value="提交"]'),
      text('交卷', true),
    ]
  }
  if (name === 'confirm') {
    return [
      text('确定', true),
      css('#popok, #confirmSubWin .jb_btn, #confirmSubWin .btnBlue'),
      text('确认提交', true),
    ]
  }
  if (name === 'homework-tab') {
    return [
      text('作业', true),
      css('[title="作业"], [aria-label="作业"], a[href*="pageHeader=8"]'),
    ]
  }
  return []
}

export const locatorsForStudyControl = (name: string, mid = ''): LocateQuery[] => {
  const want = String(mid || '').trim()
  if (name === 'play') {
    const out: LocateQuery[] = []
    if (want) out.push(css(PLAY_CSS, { frame: want }))
    out.push(css(PLAY_CSS, { frame: PLAYER_FRAME }))
    out.push(css(PLAY_CSS))
    if (want) out.push(css(`iframe[mid="${want}"], iframe[data-mid="${want}"]`))
    return out
  }
  if (name === 'pause') {
    const out: LocateQuery[] = []
    if (want) out.push(css(PAUSE_CSS, { frame: want }))
    out.push(css(PAUSE_CSS, { frame: PLAYER_FRAME }))
    out.push(css(PAUSE_CSS))
    return out
  }
  if (name === 'chapter-tab') {
    return [
      text('章节', true),
      css('a[data-url*="studentcourse"], [data-url*="studentcourse"]'),
    ]
  }
  if (name === 'video-tab') {
    return [
      text('视频', true),
      css('.tabtags a, .prev_title'),
    ]
  }
  if (name === 'next') {
    return [
      text('下一个任务点', true),
      text('下一任务点', true),
      text('下一个视频', true),
      text('下一节', true),
    ]
  }
  return []
}

export const locatorsForStudyStep = (want: {
  label?: string
  mid?: string
  jobid?: string
  videoIndex?: number
  index?: number
}): LocateQuery[] => {
  const mid = String(want.mid || '').trim()
  const jobid = String(want.jobid || '').trim()
  const label = String(want.label || '').trim()
  const videoIndex = Math.max(0, Number(want.videoIndex) || 0)
  const index = Math.max(0, Number(want.index) || 0)
  const out: LocateQuery[] = []
  if (mid) {
    out.push(css(`iframe[mid="${mid}"], iframe[data-mid="${mid}"]`))
    out.push(css(`.ans-attach-ct iframe[mid="${mid}"], .moduleDiv iframe[mid="${mid}"]`))
  }
  if (jobid) out.push(css(`[jobid="${jobid}"], iframe[jobid="${jobid}"]`))
  if (videoIndex >= 1) {
    out.push(css('.ans-attach-ct.videoContainer, .ans-attach-ct iframe[src*="modules/video"]', { nth: videoIndex }))
  }
  if (index >= 1) out.push(css('.tabtags a, .tabtags span, .prev_title', { nth: index }))
  if (label) {
    out.push(text(label, true))
    out.push(text(label))
  }
  return out
}

export const locatorsForChapter = (title: string, chapterId = ''): LocateQuery[] => {
  const name = String(title || '').trim()
  const id = String(chapterId || '').replace(/\D/g, '')
  const bare = name ? bareTitle(name) : ''
  const out: LocateQuery[] = []
  if (id) {
    out.push(css(`[id*="${id}"] .posCatalog_name, [data-id="${id}"] .posCatalog_name, [id*="${id}"]`))
  }
  if (name) out.push(text(name))
  if (bare) out.push(css(`#coursetree .posCatalog_name[title*="${bare}"]`))
  return out
}

export const locatorsForCaptcha = (name: 'input' | 'submit' | 'img'): LocateQuery[] => {
  if (name === 'input') return [css('#ucode, .yzmInp, input[name="ucode"]')]
  if (name === 'submit') return [css('input.submit, input[type="submit"], button[type="submit"]')]
  return [css('#ccc, .yzmImg img, img[src*="processVerify"]')]
}

export type ChaoxingHandle = {
  kind?: string
  name?: string
  index?: number
  letter?: string
  slot?: number
  mid?: string
  jobid?: string
  label?: string
  title?: string
  chapterId?: string
  videoIndex?: number
}

export const locatorsForChaoxingHandle = (handle: ChaoxingHandle): LocateQuery[] => {
  const kind = String(handle.kind || '')
  if (kind === 'option') return locatorsForHomeworkOption(Number(handle.index) || 1, String(handle.letter || ''))
  if (kind === 'blank') return locatorsForHomeworkBlank(Number(handle.index) || 1, Number(handle.slot) || 0)
  if (kind === 'control') {
    const name = String(handle.name || '')
    return [
      ...locatorsForHomeworkControl(name),
      ...locatorsForStudyControl(name, String(handle.mid || '')),
    ]
  }
  if (kind === 'step') return locatorsForStudyStep(handle)
  if (kind === 'chapter') return locatorsForChapter(String(handle.title || handle.label || ''), String(handle.chapterId || ''))
  return []
}
