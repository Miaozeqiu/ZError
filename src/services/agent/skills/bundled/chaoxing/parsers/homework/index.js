// files: frames.js, parse.js, inspect.js, live.js, capture.js, answer.js
// 学习通作业解析器。导出键给运行时调用，改行为去对应分组文件。
// 题号一律 1-based。page() 按引用自动注入 helpers；工厂用 bindings 收参。
function (page) {
  return {
    clickTab: page(clickTab),
    inspect: page(inspect),
    snaps: page(snaps),
    live: page(live),
    fillState: page(fillState),
    liveHook: page(liveHook),
    dirty: page(dirty),
    fill: page(fill),
    submit: page(submit),
    capture: page(capture),
    picked: function (index) {
      return page(pickedPage, { at: Math.max(0, Number(index) - 1) });
    },
    pickInFrames: function (index, letter) {
      return page(pickInFramesPage, {
        index: Math.max(1, Number(index) || 1),
        letter: String(letter || ''),
      });
    },
    stash: page(stash),
    imgMeta: page(imgMeta),
    imgChunk: page(imgChunk),
    startImg: function (index) {
      return page(startImgPage, { index: Number(index) || 0 });
    },
    debugBox: function (index) {
      return page(debugBoxPage, { at: Math.max(0, Number(index) - 1) });
    },
  }
}
