async function processModel(input, config) {
  // 打印配置信息
  console.log('Base URL:', config.baseUrl);
  console.log('API Key:', config.apiKey ? '***已配置***' : '未配置');
  console.log('Model:', config.model);
  
  // 构建请求数据
  const requestData = {
    messages: input.messages,
    model: config.model || 'Qwen/Qwen2.5-7B-Instruct', // 使用SiliconFlow支持的模型
    stream: true,
    max_tokens: config.maxTokens || 1000,
    temperature: config.temperature || 0.7,
    top_p: config.topP || 0.9
  };
  
  console.log('请求数据:', requestData);
  
  try {
    // 发送请求到SiliconFlow API
    const response = await fetch(`${config.baseUrl}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // 处理流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    // 返回异步生成器处理流式数据
    return (async function* () {
      let buffer = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          // 解码数据块
          buffer += decoder.decode(value, { stream: true });
          
          // 处理可能包含多个事件的缓冲区
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 保留不完整的行
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            
            // 跳过空行和注释行
            if (!trimmedLine || trimmedLine.startsWith(':')) {
              continue;
            }
            
            // 处理数据行
            if (trimmedLine.startsWith('data: ')) {
              const dataStr = trimmedLine.slice(6); // 移除 'data: ' 前缀
              
              // 检查是否为结束标记
              if (dataStr === '[DONE]') {
                console.log('流式响应完成');
                return;
              }
              
              try {
                // 解析JSON数据
                const data = JSON.parse(dataStr);
                
                // 提取内容
                if (data.choices && data.choices[0] && data.choices[0].delta) {
                  const delta = data.choices[0].delta;
                  
                  if (delta.content) {
                    console.log('收到流式响应数据:', delta.content);
                    
                    yield {
                      content: delta.content,
                      finished: data.choices[0].finish_reason === 'stop'
                    };
                  }
                }
              } catch (parseError) {
                console.warn('解析JSON数据失败:', parseError, '原始数据:', dataStr);
              }
            }
          }
        }
      } catch (error) {
        console.error('读取流式响应时出错:', error);
        throw error;
      } finally {
        reader.releaseLock();
      }
    })();
    
  } catch (error) {
    console.error('调用SiliconFlow API失败:', error);
    throw error;
  }
}