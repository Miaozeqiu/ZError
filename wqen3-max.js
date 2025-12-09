async function processModel(input, config, abortSignal) {
  // 构建请求数据
  const requestData = {
    messages: input.messages,
    model: 'qwen3-max',
    stream: true,
  };

  // 如果有工具定义，添加到请求中
  if (input.tools && input.tools.length > 0) {
    requestData.tools = input.tools;
    // 可选：设置工具调用模式 ('auto' | 'none' | 'required')
    if (input.tool_choice) {
      requestData.tool_choice = input.tool_choice;
    }
  }

  console.log('阿里云百炼 Qwen3-Max 请求:', requestData);

  try {
    // 发送请求到阿里云百炼 API
    const response = await fetch(`${config.baseUrl}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`阿里云百炼 Qwen3-Max API 错误 ${response.status}: ${errorText}`);
    }

    // 处理流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // 返回异步生成器处理流式数据
    return (async function* () {
      let buffer = '';
      let toolCalls = []; // 累积工具调用

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // 解码数据块
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === '' || trimmedLine === 'data: [DONE]') {
              continue;
            }

            if (trimmedLine.startsWith('data: ')) {
              try {
                const jsonStr = trimmedLine.slice(6);
                const data = JSON.parse(jsonStr);

                if (data.choices && data.choices[0]) {
                  const choice = data.choices[0];
                  const delta = choice.delta || {};
                  const finished = choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls';

                  // 处理普通文本内容
                  if (delta.content) {
                    yield {
                      content: delta.content,
                      finished: false,
                      type: 'text'
                    };
                  }

                  // 处理工具调用（流式）
                  if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                    for (const toolCall of delta.tool_calls) {
                      const index = toolCall.index || 0;

                      // 初始化工具调用对象
                      if (!toolCalls[index]) {
                        toolCalls[index] = {
                          id: toolCall.id || '',
                          type: toolCall.type || 'function',
                          function: {
                            name: toolCall.function?.name || '',
                            arguments: ''
                          }
                        };
                      }

                      // 累积参数
                      if (toolCall.function?.arguments) {
                        toolCalls[index].function.arguments += toolCall.function.arguments;
                      }

                      // 更新其他字段
                      if (toolCall.id) {
                        toolCalls[index].id = toolCall.id;
                      }
                      if (toolCall.function?.name) {
                        toolCalls[index].function.name = toolCall.function.name;
                      }
                    }
                  }

                  // 如果完成，返回最终结果
                  if (finished) {
                    // 如果有工具调用，返回工具调用信息
                    if (toolCalls.length > 0) {
                      // 解析所有工具调用的参数
                      const parsedToolCalls = toolCalls.map(tc => ({
                        ...tc,
                        function: {
                          ...tc.function,
                          arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
                        }
                      }));

                      yield {
                        content: '',
                        finished: true,
                        type: 'tool_calls',
                        tool_calls: parsedToolCalls,
                        finish_reason: 'tool_calls'
                      };
                    } else {
                      // 普通文本完成
                      yield {
                        content: '',
                        finished: true,
                        type: 'text',
                        finish_reason: 'stop'
                      };
                    }
                  }
                }
              } catch (parseError) {
                console.warn('解析SSE数据失败:', parseError, trimmedLine);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    })();

  } catch (error) {
    console.error('阿里云百炼 Qwen3-Max API 调用失败:', error);
    throw error;
  }
}