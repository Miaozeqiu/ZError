import { PROTECT_CREDENTIALS_TOOL } from './credentialTools'
/** 题库 / 学习对话工具表。按域拆在同目录其它文件。 */
import {
  LIST_AGENT_SKILLS_TOOL,
  READ_AGENT_SKILL_FILE_TOOL,
  READ_AGENT_SKILL_TOOL,
  RESET_AGENT_SKILL_FILE_TOOL,
  WRITE_AGENT_SKILL_FILE_TOOL,
} from '../skillTools'
import { FOLDER_QUESTION_TOOLS } from './folderQuestionTools'
import { CAMPUS_TOOLS } from './campusTools'
import { PRACTICE_QUIZ_TOOLS } from './practiceQuizTools'
import { STUDY_GRAPH_TOOLS } from './studyGraphTools'
import { WEB_SEARCH_TOOLS } from './webSearchTools'
import { WEBSITE_ICON_TOOL } from './websiteTools'

export const CHAT_TOOLS = [
  PROTECT_CREDENTIALS_TOOL,
  WEBSITE_ICON_TOOL,
  ...FOLDER_QUESTION_TOOLS,
  ...CAMPUS_TOOLS,
  ...PRACTICE_QUIZ_TOOLS,
  ...STUDY_GRAPH_TOOLS,
  ...WEB_SEARCH_TOOLS,
  LIST_AGENT_SKILLS_TOOL,
  READ_AGENT_SKILL_TOOL,
  READ_AGENT_SKILL_FILE_TOOL,
  WRITE_AGENT_SKILL_FILE_TOOL,
  RESET_AGENT_SKILL_FILE_TOOL,
]
