/** 普通 Agent 的联网搜索工具。连接参数由应用设置统一管理。 */
export const WEB_SEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取最新资料。需要事实、新闻、文档或用户明确要求联网查询时调用；不要把它用于本地题库搜索。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要搜索的关键词或完整问题' },
        },
        required: ['query'],
      },
    },
  },
]
