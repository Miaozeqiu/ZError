async function processModel(input, config) {
  // 打印配置信息
  console.log('Base URL:', config.apiUrl || config.baseUrl);
  console.log('API Key:', config.apiKey);
  
  // 构建请求数据
  const requestData = {
    messages: input.messages,
    model: config.model || 'gpt-3.5-turbo',
    stream: true,
    max_tokens: config.maxTokens || 1000
  };
  
  console.log('请求数据:', requestData);
  
  // 模拟流式响应 - 使用异步生成器
  async function* simulateStreamResponse() {
    const responseText = "这是一个模拟的流式响应。我会逐步返回数据，模拟真实的AI模型流式输出。每个数据块都会被单独处理和显示。";
    const chunks = responseText.split('');
    
    for (let i = 0; i < chunks.length; i++) {
      // 模拟网络延迟
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const chunk = {
        content: chunks[i],
        finished: i === chunks.length - 1
      };
      
      console.log('收到流式响应数据:', chunk);
      yield chunk;
    }
  }
  
  // 返回异步生成器
  return simulateStreamResponse();
}