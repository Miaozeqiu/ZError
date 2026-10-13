export const READ_AGENT_SKILL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read_agent_skill',
    description: '读取已启用 Skill 的 SKILL.md。返回正文和 files 列表。先读这个，再按 hint 去读附属文件。',
    parameters: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id' },
      },
      required: ['skill_id'],
    },
  },
}

export const READ_AGENT_SKILL_FILE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read_agent_skill_file',
    description: '读取 Skill 某个文件的原文（包括 SKILL.md）。path 为相对路径，例如 sites/zjooc.cn/SKILL.md。',
    parameters: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id' },
        path: { type: 'string', description: '相对路径，例如 SKILL.md、sites/zjooc.cn/SKILL.md、references/format.md' },
      },
      required: ['skill_id', 'path'],
    },
  },
}

export const LIST_AGENT_SKILLS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_agent_skills',
    description: '列出全部 Skill（含未启用）及每个 Skill 的文件列表。不知道读哪份时先调用。',
    parameters: { type: 'object', properties: {} },
  },
}

export const WRITE_AGENT_SKILL_FILE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'write_agent_skill_file',
    description: '写入 Skill 文件并保存。path 可以是已有文件或新建文本文件。content 必须是该文件完整正文。站点步骤写 SKILL.md，导航配方写 course.json。图谱用 browser_site_graph 一条条保存。',
    parameters: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id' },
        path: { type: 'string', description: '相对路径' },
        content: { type: 'string', description: '完整文件内容' },
      },
      required: ['skill_id', 'path', 'content'],
    },
  },
}

export const RESET_AGENT_SKILL_FILE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'reset_agent_skill_file',
    description: '把内置 Skill 的某个文件恢复为默认。path 省略或 SKILL.md 时恢复该 Skill 的主文档。',
    parameters: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: '内置 Skill id' },
        path: { type: 'string', description: '相对路径，默认 SKILL.md' },
      },
      required: ['skill_id'],
    },
  },
}
