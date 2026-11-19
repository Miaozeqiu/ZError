export const chapterRules = {
  directory: {
    target: 'a[title="章节"][data-url*="/mycourse/studentcourse"]',
    row: '.chapter_item[id^="cur"] > .catalog_title[role="link"]',
    name: '.catalog_name', number: '.catalog_sbar', task: '.catalog_task',
    hiddenCount: '.knowledgeJobCount', badge: '.catalog_points_yi', completed: '.icon_yiwanc',
  },
  sidebar: {
    target: '#coursetree .posCatalog_select[id^="cur"]:not(.firstLayer)',
    row: '.posCatalog_select[id^="cur"]', active: '.posCatalog_active',
    name: '.posCatalog_name', number: '.posCatalog_sbar', task: '',
    hiddenCount: '.jobUnfinishCount', badge: '.orangeNew', completed: '.icon_Completed',
  },
  completionLabel: '已完成',
  cards: 'iframe[info="card"], iframe#iframe',
  cardTarget: 'knowledge/cards',
  tabs: '#prev_tab .prev_ul > li[cardid]',
  activeTab: '.active',
  disabledTab: '.disabled, [aria-disabled="true"]',
  tabPrefix: 'dct',
  body: '#pageDiv.ans-cc, .ans-cc',
  jobIcon: '.ans-job-icon',
  jobContainer: '.ans-attach-ct',
  jobDoneIcon: '.ans-job-icon-finish, .ans-job-icon-finished, .ans-job-done',
  jobDoneBox: '.ans-job-finished',
  player: {
    box: '.video-js', media: '.video-js video, .video-js audio',
    controls: ['.vjs-play-control.vjs-paused', '.vjs-paused .vjs-big-play-button'],
  },
  jobDoneLabel: '任务点已完成',
} as const

export const jobKinds = [
    ['video', '/(?:insertvideo|insertaudio|modules/(?:video|audio))\\b'],
    ['quiz', '/(?:insertwork|inserthomework|work|modules/(?:work|quiz))\\b'],
    ['discussion', '/ananas/modules/insertbbs/'],
    ['document', '/(?:insertdoc|insertbook|readsvr/book/mooc|modules/(?:pdf|document|innerbook|book|ppt|doc|read))\\b'],
] as const
