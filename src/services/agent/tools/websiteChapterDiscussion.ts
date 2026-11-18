import { handleChapterDiscussion } from '../../chaoxing/host/chapterDiscussion'

type Context = {
  name: string
  args: Record<string, unknown>
  browserId: string
  role?: string
  policy?: { permissionMode?: string }
  wait: (ms: number) => Promise<void>
}

export async function handleWebsiteChapterDiscussion(ctx: Context) {
  const { browserId, args, wait } = ctx
  const sending = ctx.name === 'browser_reply_chapter_discussion'
  const fail = (error: string) => JSON.stringify({ ok: false, reason: 'invalid', error, clickDispatched: false })
  if (sending && (ctx.role === 'explore' || ctx.policy?.permissionMode === 'strict')) {
    return fail('当前权限只允许查看讨论。')
  }
  if (typeof args.chapter_key !== 'string' || !/^\d+:\d+:\d+$/.test(args.chapter_key)
    || typeof args.discussion_id !== 'string' || !/^[a-z\d_-]{1,100}$/i.test(args.discussion_id)
    || typeof args.tab !== 'number' || !Number.isSafeInteger(args.tab) || args.tab < 1) {
    return fail('请沿用章节工具返回的 chapterKey、tab 和 discussion_id。')
  }
  const reply = sending && typeof args.reply === 'string' ? args.reply.trim() : ''
  if (sending && (!reply || reply.length > 4000)) return fail('请提供 1–4000 字符的讨论回复正文。')
  const result = await handleChapterDiscussion({
    browserId, chapterKey: args.chapter_key, discussionId: args.discussion_id, tab: args.tab, wait,
    ...(sending ? { reply } : {}),
  })
  return JSON.stringify(result)
}
