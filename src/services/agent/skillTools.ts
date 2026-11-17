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
    description: '读取 Skill 文件原文与编辑范围。本站经验使用 skill_id=site-learn、path=sites/<主网站域名>/SKILL.md。使用仓库或自定义 HTTP 接口时，content 供查阅，local_experience 是本站可编辑的笔记，可能为空。应用内站点首次创建返回 exists=false。更新前本轮须读取本站文件。',
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
    description: '按读取结果的 write_scope 保存网站经验。local_experience 只写本站本地笔记，来源正文、参考文件和图谱只读。website_files 可写应用内站点的完整文件，图谱用 browser_site_graph。本站 SKILL.md 须先读取，ok=true 且非 unchanged 才算实际更新。',
    parameters: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id' },
        path: { type: 'string', description: '相对路径' },
        content: { type: 'string', description: '更新后的完整本地笔记（local_experience）或自建网站的完整文件（website_files）' },
        base_version: { type: 'string', description: 'write_scope=local_experience 时填写读取结果的 repository_version' },
      },
      required: ['skill_id', 'path', 'content'],
    },
  },
}

export const RESET_AGENT_SKILL_FILE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'reset_agent_skill_file',
    description: '把可编辑的内置 Skill 文件恢复为默认。使用仓库或自定义 HTTP 接口的网站不支持此操作。',
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
