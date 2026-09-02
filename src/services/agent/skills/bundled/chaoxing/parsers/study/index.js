// files: frames.js, catalog.js, video.js, chapter.js, play.js, watch.js, captcha.js
// 学习通刷课解析器。导出键给运行时调用，改行为去对应分组文件。
// page() 会按引用自动注入同模块 helpers，不必再整袋传入。
function (page) {
  return {
    inspect: page(inspect),
    install: page(install),
    refresh: page(refresh),
    clickTab: page(clickTab),
    openChapter: page(openChapter),
    play: page(play),
    clickVideoTab: page(clickVideoTab),
    clickStep: page(clickStep),
    nextStep: page(nextStep),
    videoHook: page(videoHook),
    videoTick: page(videoTick),
    jobTick: page(jobTick),
    hook: page(hook),
    tick: page(tick),
    captchaCheck: page(captchaCheck),
    captchaImage: page(captchaImage),
    captchaRefresh: page(captchaRefresh),
    captchaFill: page(captchaFill),
  }
}
