export function requiredText(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} 不能为空`)
  return value.trim()
}

export function webUrl(value: string): string {
  const url = new URL(requiredText(value, 'url'))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只允许不包含账号密码的 HTTP/HTTPS 地址')
  return url.href
}

export function hostName(value: string): string {
  const host = requiredText(value, 'host').toLowerCase()
  if (new URL(`https://${host}`).hostname !== host) throw new Error('host 必须是域名')
  return host
}
