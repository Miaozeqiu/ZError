import { describe, expect, it } from 'vitest'
import { CLI_METHODS, configValue, patchConfig, safeCliOutput, validateCliRequest } from '../../src/services/cli/contracts'

describe('installed CLI contracts', () => {
  it('rejects unknown methods, extra arguments, invalid pagination and unconfirmed destruction', () => {
    for (const [method, params] of [
      ['invoke', { command: 'write_config' }], ['status', { eval: 'bad' }],
      ['questions.list', { pageSize: 100000 }], ['questions.delete', { id: 2 }],
      ['websites.remove', { host: 'example.com', confirm: false }], ['accounts.set', { host: 'example.com', account: 'test' }],
    ] as const) expect(() => validateCliRequest(method, params)).toThrow()
    expect(() => validateCliRequest('questions.delete', { id: 2, confirm: true })).not.toThrow()
    for (const method of Object.keys(CLI_METHODS)) expect(method).toMatch(/^[a-z_.]+$/)
  })
  it('allows only supported typed config writes and never traverses prototypes', () => {
    const settings = { theme: 'auto', modelRetryCount: 2, network: { serverPort: 3000, enableLanAccess: false }, adminToken: 'hidden' }
    expect(patchConfig(settings, 'theme', 'dark').theme).toBe('dark')
    expect(patchConfig(settings, 'network.serverPort', 4000).network.serverPort).toBe(4000)
    expect(settings.network.serverPort).toBe(3000)
    for (const [key, value] of [['__proto__.polluted', true], ['constructor.name', 'x'], ['network.serverPort', 70000], ['network.enableLanAccess', 'true'], ['adminToken', 'plaintext'], ['theme', 'red']]) {
      expect(() => patchConfig(settings, key as string, value)).toThrow()
    }
    expect(() => configValue(settings, '__proto__')).toThrow()
  })
  it('masks secret fields recursively while keeping model limits and answers usable', () => {
    expect(safeCliOutput({ platforms: [{ apiKey: 'secret', maxTokens: 4096 }], accessToken: 'a', password: 'b', customHeaders: { Authorization: 'c' }, answer: 'example', usage: { inputTokens: 123 } }))
      .toEqual({ platforms: [{ apiKey: '[已配置]', maxTokens: 4096 }], accessToken: '[已配置]', password: '[已配置]', customHeaders: '[已配置]', answer: 'example', usage: { inputTokens: 123 } })
  })
})
