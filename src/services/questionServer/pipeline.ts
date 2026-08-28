import { callModelAPI } from './answerCall'
import { handleSameQuestionCheckRequest } from './sameQuestion'
import { handleUrlQuestionRequest } from './urlQuestion'

export { getRequestReasoningForBackend, callSingleModelAPI, callModelAPI } from './answerCall'
export {
  buildSameQuestionCheckPrompt,
  parseSameQuestionCheckResult,
  handleSameQuestionCheckRequest,
} from './sameQuestion'
export {
  currentUrlWindowId,
  handleUrlQuestionRequest,
  getExistingQuestions,
  saveQuestionsToStorage,
  checkAndShowUrlDialog,
  analyzeUrlQuestion,
} from './urlQuestion'

export const inflightModelCallKeys = new Set<string>()

export const modelCallPhase = (query: string) => {
  if (query.startsWith('__URL_QUESTION__:')) return 'url'
  if (query.startsWith('__SAME_QUESTION_CHECK__:')) return 'same'
  return 'answer'
}

/** SSE / Tauri 双通道入口 */
export const dispatchModelCallRequest = (requestId: string, query: string) => {
  if (!requestId || typeof query !== 'string') return
  const phase = modelCallPhase(query)
  const key = `${requestId}:${phase}`
  console.log('模型调用请求数据:', { requestId, phase, query: query.slice(0, 120) })

  if (inflightModelCallKeys.has(key)) {
    console.warn('忽略重复的模型调用请求:', key)
    return
  }
  inflightModelCallKeys.add(key)

  const done = () => { inflightModelCallKeys.delete(key) }

  if (phase === 'url') {
    void handleUrlQuestionRequest(requestId, query.slice('__URL_QUESTION__:'.length)).finally(done)
    return
  }

  if (phase === 'same') {
    void handleSameQuestionCheckRequest(requestId, query.slice('__SAME_QUESTION_CHECK__:'.length)).finally(done)
    return
  }

  void callModelAPI(requestId, query).finally(done)
}
