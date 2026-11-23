export const WEBSITE_WORKFLOWS_TOOL = { type: 'function' as const, function: {
  name: 'browser_workflows', description: '查看、恢复或丢弃当前对话未完成的网站流程检查点。恢复沿用原包版本并重新核对页面，不会重放旧 JS 调用栈。',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'resume', 'discard'] },
    id: { type: 'string' } }, required: ['action'], additionalProperties: false },
} }
