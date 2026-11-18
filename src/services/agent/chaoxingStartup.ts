import { chaoxingUrl } from '../platform/chaoxing/studentCourses'

type Startup = { name: 'browser_login_chaoxing' | 'browser_login_zjooc' | 'browser_play_zjooc' | 'browser_answer_zjooc' | 'browser_start_chapter_tasks'; args: Record<string, string> }
const login = /^(?:(?:请|帮我|帮忙|你)\s*)*(?:登[录陆](?:一?下|一下子)?\s*(?:我的)?\s*(学习通|超星|在浙学)(?:账号)?|(学习通|超星|在浙学)\s*登[录陆](?:一?下)?)(?:吧)?$/
const course = /^(?:(?:请|帮我|帮忙|你)\s*)*(?:完成|做完|刷完|刷(?:一?下))(?:一?下)?\s*(?:学习通\s*)?(?:把\s*)?(.+?)\s*的\s*(?:(?:全部|所有)\s*)?章节(?:学习)?(?:任务)?(?:吧)?$/

export function chaoxingStartup(command: string, currentUrl: string): Startup | undefined {
  const text = command.trim().replace(/[。！!]+$/, '').trim()
  const loginSite = text.match(login)
  if (loginSite) return { name: loginSite.includes('在浙学') ? 'browser_login_zjooc' : 'browser_login_chaoxing', args: {} }
  if (/^https:\/\/www\.zjooc\.cn\/(?:u(?:ser)?center\/student\/)?course\/study\/[\w-]+\/(?:homework|exam|singleQuestion)\/do\/[\w-]+(?:[/?#]|$)/.test(currentUrl)
    && /^(?:(?:请|帮我)\s*)*(?:自动答题|开始答题|完成(?:这份|当前)(?:作业|测验))(?:吧)?$/.test(text)) {
    return { name: 'browser_answer_zjooc', args: {} }
  }
  if (/^https:\/\/www\.zjooc\.cn\/(?:u(?:ser)?center\/student\/)?course\/study\/[^/]+\/plan\/detail\//.test(currentUrl)) {
    const play = text.replace(/^(?:请|帮我|请帮我)\s*/, '').replace(/吧$/, '')
    if (/^(?:自动播放|播放)(?:当前视频|这条视频)?$/.test(play)) return { name: 'browser_play_zjooc', args: {} }
    if (/^(?:自动播放|连续播放|连播|播完)(?:本小节|当前小节|这一节|本节)(?:的?(?:未完成|全部|所有)?视频)?$/.test(play)) {
      return { name: 'browser_play_zjooc', args: { mode: 'section' } }
    }
  }
  if (/在浙学/.test(text)) return
  if (!/学习通|超星/.test(text) && !chaoxingUrl(currentUrl)) return
  const name = text.match(course)?.[1]?.trim().replace(/^《([^》]+)》$|^「([^」]+)」$/, '$1$2')
  if (!name || name.length > 80 || /[，,。！？?！：:；;\n]|^(?:这个|那个|这门课|当前|今天|昨天|指定|前\d|第.+章)|(?:的章节|的作业|登录|讲解|不要|只要)/.test(name)) return
  return { name: 'browser_start_chapter_tasks', args: { course_name: name } }
}
