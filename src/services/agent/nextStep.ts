/** 浏览器工具共用的「下一步」一句。 */

export type NextStepKind =
  | 'rows'
  | 'control.play'
  | 'repeat'
  | 'invoke-miss'
  | 'empty-card'

export const nextStep = (kind: NextStepKind, extra: { tool?: string; count?: number; label?: string } = {}) => {
  if (kind === 'control.play') {
    const tool = extra.tool || 'browser_click'
    const count = extra.count || 2
    return `${tool} 点播放已经失败 ${count} 次。下一步：用刚返回的快照 ref 再点一次播放。播起来之后 browser_watch。指定的那条没点中不能改播当前条。`
  }
  if (kind === 'repeat') {
    const tool = extra.tool || 'browser_click'
    const count = extra.count || 2
    return `${tool} 用同一参数已经失败 ${count} 次。下一步：用刚返回的快照 ref 再点一次。指定的那条没点中不能改播当前条。`
  }
  if (kind === 'invoke-miss' || kind === 'empty-card' || kind === 'rows') {
    return '看快照，用 ref 或 click_text 再点一次。点中后把这一步写进站点 SKILL.md。'
  }
  return '用快照 ref 再点一次。点中后写入站点 SKILL.md。'
}

export const missingNeedsNote = (needs: string[]) => {
  if (!needs.length) return ''
  return `本站需要 ${needs.join('、')}，宿主暂不支持，用 browser_watch / wait 降级。`
}
