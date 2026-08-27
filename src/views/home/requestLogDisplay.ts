export const isModelResponseErrorText = (text?: string | null) =>
  !!text && (text.startsWith('错误:') || text.startsWith('错误：'))

export const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const getStatusClass = (status?: number) => {
  if (status == null) return 'unknown'
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'redirect'
  if (status >= 400 && status < 500) return 'client-error'
  if (status >= 500) return 'server-error'
  return 'unknown'
}

export const getTitleFromRequestBody = (requestBody?: string) => {
  if (!requestBody) return 'Unknown'
  try {
    const parsed = JSON.parse(requestBody)
    return parsed.title || 'Unknown'
  } catch {
    return 'Unknown'
  }
}

export const truncateTitle = (title: string) => {
  if (title.length <= 50) return title
  return `${title.substring(0, 47)}...`
}

export const formatJSON = (jsonString: string) => {
  try {
    return JSON.stringify(JSON.parse(jsonString), null, 2)
  } catch {
    return jsonString
  }
}
