/** 暂时关掉子 Agent。改回 true 即恢复 browser_task。 */
export const SUBAGENTS_ENABLED = false

export const SUBAGENT_DISABLED_HINT =
  '当前会话自己看快照，用 ref 点。点中后把步骤写进本站 SKILL.md。'

export const withoutSubagentTools = <T extends { function?: { name?: string } }>(tools: T[]) => (
  SUBAGENTS_ENABLED ? tools : tools.filter((tool) => tool.function?.name !== 'browser_task')
)
