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
    return `${tool} 点播放已经失败 ${count} 次。先读取当前视频状态和最新快照，确认失败原因；已经在播就登记 browser_watch，仍未播放则处理实际错误后再定位。不要盲目再点或改播另一条。`
  }
  if (kind === 'repeat') {
    const tool = extra.tool || 'browser_click'
    const count = extra.count || 2
    return `${tool} 用同一参数已经失败 ${count} 次。先核对错误与当前状态，使用最新成功快照重新定位；确认原因后换方法。操作可能已执行时先核对结果，不要直接再点。`
  }
  if (kind === 'invoke-miss' || kind === 'empty-card' || kind === 'rows') {
    return '先读取最新页面快照，核对目标是否存在以及当前操作状态，再按用户目标选择可用工具；没有可行路径时说明具体阻塞。'
  }
  return '先核对当前状态和最新快照，再根据用户目标决定下一步。'
}

export const missingNeedsNote = (needs: string[]) => {
  if (!needs.length) return ''
  return `本站步骤需要 ${needs.join('、')}，当前缺少对应能力。先核对可用工具，确有替代方法时再继续，否则说明具体阻塞。`
}
