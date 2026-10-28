import { describe, expect, it } from 'vitest'
import { isRetryableHttpStatus } from '../../src/services/model/runner'

describe('模型网关 HTTP 重试', () => {
  it('将 524 网关超时视为暂时故障，但不重试鉴权和余额错误', () => {
    expect(isRetryableHttpStatus(524)).toBe(true)
    expect(isRetryableHttpStatus(401)).toBe(false)
    expect(isRetryableHttpStatus(402)).toBe(false)
  })
})
