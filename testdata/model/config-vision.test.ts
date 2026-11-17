import { describe, expect, it } from 'vitest'
import {
  inferPlatformApiProtocol,
  modelHasVision,
  resolveModelApiProtocol,
  resolveRemoteHasVision,
} from '../../src/services/model/configTypes'
import { normalizeRemoteModelsCatalog } from '../../src/services/model/configRemote'

describe('modelHasVision', () => {
  it('认 hasVision，否则才看 category', () => {
    expect(modelHasVision(null)).toBe(false)
    expect(modelHasVision({ hasVision: true, category: 'text' })).toBe(true)
    expect(modelHasVision({ hasVision: false, category: 'vision' })).toBe(false)
    expect(modelHasVision({ category: 'vision' })).toBe(true)
    expect(modelHasVision({ category: 'text' })).toBe(false)
  })
})

describe('resolveRemoteHasVision', () => {
  it('兼容远程字段', () => {
    expect(resolveRemoteHasVision({ has_vision: true })).toBe(true)
    expect(resolveRemoteHasVision({ vision: true })).toBe(true)
    expect(resolveRemoteHasVision({ capabilities: ['vision'] })).toBe(true)
    expect(resolveRemoteHasVision({ capabilities: { vision: true } })).toBe(true)
    expect(resolveRemoteHasVision({ category: 'text' })).toBe(false)
  })
})

describe('protocol helpers', () => {
  it('平台协议优先于模型', () => {
    expect(resolveModelApiProtocol({ apiProtocol: 'anthropic' }, { apiProtocol: 'openai-chat' })).toBe('openai-chat')
    expect(resolveModelApiProtocol({ apiProtocol: 'anthropic' }, null)).toBe('anthropic')
  })

  it('从模型票数推断平台协议', () => {
    expect(inferPlatformApiProtocol({
      models: [
        { apiProtocol: 'openai-response' },
        { apiProtocol: 'openai-response' },
        { apiProtocol: 'anthropic' },
      ],
    })).toBe('openai-response')
  })
})

describe('normalizeRemoteModelsCatalog', () => {
  it('数组当平台列表', () => {
    const catalog = normalizeRemoteModelsCatalog([{ id: 'p1', icon: 'a.png' }])
    expect(catalog.platforms).toHaveLength(1)
    expect(catalog.providersList).toContain('a.png')
    expect(catalog.modelIconMappings).toEqual([])
  })

  it('对象目录读 mappings', () => {
    const catalog = normalizeRemoteModelsCatalog({
      platforms: [{ id: 'p1' }],
      providers_list: ['openai'],
      model_icon_mappings: [{ icon: 'gpt.png', models: ['gpt-4'] }],
    })
    expect(catalog.providersList).toEqual(['openai'])
    expect(catalog.modelIconMappings).toEqual([{ icon: 'gpt.png', models: ['gpt-4'] }])
  })
})
