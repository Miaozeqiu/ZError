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
    description: '读取 Skill 文件原文。本站经验使用 skill_id=site-learn、path=sites/<主网站域名>/SKILL.md；首次创建返回 exists=false，不是失败。读取总说明不等于读取本站文件，更新前本轮必须读取本站文件。',
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
    description: '写入 Skill 文件并保存完整正文。本站经验统一使用 skill_id=site-learn、path=sites/<主网站域名>/SKILL.md；必须先读这个文件，exists=false 时可首次创建，存在时保留原文合并增量。以结果的 id/path 为准，ok=true 且非 unchanged 才算实际更新。图谱用 browser_site_graph 保存。',
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
