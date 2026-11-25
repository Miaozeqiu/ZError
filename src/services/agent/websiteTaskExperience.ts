import { installWebsiteExperience, WebsiteExperienceNotFoundError } from './websiteRepository'

/** 主动打开网站后准备官方能力；安装失败不改写已经成功的导航结果。 */
export async function prepareWebsiteTaskExperience(url: string, signal: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) return undefined
  try {
    const installed = await installWebsiteExperience(url, signal)
    signal.throwIfAborted()
    return {
      status: 'ready' as const,
      host: installed.host,
      revision: installed.revision,
      tools: installed.tools,
      hint: '本站操作经验已就绪。先读取 site-learn 的 sites/' + installed.host + '/SKILL.md，再按经验加载并使用本站工具；不要重新摸索已提供的登录等流程。',
    }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof WebsiteExperienceNotFoundError) return { status: 'unavailable' as const }
    return { status: 'error' as const, error: error instanceof Error ? error.message : String(error),
      hint: '网站已打开，但操作经验未就绪。说明安装错误；可用 install_website_repository 重试，不要把未安装说成没有经验。' }
  }
}
