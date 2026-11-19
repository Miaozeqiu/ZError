// Runs in the top document. All actions are limited to the observed resource tab.
(function (host, rules, op, expected) {
  const atHost = location.hostname === host || location.hostname.endsWith('.' + host)
  const path = location.pathname.split('/').filter(Boolean)
  const route = rules.routes.find(pattern => path.length >= pattern.length && path.length <= pattern.length + rules.optionalSegments
    && pattern.every((part, index) => part === ':group' || part === ':resource' || part === path[index]))
  if (location.protocol !== 'https:' || location.port || !atHost || !route) return { error: '请先打开目标课件的播放页面。' }
  const group = path[route.indexOf(':group')]
  const resource = path[route.indexOf(':resource')]
  const visible = el => el && el.getClientRects().length > 0 && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden'
  const root = document.querySelector(rules.root)
  if (!root) return { loading: true }
  if ([...document.querySelectorAll(rules.dialogs)].some(visible)) {
    return { error: '播放页有待处理的弹窗，请先核对页面。' }
  }
  const tabs = [...root.querySelectorAll(rules.tabs)]
  const tabKey = tab => tab.getAttribute(rules.panelAttribute) || ''
  const selected = tabs.find(tab => tab.matches(rules.active))
  if (!selected || !tabKey(selected) || tabs.some(tab => !tabKey(tab))) return { loading: true }
  const active = tabKey(selected)
  const course = group
  const keys = tabs.map(tabKey)
  if (new Set(keys).size !== keys.length) return { error: '小节页签身份重复，请重新打开目标小节。' }
  const videos = tabs.filter(tab => tab.querySelector(rules.videoTab)).map(tab => ({
    id: tabKey(tab), title: tab.textContent.trim().slice(0, 160),
    complete: !!tab.querySelector(rules.completedTab), locked: tab.matches(rules.disabled),
  }))
  if (op === 'list') return { course, origin: location.origin, keys, active, videos, url: location.origin + location.pathname }
  if (location.origin !== expected.origin || course !== expected.course || keys.length !== expected.keys.length || !keys.every((k,i) => k === expected.keys[i])) {
    return { error: '当前课程或小节已变化。' }
  }
  const target = videos.find(v => v.id === expected.id)
  if (!target || target.locked) return { error: '目标视频已移除或不可播放。' }
  if (op === 'select') {
    if (active !== expected.from) return { error: '当前页签已变化。' }
    if (active !== target.id) tabs.find(tab => tabKey(tab) === target.id).click()
    return { selected: true }
  }
  if (active !== target.id || active !== rules.panelPrefix + resource) return { loading: true }
  const pane = document.getElementById(active)
  if (!pane || !root.contains(pane) || !visible(pane)) return { loading: true }
  const container = pane.querySelector(rules.player)
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
    ? '#' + CSS.escape(active) + ' :is(' + rules.player + ') video' : undefined
  return { hasVideo: true, clickSelector, current: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0,
    paused: video.paused, ended: video.ended, src: video.currentSrc || video.src }
})
