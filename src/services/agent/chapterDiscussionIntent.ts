const completion = /(?:完成|做完|学完|刷完|刷一下|刷下|做一下|做下|处理).{0,22}(?:讨论|章节|小节|本节|本章|整门课|全部课程)|(?:章节|小节|本节|本章|讨论|整门课|全部课程).{0,18}(?:做完|学完|刷完|完成)|刷课/
const posting = /(?:回复|回答)(?:下|一下)?[^，。！？；]{0,12}(?:讨论|话题)|(?:讨论|话题)[^，。！？；]{0,12}(?:回复|回帖|跟帖|发帖)(?:下|一下|吧)|(?:帮我|请|直接|去|要)(?:在[^，。！？；]{1,20})?(?:回帖|跟帖|发帖|回复一下)|(?:发(?:布|送)?).{0,8}(?:回帖|回复|评论)|^\s*(?:回帖|发帖|跟帖)(?:[吧。！!\s]|$)/

export function permitsChapterDiscussionReply(goal: string) {
  const active = goal.replace(/《[^》]*》|「[^」]*」|“[^”]*”/g, '')
  if (/(?:只读|只查看|只看|仅查看|仅阅读|草拟|草稿|起草)|(?:不要|不必|无需|不用|禁止|不能|别|跳过|暂不|不)(?:再|去|自动|进行|做|回复|发帖|处理|完成|参加|发送|提交|发布){0,3}\s*(?:讨论|回帖|跟帖|回复|发帖|发送|提交|发布)/.test(active)) return false
  if (posting.test(active)) return true
  if (/^(?:(?:我想|请|帮我|给我|先|你)\s*)*(?:查看|看看|看下|读|核对|复核|检查|确认|列出|打开|进入)/.test(active.trim())) return false
  if (/(?:只|仅)(?:要|需|播放|完成|处理|做|读|要求|当前|本节|章节|的){0,6}\s*(?:视频|音频|课件|测验|作业|看题)|(?:完成|做完|处理)(?:下|一下)?[^，。！？；]{0,18}(?:章节测验|章节测试)/.test(active)) return false
  return completion.test(active)
}

export function isDiscussionReplyGoal(goal: string) {
  const active = goal.replace(/《[^》]*》|「[^」]*」|“[^”]*”/g, '')
  if (!permitsChapterDiscussionReply(goal) || !/讨论|话题|回帖|跟帖|发帖/.test(active)) return false
  return !completion.test(active.replace(/(?:章节|小节|本节|本章)(?:里|中的?|里的?|的)?(?:讨论|话题)|讨论任务点|讨论/g, '话题'))
    && !/视频|音频|课件|测验|作业/.test(active)
}
