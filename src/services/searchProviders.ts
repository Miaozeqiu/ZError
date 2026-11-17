export const SEARCH_PROVIDERS = [
  { id: 'exa', name: 'Exa', key: 'apiKey', website: 'https://exa.ai/', toolName: 'web_search_exa' },
  { id: 'deepseek', name: 'DeepSeek', key: 'deepseekApiKey', website: 'https://api-docs.deepseek.com/', toolName: 'deepseek_search' },
  { id: 'tavily', name: 'Tavily', key: 'tavilyApiKey', website: 'https://www.tavily.com/', toolName: 'tavily_search' },
  { id: 'brave', name: 'Brave Search', key: 'braveApiKey', website: 'https://brave.com/search/api/', toolName: 'brave_search' },
  { id: 'you', name: 'You.com', key: 'youApiKey', website: 'https://you.com/', toolName: 'you_search' },
] as const

export type SearchProvider = typeof SEARCH_PROVIDERS[number]
export type SearchProviderId = SearchProvider['id']
type SearchApiKeyField = SearchProvider['key']

export const getSearchProvider = (id: unknown): SearchProvider =>
  SEARCH_PROVIDERS.find(provider => provider.id === id) ?? SEARCH_PROVIDERS[0]

/** 联网搜索设置，连接参数由软件管理。 */
export interface SearchSettings extends Partial<Record<SearchApiKeyField, string>> {
  enabled: boolean
  apiKey: string
  provider?: SearchProviderId
}

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  enabled: true,
  apiKey: '',
  provider: 'exa',
  deepseekApiKey: '',
}

export const normalizeSearchSettings = (value: unknown): SearchSettings => {
  const saved = value && typeof value === 'object' ? value as Partial<SearchSettings> : {}
  const search: SearchSettings = {
    ...DEFAULT_SEARCH_SETTINGS,
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_SEARCH_SETTINGS.enabled,
    provider: getSearchProvider(saved.provider).id,
  }
  for (const { key } of SEARCH_PROVIDERS) {
    const credential = saved[key]
    if (typeof credential === 'string') search[key] = credential.trim()
  }
  return search
}
