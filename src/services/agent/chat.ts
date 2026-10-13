/** 对话对外入口。状态 chatStore、压缩/评估 chatStudy、发送 chatLoop、拉起 chatStarters。 */
export type {
  AgentChatAttachment,
  AgentChatMessage,
  AgentChatSession,
  AgentContextSummary,
  AgentContextUsage,
  AgentQuizAttempt,
  AgentStudyEvalNote,
  AgentSubagentJob,
  AgentSubagentKind,
} from './chatTypes'
export {
  encodeFolderToken,
  expandFolderTokens,
  extractFolderAttachments,
  isFileAttachment,
  isFolderAttachment,
  isImageAttachment,
  parseFolderTokens,
  parseMessageParts,
} from './folderTokens'
export type { AgentMessagePart } from './folderTokens'
export { formatQuizAttempt, hydrateQuizCards } from './quizTools'
export {
  AGENT_CONTEXT_COMPACT_AT,
  AGENT_CONTEXT_LIMIT,
  estimateAgentContext,
} from './context'

export {
  activeChat,
  activeChatId,
  addComposerAttachment,
  addComposerImage,
  attachFileToChat,
  browserChatSessions,
  chatListCollapsed,
  chatSessions,
  clearBrowserChat,
  composerAttachments,
  consumeComposerAttachments,
  createChat,
  ensureBrowserChat,
  isChatBusy,
  recordQuizAttempt,
  removeChat,
  removeComposerAttachment,
  runningChatCount,
  selectChat,
  setChatListCollapsed,
  setChatStudySubject,
  stopBrowserAgent,
  stopChat,
} from './chatStore'

export {
  contextCompacting,
  maybeCompactContext,
  studyEvalRunning,
} from './chatStudy'

export { sendChatMessage } from './chatLoop'
export {
  startFileImportChat,
  startFolderOrganizeChat,
  startStudyGraphChat,
  startStudySubjectChat,
} from './chatStarters'
