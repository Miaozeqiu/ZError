export const PROTECT_CREDENTIALS_TOOL = {
  type: 'function',
  function: {
    name: 'protect_credentials',
    description: '在用户消息中识别到真实账号、密码或 API Key 后立即调用。软件加密保存并把历史、摘要、工具参数及后续模型上下文替换为变量。必须精确引用用户原文，不得猜测、修改、去除密码中的空格或从网页提取。先完成登记，再操作浏览器；已经是 {{secret:...}} 的内容直接通过变量使用。网站不明确时先安全登记为临时凭据，告知用户选择所属网站。',
    parameters: { type: 'object', properties: {
      source_message_id: { type: 'string', description: '来源用户消息的 ID；省略时使用最近一条用户消息。' },
      site: { type: 'string', description: '由用户明确指定或当前目标登录页核对的主网站域名或标识。同一网站多个域名使用主网站；不能根据相同账号或密码推断网站，归属不明确时省略。' },
      account: { type: 'string', description: '从指定用户消息精确识别的账号，不得包含周围说明文字。' },
      password: { type: 'string', description: '精确密码，保留特殊字符与空格。' },
      api_key: { type: 'string', description: '用户提供的 API Key。' },
      provider_id: { type: 'string', description: '已配置的模型平台 ID，或 search/exa、search/deepseek、search/tavily、search/brave、search/you。API Key 不允许用于浏览器输入。' },
    } },
  },
}
