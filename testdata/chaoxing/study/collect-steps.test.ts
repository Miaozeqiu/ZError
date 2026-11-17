import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { COLLECT_STEPS, LOCATE_CHAPTER, LOCATE_STUDY_STEP, READ_VIDEO_TICK } from '../../../src/services/chaoxing/study/cdpScripts'

const dir = dirname(fileURLToPath(import.meta.url))

const withDom = (html: string, url?: string) => {
  const dom = new JSDOM(html, url ? { url } : undefined)
  const proto = dom.window.HTMLElement.prototype as HTMLElement & {
    getBoundingClientRect: () => DOMRect
  }
  proto.getBoundingClientRect = () => ({
    x: 10,
    y: 10,
    left: 10,
    top: 10,
    width: 40,
    height: 20,
    right: 50,
    bottom: 30,
    toJSON() { return {} },
  })
  return dom
}

const collectOf = (dom: JSDOM) => (
  new Function('document', `${COLLECT_STEPS}; return collectSteps(document);`)(dom.window.document) as Array<{
    label: string
    video: boolean
    quiz: boolean
    active: boolean
  }>
)

const collectAllOf = (dom: JSDOM) => (
  new Function('window', 'document', `${COLLECT_STEPS}; return collectAllSteps();`)(
    dom.window,
    dom.window.document,
  ) as Array<{
    label: string
    video: boolean
    quiz: boolean
    active: boolean
  }>
)

describe('study collectSteps', () => {
  it('tabtags 里的多个视频不会把标题栏也算进去', () => {
    const html = readFileSync(resolve(dir, 'player-tabs.html'), 'utf8')
    const steps = collectOf(withDom(html))
    expect(steps.filter((item) => item.video)).toHaveLength(2)
    expect(steps.filter((item) => item.quiz)).toHaveLength(1)
    expect(steps.filter((item) => item.active && item.video)).toHaveLength(1)
    expect(steps[0]?.active).toBe(true)
    expect(steps[1]?.active).toBe(false)
  })

  it('prev_ul 页签按顺序认两个视频', () => {
    const steps = collectOf(withDom(`<div class="prev_ul">
      <p class="prev_title currents">视频</p>
      <p class="prev_title">视频</p>
    </div>`))
    expect(steps.map((item) => item.video)).toEqual([true, true])
    expect(steps[0]?.active).toBe(true)
    expect(steps[1]?.active).toBe(false)
  })

  it('切到第二个视频时清掉已钉住的第一个播放器', () => {
    const html = readFileSync(resolve(dir, 'player-tabs.html'), 'utf8')
    const dom = withDom(html)
    const fake = dom.window.document.createElement('video')
    fake.src = 'first.mp4'
    dom.window.__zePinnedVideo = fake
    if (dom.window.top) dom.window.top.__zePinnedVideo = fake
    const hit = new Function('document', 'window', `return ${LOCATE_STUDY_STEP({ videoIndex: 2, label: '视频' })};`)(dom.window.document, dom.window) as {
      found?: boolean
      videoIndex?: number
    }
    expect(hit.found).toBe(true)
    expect(hit.videoIndex).toBe(2)
    expect(dom.window.__zePinnedVideo == null).toBe(true)
  })

  it('指定 videoIndex=2 时点第二个视频页签，不是当前「视频」', () => {
    const html = readFileSync(resolve(dir, 'player-tabs.html'), 'utf8')
    const dom = withDom(html)
    const hit = new Function('document', 'window', `return ${LOCATE_STUDY_STEP({ videoIndex: 2, label: '视频' })};`)(dom.window.document, dom.window) as {
      found?: boolean
      already?: boolean
      videoIndex?: number
    }
    expect(hit.already).toBeFalsy()
    expect(hit.found).toBe(true)
    expect(hit.videoIndex).toBe(2)
  })

  it('长页视频点播放器中心，不点左上角任务点图标', () => {
    const html = `<div>
      <div class="ans-attach-ct videoContainer">
        <div class="ans-job-icon ans-job-video" title="任务点已完成"></div>
        <iframe src="https://mooc1.chaoxing.com/ananas/modules/video/index.html?mid=a"></iframe>
      </div>
      <div class="ans-attach-ct videoContainer">
        <div class="ans-job-icon ans-job-video" title="任务点已完成"></div>
        <iframe src="https://mooc1.chaoxing.com/ananas/modules/video/index.html?mid=b"></iframe>
      </div>
      <div class="ans-attach-ct videoContainer">
        <div class="ans-job-icon ans-job-video" title="任务点未完成"></div>
        <iframe src="https://mooc1.chaoxing.com/ananas/modules/video/index.html?mid=c"></iframe>
      </div>
    </div>`
    const dom = new JSDOM(html)
    const boxes = [...dom.window.document.querySelectorAll('.ans-attach-ct')]
    boxes.forEach((box, i) => {
      const top = 30 + i * 400
      const icon = box.querySelector('.ans-job-icon') as HTMLElement
      const iframe = box.querySelector('iframe') as HTMLIFrameElement
      Object.assign(box, {})
      ;(box as HTMLElement).getBoundingClientRect = () => ({
        x: 20, y: top, left: 20, top, width: 480, height: 360, right: 500, bottom: top + 360, toJSON() { return {} },
      })
      icon.getBoundingClientRect = () => ({
        x: 24, y: top + 8, left: 24, top: top + 8, width: 18, height: 18, right: 42, bottom: top + 26, toJSON() { return {} },
      })
      iframe.getBoundingClientRect = () => ({
        x: 20, y: top + 80, left: 20, top: top + 80, width: 480, height: 270, right: 500, bottom: top + 350, toJSON() { return {} },
      })
    })
    const hit = new Function('document', 'window', `return ${LOCATE_STUDY_STEP({ videoIndex: 3 })};`)(dom.window.document, dom.window) as {
      found?: boolean
      x?: number
      y?: number
      videoIndex?: number
    }
    const iframe3 = boxes[2].querySelector('iframe') as HTMLIFrameElement
    const r = iframe3.getBoundingClientRect()
    expect(hit.found).toBe(true)
    expect(hit.videoIndex).toBe(3)
    expect(hit.x).toBe(r.left + r.width / 2)
    expect(hit.y).toBe(r.top + r.height / 2)
    expect(hit.y).not.toBe(boxes[2].querySelector('.ans-job-icon')!.getBoundingClientRect().top + 9)
  })

  it('附件图标包在 catalog_title 里也要认已完成，不能整页判未完成', () => {
    const steps = collectOf(withDom(`<div class="catalog_title">
      <div class="prev_ul">
        <p class="prev_title currents">视频1</p>
        <p class="prev_title">测验</p>
      </div>
      <div class="ans-attach-ct videoContainer ans-job-finished">
        <div class="ans-job-icon ans-job-video" title="任务点已完成"></div>
        <iframe src="https://mooc1.chaoxing.com/ananas/modules/video/index.html?mid=a"></iframe>
      </div>
    </div>`)) as Array<{ label: string; video: boolean; jobDone?: boolean }>
    expect(steps.find((item) => item.video)?.jobDone).toBe(true)
  })

  it('目录树上的未完成图标不能把本节已完成视频打成未完成', () => {
    const steps = collectOf(withDom(`<div>
      <div id="coursetree">
        <div class="posCatalog_select">
          <div class="ans-job-icon ans-job-video" title="任务点未完成"></div>
          <span class="posCatalog_name">1.4 无穷大与无穷小</span>
        </div>
      </div>
      <div class="prev_ul">
        <p class="prev_title currents">视频1</p>
        <p class="prev_title">测验</p>
      </div>
      <div class="ans-attach-ct videoContainer ans-job-finished">
        <div class="ans-job-icon ans-job-video" title="任务点已完成"></div>
        <iframe src="https://mooc1.chaoxing.com/ananas/modules/video/index.html?mid=a"></iframe>
      </div>
    </div>`)) as Array<{ label: string; video: boolean; jobDone?: boolean }>
    expect(steps.find((item) => item.video)?.jobDone).toBe(true)
  })

  it('attachment 只认 modules/video，不把 insertbbs 当视频', () => {
    const steps = collectOf(withDom(`<div>
      <div class="ans-attach-ct videoContainer"><iframe src="https://mooc1.chaoxing.com/ananas/modules/video/index.html"></iframe></div>
      <div class="ans-attach-ct"><iframe src="https://mooc1.chaoxing.com/ananas/modules/insertbbs/index.html"></iframe></div>
      <div class="ans-attach-ct videoContainer"><iframe src="https://mooc1.chaoxing.com/ananas/modules/video/index.html"></iframe></div>
    </div>`))
    expect(steps.filter((item) => item.video)).toHaveLength(2)
    expect(steps.some((item) => item.label.includes('bbs') || /讨论/.test(item.label))).toBe(false)
  })

  it('进度 tick 复用页内 helpers，不再整包注入', () => {
    const src = READ_VIDEO_TICK()
    expect(src).toContain('__zeStudyReady')
    expect(src).toContain('__zeStudyReady) === 7')
    expect(src).toContain('__zeFindVideo')
    expect(src).toContain('zeFindVideo()')
  })

  it('宿主 studyControlApi 露出 collectSteps / locate', async () => {
    const { studyControlApi } = await import('../../../src/services/chaoxing/host/studyHost')
    const api = studyControlApi()
    expect(typeof api.collectSteps).toBe('function')
    expect(typeof api.locate).toBe('function')
    const steps = api.collectSteps(withDom(`<div class="prev_ul">
      <p class="prev_title currents">视频1</p>
      <p class="prev_title">测验</p>
    </div>`).window.document)
    expect(steps.map((item) => item.label)).toEqual(['视频1', '测验'])
  })

  it('安装 helpers 后 mid 槽位仍是字符串，取值函数另挂', () => {
    const dom = withDom(`<video src="https://example.com/a.mp4"></video>`)
    const proto = dom.window.HTMLVideoElement.prototype as HTMLVideoElement
    proto.getBoundingClientRect = () => ({
      x: 10, y: 10, left: 10, top: 10, width: 320, height: 180, right: 330, bottom: 190, toJSON() { return {} },
    })
    const out = new Function('window', 'document', `${COLLECT_STEPS}
      return {
        midType: typeof window.__zePinnedMid,
        mid: zePinnedMid(),
        getType: typeof window.__zeGetPinnedMid,
        found: Boolean(zeFindVideo() && zeFindVideo().v),
      };
    `)(dom.window, dom.window.document) as {
      midType: string
      mid: string
      getType: string
      found: boolean
    }
    expect(out.midType).not.toBe('function')
    expect(out.mid).toBe('')
    expect(out.getType).toBe('function')
    expect(out.found).toBe(true)
  })

  it('穿透外层 iframe 点到框内按钮', () => {
    const dom = withDom(`<iframe id="iframe"></iframe>`, 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=11')
    const frame = dom.window.document.querySelector('iframe') as HTMLIFrameElement
    frame.getBoundingClientRect = () => ({
      x: 0, y: 100, left: 0, top: 100, width: 800, height: 500, right: 800, bottom: 600, toJSON() { return {} },
    })
    const inner = frame.contentDocument!
    inner.body.innerHTML = '<button class="vjs-big-play-button">play</button>'
    const btn = inner.querySelector('button') as HTMLButtonElement
    btn.getBoundingClientRect = () => ({
      x: 200, y: 80, left: 200, top: 80, width: 80, height: 80, right: 280, bottom: 160, toJSON() { return {} },
    })
    let clicked = 0
    btn.addEventListener('click', () => { clicked += 1 })
    dom.window.document.elementFromPoint = () => frame
    inner.elementFromPoint = () => btn
    const hit = new Function('window', 'document', `${COLLECT_STEPS}; return zePierceClick(240, 200);`)(
      dom.window,
      dom.window.document,
    ) as { ok?: boolean; via?: string; depth?: number }
    expect(hit.ok).toBe(true)
    expect(hit.via).toBe('pierce')
    expect(clicked).toBeGreaterThan(0)
  })

  it('有 iframe 且 URL 带 chapterId 时仍返回顶层页签', () => {
    const dom = withDom(`<div class="prev_ul">
      <p class="prev_title currents">视频1</p>
      <p class="prev_title">视频2</p>
    </div>
    <iframe src="https://mooc1.chaoxing.com/knowledge/cards?knowledgeid=99"></iframe>`, 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=11')
    const steps = collectAllOf(dom)
    expect(steps.map((item) => item.label)).toEqual(['视频1', '视频2'])
  })

  it('子框对不上 chapterId 时仍能点第二个视频页签', () => {
    const dom = withDom(`<div class="prev_ul">
      <p class="prev_title currents">视频1</p>
      <p class="prev_title">视频2</p>
    </div>
    <iframe src="https://mooc1.chaoxing.com/knowledge/cards?knowledgeid=99"></iframe>`, 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=11')
    const hit = new Function('document', 'window', `return ${LOCATE_STUDY_STEP({ videoIndex: 2, label: '视频2' })};`)(
      dom.window.document,
      dom.window,
    ) as { found?: boolean; already?: boolean; videoIndex?: number; error?: string }
    expect(hit.error).toBeUndefined()
    expect(hit.already).toBeFalsy()
    expect(hit.found).toBe(true)
    expect(hit.videoIndex).toBe(2)
  })

  it('点目录复用页内 helpers，只再打 locate', () => {
    const src = LOCATE_CHAPTER('1.5 极限的四则运算法则', '1065429963')
    expect(src).toContain('__zeStudyReady')
    expect(src).toContain('__zeStudyReady) === 7')
    expect(src).toContain('locate(')
    expect(src).toContain('__cxFindChapterEl')
  })
})
