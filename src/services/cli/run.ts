import { newRun, type RunCheckpoint } from '../agent/core/run'

/** 连续的 CLI 显式调用属于同一条工作流；只恢复中断或失败的任务，
 * 避免在每次成功读取后重启恢复流程，使后续点击所需的观察失效。 */
export function cliRunCheckpoint(id: string, previous?: RunCheckpoint): RunCheckpoint {
  if (previous?.status === 'completed') return { ...JSON.parse(JSON.stringify(previous)), id, status: 'preparing', updatedAt: Date.now() }
  return newRun(id, Date.now(), previous)
}
