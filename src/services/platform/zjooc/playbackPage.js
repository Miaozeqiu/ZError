// Runs in the top document. All actions are limited to the observed resource tab.
(function (op, expected) {
  const path = location.pathname.match(/^\/(?:u(?:ser)?center\/student\/)?course\/study\/([^/]+)\/plan\/detail\/([^/]+)(?:\/[^/]+)?\/?$/)
  if (location.origin !== 'https://www.zjooc.cn' || !path) return { error: '请先进入在浙学目标小节的课件播放页。' }
  const visible = el => el && el.getClientRects().length > 0 && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden'
  const root = document.querySelector('.plan-detailvideo')
  if (!root) return { loading: true }
  if ([...document.querySelectorAll('[role="dialog"], .el-message-box__wrapper, .el-dialog__wrapper')].some(visible)) {
    return { error: '播放页有待处理的弹窗，请先核对页面。' }
  }
  const tabs = [...root.querySelectorAll('.el-tabs__header [role="tab"]')]
  const tabKey = tab => tab.getAttribute('aria-controls') || ''
  const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('is-active'))
  if (!selected || !tabKey(selected) || tabs.some(tab => !tabKey(tab))) return { loading: true }
  const active = tabKey(selected)
  const course = path[1]
  const keys = tabs.map(tabKey)
  if (new Set(keys).size !== keys.length) return { error: '小节页签身份重复，请重新打开目标小节。' }
  const videos = tabs.filter(tab => tab.querySelector('.icon-shipin')).map(tab => ({
    id: tabKey(tab), title: tab.textContent.trim().slice(0, 160),
    complete: !!tab.querySelector('.icon-shipin.complete'), locked: tab.getAttribute('aria-disabled') === 'true' || tab.classList.contains('is-disabled'),
  }))
  if (op === 'list') return { course, keys, active, videos, url: location.origin + location.pathname }
  if (course !== expected.course || keys.length !== expected.keys.length || !keys.every((k,i) => k === expected.keys[i])) {
    return { error: '当前课程或小节已变化。' }
  }
  const target = videos.find(v => v.id === expected.id)
  if (!target || target.locked) return { error: '目标视频已移除或不可播放。' }
  if (op === 'select') {
    if (active !== expected.from) return { error: '当前页签已变化。' }
    if (active !== target.id) tabs.find(tab => tabKey(tab) === target.id).click()
    return { selected: true }
  }
  if (active !== target.id || active !== 'pane-' + path[2]) return { loading: true }
  const pane = document.getElementById(active)
  if (!pane || !root.contains(pane) || !visible(pane)) return { loading: true }
  const container = pane.querySelector('.contain-video')
  if (!container) return { loading: true }
  const media = [...container.querySelectorAll('video')].filter(visible)
  for (const frame of container.querySelectorAll('iframe')) {
    if (visible(frame) && frame.contentDocument) media.push(...[...frame.contentDocument.querySelectorAll('video')].filter(visible))
  }
  if (media.length > 1) return { error: '该页签有多个可见播放器，需要核对目标视频。' }
  const video = media[0]
  if (!video) {
    const frames = [...container.querySelectorAll('iframe')].filter(visible)
    if (frames.length === 1 && !frames[0].contentDocument && /^https:\/\//.test(frames[0].src)) {
      return { frameUrl: frames[0].src, framePath: String([...document.querySelectorAll('iframe,frame')].indexOf(frames[0])) }
    }
    return { loading: true }
  }
  if (video.error) return { error: '视频加载出错，请核对播放器提示。' }
  if (op === 'play' && video.paused && !video.ended) {
    delete video.dataset.zerrorPlayDenied
    video.play().catch(error => { if (error.name === 'NotAllowedError') video.dataset.zerrorPlayDenied = 'true' })
  }
  const clickSelector = video.paused && video.dataset.zerrorPlayDenied === 'true' && video.ownerDocument === document
    ? '#' + CSS.escape(active) + ' .contain-video video' : undefined
  return { hasVideo: true, clickSelector, current: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0,
    paused: video.paused, ended: video.ended, src: video.currentSrc || video.src }
})
