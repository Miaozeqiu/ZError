const aliases: Record<string, string> = {
  browser_read_agent_skill: 'read_agent_skill',
  browser_read_agent_skill_file: 'read_agent_skill_file',
  browser_write_agent_skill_file: 'write_agent_skill_file',
  browser_list_agent_skills: 'list_agent_skills',
  browser_reset_agent_skill_file: 'reset_agent_skill_file',
}

export const canonicalSkillToolName = (name: string) => aliases[name] || name
