import { getAgentPolicy } from './agentPolicy'

const campusEditTools = new Set([
  'create_campus_course',
  'rename_campus_course',
  'create_campus_paper',
  'update_campus_paper',
  'set_campus_paper_archived',
  'reorder_campus_paper_questions',
  'update_campus_question',
])

export const campusWriteDenial = (tool: string): string | undefined => {
  const policy = getAgentPolicy()
  if (tool === 'save_campus_questions' && !policy.campusUpload) {
    return '「行为与权限」中的「上传到校园题库」已关闭。'
  }
  if (campusEditTools.has(tool) && !policy.campusEdit) {
    return '「行为与权限」中的「校验并修改校园题库」已关闭。'
  }
}

export const assertCampusWriteAllowed = (tool: string) => {
  const denial = campusWriteDenial(tool)
  if (denial) throw new Error(denial)
}

export const campusPermissionPrompt = () => {
  const { campusUpload, campusEdit } = getAgentPolicy()
  return [
    '【校园题库权限】',
    campusUpload ? '上传已开启。只有用户要求上传并确认目标课程与试卷后，才能调用 save_campus_questions。'
      : '上传已关闭。不得向校园题库新增题目。',
    campusEdit ? '修改已开启。只有用户要求更正或管理时才能写入；更正答案前先核对现有题目的 campus_question_id、完整题干和选项。'
      : '修改已关闭。不得更正题目或创建、修改、归档、排序课程及试卷。允许只读查看和查重。',
    '学习通作业完成后，仅把批阅页明确公布的正确答案用于用户授权的上传或更正。提交成功、总分、作答记录和模型推测均不能代替正确答案；尚未批阅或未公开答案时说明原因，跳过这些题。选择题核对题干、选项原文及对应关系，上传前查重，已有同题时只在用户授权更正且核实有差异时修改。禁止通过浏览器、脚本或其他工具绕开校园题库权限。',
  ].join('\n')
}
