import { settingsApi } from './deps'
import { getReasoningContentValue } from './invoke'
import { sendModelProgressToBackend } from './backend'
import { checkAndShowUrlDialog, dispatchModelCallRequest } from './pipeline'
import {
  addRequestLog,
  applyRequestLogCompletePayload,
  clearAllRequestRuntimeState,
  cancelAllInFlightModelRequests,
  heartbeatIntervals,
  injectUrlQuestionIfNeeded,
  requestLogs,
  trimRequestLogs,
  updateRequestDetailsWithModelReasoning,
  updateRequestDetailsWithModelResponse,
} from './runtime'
import {
  isTauri,
  isToggling,
  serverPort,
  serverRunning,
  serverUrl,
} from './serverRefs'
import type { RequestLog } from './types'

const { get } = settingsApi

let logUpdateInterval: ReturnType<typeof setInterval> | null = null
let sseEventSource: EventSource | null = null
let unlistenModelCallRequest: (() => void) | null = null
let unlistenRequestLogComplete: (() => void) | null = null

export const checkTauriEnvironment = async () => {
  try {
    // 尝试导入 Tauri API
    const { invoke } = await import('@tauri-apps/api/core')
    // 尝试调用一个简单的命令来确认 Tauri 可用
    await invoke('greet', { name: 'test' })
    isTauri.value = true
    console.log('Tauri 环境检测成功')
  } catch (error) {
    isTauri.value = false
    console.log('Tauri 环境检测失败:', error)
  }
}

// Server management functions
export const getServerStatus = async () => {
  console.log('检查 Tauri 环境:', {
    isTauri: isTauri.value
  })

  if (!isTauri.value) {
    // Fallback for web environment
    console.log('不在 Tauri 环境中，使用默认状态')
    serverRunning.value = false
    serverUrl.value = ''
    serverPort.value = null
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const status = await invoke('get_server_status')
    serverRunning.value = (status as any).running
    serverUrl.value = (status as any).url || ''
    serverPort.value = (status as any).port
  } catch (error) {
    console.error('Failed to get server status:', error)
    // Fallback to default state if Tauri API is not available
    serverRunning.value = false
    serverUrl.value = ''
    serverPort.value = null
  }
}

export const startServer = async () => {
  if (!isTauri.value) {
    alert('此功能仅在 Tauri 应用中可用')
    return
  }

  try {
    isToggling.value = true
    const { invoke } = await import('@tauri-apps/api/core')

    // 使用设置中的网络配置，确保绑定地址根据enableLanAccess状态正确设置
    const networkConfig = get('network')
    const bindAddress = networkConfig.enableLanAccess ? '0.0.0.0' : '127.0.0.1'

    const result = await invoke('start_server', {
      port: networkConfig.serverPort,
      bindAddress: bindAddress
    })

    serverRunning.value = (result as any).running
    serverUrl.value = (result as any).url || ''

    // 服务器启动成功后，启动SSE连接接收实时日志
    if ((result as any).running) {
      startSSEConnection()
    }

    console.log('Server started successfully:', result)
  } catch (error) {
    console.error('Failed to start server:', error)
    alert('启动服务器失败: ' + error)
  } finally {
    isToggling.value = false
  }
}

export const stopServer = async () => {
  if (!isTauri.value) {
    alert('此功能仅在 Tauri 应用中可用')
    return
  }

  try {
    isToggling.value = true
    cancelAllInFlightModelRequests()
    stopSSEConnection()
    stopLogPolling()
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke('stop_server')

    serverRunning.value = (result as any).running
    serverUrl.value = (result as any).url || ''
    serverPort.value = (result as any).port

    console.log('Server stopped successfully:', result)
  } catch (error) {
    console.error('Failed to stop server:', error)
    alert('停止服务器失败: ' + error)
  } finally {
    isToggling.value = false
  }
}


export const startSSEConnection = () => {
  if (!serverRunning.value || !serverUrl.value) {
    return
  }

  // 关闭现有连接
  if (sseEventSource) {
    sseEventSource.close()
  }

  try {
    const sseUrl = serverUrl.value.replace('http://', 'http://').replace(':3000', ':3000') + '/api/logs/stream'
    console.log('连接SSE:', sseUrl)

    sseEventSource = new EventSource(sseUrl)

    // 监听所有类型的事件
    sseEventSource.onmessage = (event) => {
      console.log('收到SSE默认消息事件:', event.data)
      try {
        const logData = JSON.parse(event.data)
        console.log('解析后的日志数据:', logData)

        // 只处理 /query 路径的 GET 和 POST 请求
        if (logData.path !== '/query' || (logData.method !== 'POST' && logData.method !== 'GET')) {
          console.log('跳过非 query 请求:', logData.method, logData.path)
          return
        }

        // 处理分阶段的请求信息
        if (logData.stage === 'started') {
          // 请求开始阶段
          const newLog: RequestLog = {
            id: logData.id,
            timestamp: new Date(logData.timestamp).getTime(),
            method: logData.method,
            path: logData.path,
            status: undefined, // 开始阶段没有状态码
            ip: logData.ip || '127.0.0.1',
            userAgent: logData.user_agent || 'Unknown',
            responseTime: undefined, // 开始阶段没有响应时间
            requestBody: logData.request_body || '',
            responseBody: undefined, // 开始阶段没有响应体
            headers: logData.headers || {},
            stage: 'started'
          }

          console.log('创建的请求开始日志:', newLog)
          requestLogs.value.unshift(newLog)
          injectUrlQuestionIfNeeded(newLog)

        } else if (logData.stage === 'completed') {
          // 请求完成阶段，更新现有记录
          const existingLogIndex = requestLogs.value.findIndex(log => log.id === logData.id)

          if (existingLogIndex !== -1) {
            // 更新现有记录
            const existingLog = requestLogs.value[existingLogIndex]
            // 采用就地更新，保持对象引用，确保 selectedLog 同步
            existingLog.status = logData.status
            existingLog.responseTime = logData.response_time
            existingLog.responseBody = logData.response_body || ''
            existingLog.stage = 'completed'
            console.log('更新的请求完成日志:', existingLog)
          } else {
            // 如果没有找到开始记录，创建一个完整的记录
            const newLog: RequestLog = {
              id: logData.id,
              timestamp: new Date(logData.timestamp).getTime(),
              method: logData.method,
              path: logData.path,
              status: logData.status,
              ip: '127.0.0.1', // 完成阶段没有IP信息，使用默认值
              userAgent: 'Unknown', // 完成阶段没有User-Agent信息，使用默认值
              responseTime: logData.response_time,
              requestBody: '', // 完成阶段没有请求体信息
              responseBody: logData.response_body || '',
              headers: {}, // 完成阶段没有请求头信息
              stage: 'completed'
            }
            console.log('创建的请求完成日志（无开始记录）:', newLog)
            requestLogs.value.unshift(newLog)
          }
        }

        trimRequestLogs()

      } catch (error) {
        console.error('解析SSE日志数据失败:', error, '原始数据:', event.data)
      }
    }

    sseEventSource.addEventListener('log', (event) => {
      console.log('收到SSE日志事件:', event.data) // 添加调试日志
      try {
        const eventData = JSON.parse(event.data)
        console.log('解析后的事件数据:', eventData) // 添加调试日志

        // 检查是否是RequestLog类型的事件
        if (eventData.type === 'request_log') {
          const logData = eventData.RequestLog || eventData

          // 只处理 /query 路径的 GET 和 POST 请求
          if (logData.path !== '/query' || (logData.method !== 'POST' && logData.method !== 'GET')) {
            console.log('跳过非 query 请求:', logData.method, logData.path)
            return
          }

          // 处理分阶段的请求信息
          if (logData.stage === 'started') {
            // 请求开始阶段
            const newLog: RequestLog = {
              id: logData.id,
              timestamp: new Date(logData.timestamp).getTime(),
              method: logData.method,
              path: logData.path,
              status: undefined, // 开始阶段没有状态码
              ip: logData.ip || '127.0.0.1',
              userAgent: logData.user_agent || 'Unknown',
              responseTime: undefined, // 开始阶段没有响应时间
              requestBody: logData.request_body || '',
              responseBody: undefined, // 开始阶段没有响应体
              headers: logData.headers || {},
              stage: 'started'
            }

            console.log('创建的请求开始日志:', newLog)
            requestLogs.value.unshift(newLog)
            injectUrlQuestionIfNeeded(newLog)

          } else if (logData.stage === 'completed') {
            // 请求完成阶段，更新现有记录
            const existingLogIndex = requestLogs.value.findIndex(log => log.id === logData.id)

            if (existingLogIndex !== -1) {
              // 更新现有记录
              const existingLog = requestLogs.value[existingLogIndex]
              // 采用就地更新，保持对象引用，确保 selectedLog 同步
              existingLog.status = logData.status
              existingLog.responseTime = logData.response_time
              existingLog.responseBody = logData.response_body || ''
              existingLog.stage = 'completed'
              console.log('更新的请求完成日志:', existingLog)

              // 检查是否是URL检测响应，如果是则显示URL处理弹窗
              checkAndShowUrlDialog(existingLog)
            } else {
              // 如果没有找到开始记录，创建一个完整的记录
              const newLog: RequestLog = {
                id: logData.id,
                timestamp: new Date(logData.timestamp).getTime(),
                method: logData.method,
                path: logData.path,
                status: logData.status,
                ip: '127.0.0.1', // 完成阶段没有IP信息，使用默认值
                userAgent: 'Unknown', // 完成阶段没有User-Agent信息，使用默认值
                responseTime: logData.response_time,
                requestBody: '', // 完成阶段没有请求体信息
                responseBody: logData.response_body || '',
                headers: {}, // 完成阶段没有请求头信息
                stage: 'completed'
              }
              console.log('创建的请求完成日志（无开始记录）:', newLog)
              requestLogs.value.unshift(newLog)

              // 检查是否是URL检测响应，如果是则显示URL处理弹窗
              checkAndShowUrlDialog(newLog)
            }
          }

          trimRequestLogs()
        }

      } catch (error) {
        console.error('解析SSE日志数据失败:', error, '原始数据:', event.data)
      }
    })

    // 监听模型调用请求事件
    const handleModelCallRequestEvent = (event: MessageEvent | { data: string }) => {
      console.log('收到模型调用请求事件:', (event as MessageEvent).data)
      try {
        const eventData = JSON.parse((event as MessageEvent).data)
        const requestData = eventData.ModelCallRequest || eventData
        dispatchModelCallRequest(requestData.request_id, requestData.query)
      } catch (error) {
        console.error('解析模型调用请求数据失败:', error, '原始数据:', (event as MessageEvent).data)
      }
    }

    sseEventSource.addEventListener('model_call_request', handleModelCallRequestEvent as EventListener)

    // 监听模型调用响应事件
    sseEventSource.addEventListener('model_call_response', (event) => {
      console.log('收到模型调用响应事件:', event.data)
      try {
        const eventData = JSON.parse(event.data)
        const responseData = eventData.ModelCallResponse || eventData

        console.log('模型调用响应数据:', responseData)

        // 如果后端携带 reasoning_content，先更新思考过程，再更新最终结果
        const reasoning = getReasoningContentValue(responseData)
        if (reasoning) {
          updateRequestDetailsWithModelReasoning(responseData.request_id, reasoning)
        }
        updateRequestDetailsWithModelResponse(responseData.request_id, responseData.content)


      } catch (error) {
        console.error('解析模型调用响应数据失败:', error, '原始数据:', event.data)
      }
    })

    sseEventSource.addEventListener('open', () => {
      console.log('SSE连接已建立')
    })

    sseEventSource.addEventListener('message', (event) => {
      console.log('收到SSE通用消息事件:', event.data)
    })

    sseEventSource.addEventListener('error', (error) => {
      console.error('SSE连接错误:', error)
      console.log('SSE连接状态:', sseEventSource?.readyState)
      // 连接错误时，回退到轮询模式
      setTimeout(() => {
        if (serverRunning.value) {
          startLogPolling()
        }
      }, 5000)
    })
  } catch (error) {
    console.error('启动SSE连接失败:', error)
    // 回退到轮询模式
    startLogPolling()
  }
}

// 停止SSE连接
export const stopSSEConnection = () => {
  if (sseEventSource) {
    sseEventSource.close()
    sseEventSource = null
    console.log('SSE连接已关闭')
  }
}

// 启动实时更新机制（轮询模式，作为SSE的备用方案）
export const startLogPolling = () => {
  if (logUpdateInterval) {
    clearInterval(logUpdateInterval)
  }

  console.log('SSE连接失败，启动轮询模式作为备用方案')
  // 注意：这里不再调用fetchRequestLogs，因为我们已经使用SSE
  // 轮询模式主要用于在SSE连接失败时尝试重新建立SSE连接
  logUpdateInterval = setInterval(async () => {
    if (serverRunning.value) {
      // 尝试重新建立SSE连接
      if (!sseEventSource || sseEventSource.readyState === EventSource.CLOSED) {
        console.log('尝试重新建立SSE连接...')
        startSSEConnection()
      }
    }
  }, 10000) // 每10秒尝试重新连接一次
}

// 停止实时更新机制
export const stopLogPolling = () => {
  if (logUpdateInterval) {
    clearInterval(logUpdateInterval)
    logUpdateInterval = null
  }
}

export const clearLogs = async () => {
  if (!isTauri.value) {
    clearAllRequestRuntimeState()
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('clear_request_logs')
    clearAllRequestRuntimeState()
    console.log('请求日志已清空')
  } catch (error) {
    console.error('清空请求日志失败:', error)
    clearAllRequestRuntimeState()
  }
}

// 获取请求日志（保留此函数用于手动刷新或初始化，但不在SSE模式下自动调用）
export const fetchRequestLogs = async () => {
  if (!isTauri.value) {
    console.log('不在 Tauri 环境中，跳过获取请求日志')
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const logs = await invoke('get_request_logs')

    // 转换日志格式以匹配前端接口
    const formattedLogs = (logs as any[]).map((log: any) => ({
      id: `${log.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(log.timestamp).getTime(),
      method: log.method,
      path: log.path,
      status: log.status,
      ip: '127.0.0.1', // 后端暂时没有IP信息，使用默认值
      userAgent: 'Unknown', // 后端暂时没有User-Agent信息，使用默认值
      responseTime: log.response_time
    }))

    // 只在没有SSE连接时更新日志，避免重复
    if (!sseEventSource || sseEventSource.readyState !== EventSource.OPEN) {
      requestLogs.value = formattedLogs
      console.log('获取到请求日志:', requestLogs.value.length, '条')
    }
  } catch (error) {
    console.error('获取请求日志失败:', error)
  }
}


export const addSampleLogs = () => {
  const sampleLogs = [
    {
      timestamp: Date.now() - 1000,
      method: 'GET',
      path: '/api/chat',
      status: 200,
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      responseTime: 245
    },
    {
      timestamp: Date.now() - 5000,
      method: 'POST',
      path: '/api/models',
      status: 201,
      ip: '192.168.1.100',
      userAgent: 'curl/7.68.0',
      responseTime: 89
    },
    {
      timestamp: Date.now() - 10000,
      method: 'GET',
      path: '/api/status',
      status: 404,
      ip: '127.0.0.1',
      userAgent: 'PostmanRuntime/7.29.0',
      responseTime: 12
    }
  ]

  sampleLogs.forEach(log => addRequestLog(log))
}


export const onVisibilityChange = () => {
  if (document.visibilityState !== 'visible') return
  if (serverRunning.value) {
    if (!sseEventSource || sseEventSource.readyState === EventSource.CLOSED) {
      startSSEConnection()
    }
    for (const requestId of heartbeatIntervals.keys()) {
      void sendModelProgressToBackend(requestId, 'foreground-resume')
    }
  }
}

export const bindQuestionServerEvents = async () => {
  if (!isTauri.value) return
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenModelCallRequest = await listen<{ request_id?: string; query?: string }>(
      'model-call-request',
      (event) => {
        const payload = event.payload || {}
        dispatchModelCallRequest(String(payload.request_id || ''), String(payload.query || ''))
      }
    )
    unlistenRequestLogComplete = await listen<{
      id?: string
      status?: number
      response_time?: number
      response_body?: string
      stage?: string
    }>('request-log-complete', (event) => {
      applyRequestLogCompletePayload(event.payload || {})
    })
  } catch (e) {
    console.warn('注册 Tauri 事件监听失败:', e)
  }
}

export const unbindQuestionServerEvents = () => {
  stopSSEConnection()
  stopLogPolling()
  clearAllRequestRuntimeState()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  unlistenModelCallRequest?.()
  unlistenRequestLogComplete?.()
  unlistenModelCallRequest = null
  unlistenRequestLogComplete = null
}
