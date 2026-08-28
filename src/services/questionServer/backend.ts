import { databaseService } from '../app/database'
import { normalizeAnswerJsonContent } from '../../utils/answer/answerNormalize'
import { settingsApi } from './deps'
import { isTimeoutLikeModelFailureText } from './errors'
import {
  applyLocalRequestCompletion,
  clearRequestHeartbeat,
  finalModelResponseState,
  requestLogs,
} from './runtime'
import { serverUrl } from './serverRefs'

const { settings } = settingsApi

export const getRequestOptionsFromLog = (requestId: string): string => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log?.requestBody) return ''
  try {
    const parsed = JSON.parse(log.requestBody)
    return typeof parsed.options === 'string' ? parsed.options : ''
  } catch {
    return ''
  }
}

export const sendModelResponseToBackend = async (requestId: string, content: string, isSuccess: boolean = true, reasoningContent = '') => {
  const existingState = finalModelResponseState.get(requestId)
  if (existingState === 'success') {
    console.warn('忽略重复的模型最终响应（已成功发送）:', { requestId, isSuccess })
    return
  }
  if (existingState === 'error' && !isSuccess) {
    console.warn('忽略重复的模型错误响应:', { requestId })
    return
  }

  // 去掉 A./B. 前缀，纯字母映射为选项正文，避免 OCS 收到带序号的答案
  const options = getRequestOptionsFromLog(requestId)
  const normalizedContent = isSuccess
    ? normalizeAnswerJsonContent(content, options)
    : content

  // 先停心跳，避免错误宽限期内仍被 keepalive 拖住观感
  clearRequestHeartbeat(requestId)

  try {
    const response = await fetch(`${serverUrl.value}/api/model/response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        content: normalizedContent,
        reasoning_content: reasoningContent || undefined,
        is_success: isSuccess
      })
    })


    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    finalModelResponseState.set(requestId, isSuccess ? 'success' : 'error')
    if (isSuccess && normalizedContent !== content) {
      const log = requestLogs.value.find(l => l.id === requestId)
      if (log) log.modelResponse = normalizedContent
    }

    // 请求端可能已断开导致后端来不及推 completed；本地先收口状态，避免一直「处理中」
    const provisionalStatus = isSuccess
      ? 200
      : (isTimeoutLikeModelFailureText(normalizedContent) ? 408 : 500)
    applyLocalRequestCompletion(
      requestId,
      provisionalStatus,
      JSON.stringify({ code: isSuccess ? 1 : 0, message: normalizedContent })
    )

    console.log('模型响应已发送到后端:', { requestId, content: normalizedContent, reasoningContent, isSuccess })

    // 只有在成功调用模型时才存储AI响应到数据库
    if (isSuccess) {
      // 2024-05-21: 禁用前端存储以防止重复条目。
      // 后端 (server.rs) 在从前端接收到响应后已经执行了存储操作。
      // await storeAIResponseToDatabase(requestId, content)
      console.log('前端跳过存储AI响应 (已由后端处理):', { requestId })
    } else {
      console.log('AI调用失败，跳过保存到数据库:', { requestId, content })
    }

  } catch (error) {
    console.error('发送模型响应到后端失败:', error)
    // 即便上报失败，UI 也不应一直停在处理中
    applyLocalRequestCompletion(
      requestId,
      isSuccess ? 200 : (isTimeoutLikeModelFailureText(normalizedContent) ? 408 : 500),
      normalizedContent
    )
  }
}


// 发送模型进度到后端（用于流式输出期间的活跃心跳）
export const sendModelProgressToBackend = async (requestId: string, content: string) => {
  try {
    const response = await fetch(`${serverUrl.value}/api/model/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        content: content
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
  } catch (error) {
    console.warn('发送模型进度到后端失败（忽略）:', error)
  }
}


export const storeAIResponseToDatabase = async (requestId: string, content: string) => {
  try {
    // 从请求日志中找到对应的请求，获取实际的title, options, type
    const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
    let title = 'Unknown'
    let options = ''
    let type = ''

    if (logIndex !== -1) {
      const log = requestLogs.value[logIndex]
      // 从请求体中提取参数
      if (log.requestBody) {
        try {
          const parsed = JSON.parse(log.requestBody)
          title = parsed.title || 'Unknown'
          options = parsed.options || ''
          type = parsed.type || ''
        } catch (e) {
          console.error('解析请求体失败:', e)
        }
      }
    }

    // 从AI响应中提取答案（稳健处理混合文本）
    let extractedAnswer = content
    const cleanedContent = content
      .trim()
      .replace(/^```json\s*/, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim()

    console.log('🔍 清理后的内容:', cleanedContent)

    const extractAnswerFromMixedContent = (text: string): string => {
      // 尝试直接解析为JSON
      try {
        const obj = JSON.parse(text)
        if (obj && typeof obj === 'object') {
          if (typeof obj.answer === 'string') {
            console.log('✅ 直接解析文本为JSON并提取到答案:', obj.answer)
            return obj.answer
          }
          if (typeof obj.anwser === 'string') {
            console.log('✅ 直接解析文本为JSON并提取到anwser(拼写错误):', obj.anwser)
            return obj.anwser
          }
        }
      } catch { }

      // 从末尾提取最后一个平衡的JSON对象
      const extractLastBalancedJson = (s: string): string | null => {
        let end = -1
        let depth = 0
        for (let i = s.length - 1; i >= 0; i--) {
          const ch = s[i]
          if (end === -1) {
            if (ch === '}') {
              end = i
              depth = 1
              continue
            }
          } else {
            if (ch === '}') {
              depth++
            } else if (ch === '{') {
              depth--
              if (depth === 0) {
                const candidate = s.slice(i, end + 1)
                return candidate
              }
            }
          }
        }
        return null
      }

      const jsonStr = extractLastBalancedJson(text)
      if (jsonStr) {
        console.log('🔎 发现末尾的JSON片段:', jsonStr)
        try {
          const obj = JSON.parse(jsonStr)
          if (typeof obj.answer === 'string') {
            console.log('✅ 从末尾JSON片段中提取到答案:', obj.answer)
            return obj.answer
          }
          if (typeof obj.anwser === 'string') {
            console.log('✅ 从末尾JSON片段中提取到anwser(拼写错误):', obj.anwser)
            return obj.anwser
          }
        } catch (e) {
          console.log('⚠️ 末尾JSON片段解析失败:', e)
        }
      }

      // 正则回退，直接在文本中匹配 answer 字段
      const regex = /\{\s*"(?:answer|anwser)"\s*:\s*"([^"]+)"[\s\S]*?\}/s
      const m = text.match(regex)
      if (m && m[1]) {
        console.log('✅ 通过正则从混合文本中捕获到答案:', m[1])
        return m[1]
      }

      console.log('⚠️ 未能提取到结构化答案，回退为原始内容')
      return text
    }

    extractedAnswer = extractAnswerFromMixedContent(cleanedContent).trim()

    if (!extractedAnswer) {
      console.warn('⚠️ AI最终处理结果答案为空，跳过保存题目', { requestId, title })
      return
    }

    // 尊重「AI回答添加到本地题库」设置（前端路径目前默认不调用，后端为主）
    if (!settings.autoAddToQuestionBank) {
      console.log('ℹ️ autoAddToQuestionBank=false，前端跳过入库:', { requestId, title })
      return
    }

    // 使用数据库服务存储AI响应
    await databaseService.addQuestion({
      content: title, // 使用实际的请求title
      options: options, // 使用请求中的options
      answer: extractedAnswer, // 使用解析后的答案
      question_type: type, // 使用请求中的type
      folderId: 0, // 存储到ID为0的文件夹
      isAi: 1 // 标记为AI生成的题目
    })

    console.log('✅ AI响应已成功存储到数据库:', { requestId, title, extractedAnswer, contentLength: extractedAnswer.length })

  } catch (error) {
    console.error('❌ 存储AI响应到数据库失败:', error)
  }
}

