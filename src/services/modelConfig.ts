import { reactive, watch, computed } from 'vue'

// AI 平台配置接口
export interface AIPlatform {
  id: string
  name: string
  displayName: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  models: AIModel[]
  customHeaders?: Record<string, string>
  description?: string
  icon?: string    // 平台图标
}

// AI 模型配置接口
export interface AIModel {
  id: string
  name: string
  displayName: string
  platformId: string
  maxTokens: number
  temperature: number
  topP: number
  enabled: boolean
  category: 'text' | 'vision'  // 模型分类：文本模型或视觉模型
  description?: string
  jsCode?: string  // 模型的JS代码配置
  icon?: string    // 模型图标
  pricing?: {
    inputTokens: number  // 每千个输入token的价格
    outputTokens: number // 每千个输出token的价格
  }
}

// 模型配置设置接口
export interface ModelSettings {
  selectedTextModel: string | null    // 选中的文本模型
  selectedVisionModel: string | null  // 选中的视觉模型
  platforms: AIPlatform[]
  globalSettings: {
    timeout: number
    retryCount: number
    enableLogging: boolean
  }
  // 记录用户删除的预设平台和模型，用于后续启动不再恢复
  deletedPredefinedPlatforms?: string[]
  deletedPredefinedModels?: string[] // 以 "platformId:modelId" 形式记录
}

// 预定义的AI平台
const PREDEFINED_PLATFORMS: Omit<AIPlatform, 'apiKey' | 'enabled'>[] = [
  {
    id: 'siliconflow',
    name: 'siliconflow',
    displayName: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    icon: 'siliconflow.png',
    models: [
      {
        id: 'deepseek-v3',
        name: 'deepseek-ai/DeepSeek-V3',
        displayName: 'DeepSeek-V3',
        platformId: 'siliconflow',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: 'DeepSeek-V3 高性能大语言模型',
        pricing: { inputTokens: 0.002, outputTokens: 0.006 },
        jsCode: `async function processModel(input, config, abortSignal) { 
   // 构建请求数据 
   const requestData = { 
     messages: input.messages, 
     model: 'deepseek-ai/DeepSeek-V3', 
     stream: true, 
     max_tokens: 4096, 
     temperature: 0.7, 
     top_p:0.9 
   }; 
   
   console.log('SiliconFlow 请求:', requestData); 
   
   try { 
     // 发送请求到SiliconFlow API 
     const response = await fetch(\`\${config.baseUrl}\`, { 
       method: 'POST', 
       headers: { 
         'Authorization': \`Bearer \${config.apiKey}\`, 
         'Content-Type': 'application/json' 
       }, 
       body: JSON.stringify(requestData),
       signal: abortSignal
     }); 
     
     if (!response.ok) { 
       const errorText = await response.text(); 
       throw new Error(\`SiliconFlow API 错误 \${response.status}: \${errorText}\`); 
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
           const lines = buffer.split('\\n'); 
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
                 
                 if (data.choices && data.choices[0] && data.choices[0].delta) { 
                   const content = data.choices[0].delta.content || ''; 
                   const finished = data.choices[0].finish_reason === 'stop'; 
                   
                   if (content || finished) { 
                     yield { 
                       content: content, 
                       finished: finished 
                     }; 
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
     console.error('SiliconFlow API 调用失败:', error); 
     throw error; 
   } 
 }`
      },
      {
        id: 'siliconflow-qwen3-32b',
        name: 'Qwen/Qwen3-32B',
        displayName: 'Qwen3-32B',
        platformId: 'siliconflow',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: 'Qwen3-32B 大语言模型，支持文本理解和生成',
        pricing: { inputTokens: 0.002, outputTokens: 0.006 },
        jsCode: `async function processModel(input, config, abortSignal) { 
    // 构建请求数据 
    const requestData = { 
      messages: input.messages, 
      model: 'Qwen/Qwen3-32B', 
      stream: true, 
      max_tokens: 4096, 
      temperature: 0.7, 
      top_p:0.9 
    }; 
    
    console.log('SiliconFlow DeepSeek-V3.1-Terminus 请求:', requestData); 
    
    try { 
      // 发送请求到SiliconFlow API 
      const response = await fetch(\`\${config.baseUrl}\`, { 
        method: 'POST', 
        headers: { 
          'Authorization': \`Bearer \${config.apiKey}\`, 
          'Content-Type': 'application/json' 
        }, 
        body: JSON.stringify(requestData),
        signal: abortSignal
      }); 
      
      if (!response.ok) { 
        const errorText = await response.text(); 
        throw new Error(\`SiliconFlow DeepSeek-V3.1-Terminus API 错误 \${response.status}: \${errorText}\`); 
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
                  
                  if (data.choices && data.choices[0] && data.choices[0].delta) { 
                    const content = data.choices[0].delta.content || ''; 
                    const finished = data.choices[0].finish_reason === 'stop'; 
                    
                    if (content || finished) { 
                      yield { 
                        content: content, 
                        finished: finished 
                      }; 
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
      console.error('SiliconFlow DeepSeek-V3.1-Terminus API 调用失败:', error); 
      throw error; 
    } 
  }`
      },
      {
        id: 'siliconflow-qwen3-235b-thinking',
        name: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
        displayName: 'Qwen3-235B-Thinking',
        platformId: 'siliconflow',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: 'Qwen3-235B 大语言模型，支持文本理解和生成',
        pricing: { inputTokens: 0.002, outputTokens: 0.006 },
        jsCode: `async function processModel(input, config) {
  // 构建请求数据
  const requestData = {
    messages: input.messages,
    model: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    stream: true,
    max_tokens: 4096,
    temperature: 0.7,
    top_p: 0.9
  };

  console.log('SiliconFlow 请求:', requestData);

  try {
    // 发送请求到 SiliconFlow API
    const response = await fetch(\`\${config.baseUrl}\`, {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${config.apiKey}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(\`SiliconFlow API 错误 \${response.status}: \${errorText}\`);
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
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();

            // === 调试：打印原始 SSE 行 ===
            if (trimmedLine.startsWith('data: ')) {
              console.log('Raw SSE chunk:', trimmedLine);
            } else if (trimmedLine !== '') {
              console.log('Raw non-data line:', trimmedLine);
            }
            // ========================================

            if (trimmedLine === '' || trimmedLine === 'data: [DONE]') {
              continue;
            }

            if (trimmedLine.startsWith('data: ')) {
              try {
                const jsonStr = trimmedLine.slice(6);
                const data = JSON.parse(jsonStr);

                if (data.choices && data.choices[0] && data.choices[0].delta) {
                  const delta = data.choices[0].delta;

                  // 同时获取 content 与 reasoning_content
                  const content = delta.content ?? '';
                  const reasoning_content = delta.reasoning_content ?? '';

                  const finished = data.choices[0].finish_reason === 'stop';

                  // 只要有任意内容或结束标记就 yield
                  if (content || reasoning_content || finished) {
                    yield {
                      content,
                      reasoning_content,        // ← 新增字段
                      finished
                    };
                  }
                }
              } catch (parseError) {
                console.warn('解析 SSE 数据失败:', parseError, trimmedLine);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    })();
  } catch (error) {
    console.error('SiliconFlow API 调用失败:', error);
    throw error;
  }
}
`
      },
      {
        id: 'siliconflow-deepseek-v31-terminus',
        name: 'deepseek-ai/DeepSeek-V3.1-Terminus',
        displayName: 'DeepSeek-V3.1-Terminus',
        platformId: 'siliconflow',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: 'DeepSeek-V3.1-Terminus 最新版本大语言模型，性能更强',
        pricing: { inputTokens: 0.002, outputTokens: 0.006 },
        jsCode: `async function processModel(input, config, abortSignal) { 
    // 构建请求数据 
    const requestData = { 
      messages: input.messages, 
      model: 'deepseek-ai/DeepSeek-V3.1-Terminus', 
      stream: true, 
      max_tokens: 4096, 
      temperature: 0.7, 
      top_p:0.9 
    }; 
    
    console.log('SiliconFlow DeepSeek-V3.1-Terminus 请求:', requestData); 
    
    try { 
      // 发送请求到SiliconFlow API 
      const response = await fetch(\`\${config.baseUrl}\`, { 
        method: 'POST', 
        headers: { 
          'Authorization': \`Bearer \${config.apiKey}\`, 
          'Content-Type': 'application/json' 
        }, 
        body: JSON.stringify(requestData),
        signal: abortSignal
      }); 
      
      if (!response.ok) { 
        const errorText = await response.text(); 
        throw new Error(\`SiliconFlow DeepSeek-V3.1-Terminus API 错误 \${response.status}: \${errorText}\`); 
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
            const lines = buffer.split('\\n'); 
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
                  
                  if (data.choices && data.choices[0] && data.choices[0].delta) { 
                    const content = data.choices[0].delta.content || ''; 
                    const finished = data.choices[0].finish_reason === 'stop'; 
                    
                    if (content || finished) { 
                      yield { 
                        content: content, 
                        finished: finished 
                      }; 
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
      console.error('SiliconFlow DeepSeek-V3.1-Terminus API 调用失败:', error); 
      throw error; 
    } 
  }`
      },
      {
        id: 'siliconflow-kimi-k2-instruct',
        name: 'moonshotai/Kimi-K2-Instruct-0905',
        displayName: 'Kimi-K2-Instruct',
        platformId: 'siliconflow',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: 'Kimi-K2-Instruct 高性能对话模型，支持长文本理解',
        pricing: { inputTokens: 0.001, outputTokens: 0.003 },
        jsCode: `async function processModel(input, config, abortSignal) { 
    // 构建请求数据 
    const requestData = { 
      messages: input.messages, 
      model: 'moonshotai/Kimi-K2-Instruct-0905', 
      stream: true, 
      max_tokens: 4096, 
      temperature: 0.7, 
      top_p:0.9 
    }; 
    
    console.log('SiliconFlow Kimi 请求:', requestData); 
    
    try { 
      // 发送请求到SiliconFlow API 
      const response = await fetch(\`\${config.baseUrl}\`, { 
        method: 'POST', 
        headers: { 
          'Authorization': \`Bearer \${config.apiKey}\`, 
          'Content-Type': 'application/json' 
        }, 
        body: JSON.stringify(requestData),
        signal: abortSignal
      }); 
      
      if (!response.ok) { 
        const errorText = await response.text(); 
        throw new Error(\`SiliconFlow Kimi API 错误 \${response.status}: \${errorText}\`); 
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
            const lines = buffer.split('\\n'); 
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
                  
                  if (data.choices && data.choices[0] && data.choices[0].delta) { 
                    const content = data.choices[0].delta.content || ''; 
                    const finished = data.choices[0].finish_reason === 'stop'; 
                    
                    if (content || finished) { 
                      yield { 
                        content: content, 
                        finished: finished 
                      }; 
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
      console.error('SiliconFlow Kimi API 调用失败:', error); 
      throw error; 
    } 
  }`
      },
      {
        id: 'siliconflow-qwen2-vl-72b',
        name: 'Qwen/Qwen2.5-VL-72B-Instruct',
        displayName: 'Qwen2.5-VL-72B',
        platformId: 'siliconflow',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'vision',
        description: 'Qwen2.5-VL-72B 视觉语言模型，支持图像理解和分析',
        pricing: { inputTokens: 0.004, outputTokens: 0.012 },
        jsCode: `async function processModel(input, config, abortSignal) {
    // 构建请求数据，支持视觉输入
    const requestData = {
      messages: input.messages,
      model: 'Qwen/Qwen2.5-VL-72B-Instruct',
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
      top_p: 0.9
    };
    
    console.log('SiliconFlow VLM 请求:', requestData);
    
    try {
      // 发送请求到SiliconFlow API
      const response = await fetch(\`\${config.baseUrl}\`, {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${config.apiKey}\`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
        signal: abortSignal
      });
     
     if (!response.ok) {
       const errorText = await response.text();
       throw new Error(\`SiliconFlow VLM API 错误 \${response.status}: \${errorText}\`);
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
           const lines = buffer.split('\\n');
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
                 
                 if (data.choices && data.choices[0] && data.choices[0].delta) {
                   const content = data.choices[0].delta.content || '';
                   const finished = data.choices[0].finish_reason === 'stop';
                   
                   if (content || finished) {
                     yield {
                       content: content,
                       finished: finished
                     };
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
     console.error('SiliconFlow VLM API 调用失败:', error);
     throw error;
   }
 }`
      },
      {
        id: 'siliconflow-qwen3-vl-32b',
        name: 'Qwen/Qwen3-VL-32B-Instruct',
        displayName: 'Qwen3-VL-32B',
        platformId: 'siliconflow',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'vision',
        description: 'Qwen3-VL-32B 最新视觉语言模型，支持图像、视频理解',
        pricing: { inputTokens: 0.003, outputTokens: 0.009 },
        jsCode: `async function processModel(input, config, abortSignal) {
    // 构建请求数据，支持视觉输入
    const requestData = {
      messages: input.messages,
      model: 'Qwen/Qwen3-VL-32B-Instruct',
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
      top_p: 0.9
    };
    
    console.log('SiliconFlow Qwen3-VL 请求:', requestData);
    
    try {
      // 发送请求到SiliconFlow API
      const response = await fetch(\`\${config.baseUrl}\`, {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${config.apiKey}\`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
        signal: abortSignal
      });
     
     if (!response.ok) {
       const errorText = await response.text();
       throw new Error(\`SiliconFlow Qwen3-VL API 错误 \${response.status}: \${errorText}\`);
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
           const lines = buffer.split('\\n');
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
                 
                 if (data.choices && data.choices[0] && data.choices[0].delta) {
                   const content = data.choices[0].delta.content || '';
                   const finished = data.choices[0].finish_reason === 'stop';
                   
                   if (content || finished) {
                     yield {
                       content: content,
                       finished: finished
                     };
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
     console.error('SiliconFlow Qwen3-VL API 调用失败:', error);
     throw error;
   }
 }`
      },
      {
        id: 'siliconflow-deepseek-r1',
        name: 'deepseek-ai/DeepSeek-R1',
        displayName: 'DeepSeek-R1',
        platformId: 'siliconflow',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'vision',
        description: 'DeepSeek-R1',
        pricing: { inputTokens: 0.003, outputTokens: 0.009 },
        jsCode: `async function processModel(input, config) {
  // 构建请求数据
  const requestData = {
    messages: input.messages,
    model: 'deepseek-ai/DeepSeek-R1',
    stream: true,
    max_tokens: 4096,
    temperature: 0.7,
    top_p: 0.9
  };

  console.log('SiliconFlow 请求:', requestData);

  try {
    // 发送请求到 SiliconFlow API
    const response = await fetch(\`\${config.baseUrl}\`, {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${config.apiKey}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(\`SiliconFlow API 错误 \${response.status}: \${errorText}\`);
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
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();

            // === 调试：打印原始 SSE 行 ===
            if (trimmedLine.startsWith('data: ')) {
              console.log('Raw SSE chunk:', trimmedLine);
            } else if (trimmedLine !== '') {
              console.log('Raw non-data line:', trimmedLine);
            }
            // ========================================

            if (trimmedLine === '' || trimmedLine === 'data: [DONE]') {
              continue;
            }

            if (trimmedLine.startsWith('data: ')) {
              try {
                const jsonStr = trimmedLine.slice(6);
                const data = JSON.parse(jsonStr);

                if (data.choices && data.choices[0] && data.choices[0].delta) {
                  const delta = data.choices[0].delta;

                  // 同时获取 content 与 reasoning_content
                  const content = delta.content ?? '';
                  const reasoning_content = delta.reasoning_content ?? '';

                  const finished = data.choices[0].finish_reason === 'stop';

                  // 只要有任意内容或结束标记就 yield
                  if (content || reasoning_content || finished) {
                    yield {
                      content,
                      reasoning_content,        // ← 新增字段
                      finished
                    };
                  }
                }
              } catch (parseError) {
                console.warn('解析 SSE 数据失败:', parseError, trimmedLine);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    })();
  } catch (error) {
    console.error('SiliconFlow API 调用失败:', error);
    throw error;
  }
}
`
      }
    ],
    description: '硅基流动AI平台服务'
  },
  {
    id: 'aliyun-bailian',
    name: 'aliyun-bailian',
    displayName: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    icon: 'bailian.png',
    models: [
      {
        id: 'aliyun-qwen-plus',
        name: 'qwen-plus',
        displayName: '通义千问Plus',
        platformId: 'aliyun-bailian',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: '通义千问Plus 高性能大语言模型',
        pricing: { inputTokens: 0.004, outputTokens: 0.012 },
        jsCode: `async function processModel(input, config) { 
   // 构建请求数据 
   const requestData = { 
     messages: input.messages, 
     model: 'qwen-plus', 
     stream: true,
   }; 
   
   console.log('阿里云百炼 请求:', requestData); 
   
   try { 
     // 发送请求到阿里云百炼 API 
     const response = await fetch(\`\${config.baseUrl}\`, { 
       method: 'POST', 
       headers: { 
         'Authorization': \`Bearer \${config.apiKey}\`, 
         'Content-Type': 'application/json' 
       }, 
       body: JSON.stringify(requestData) 
     }); 
     
     if (!response.ok) { 
       const errorText = await response.text(); 
       throw new Error(\`阿里云百炼 API 错误 \${response.status}: \${errorText}\`); 
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
           const lines = buffer.split('\\n'); 
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
                 
                 if (data.choices && data.choices[0] && data.choices[0].delta) { 
                   const content = data.choices[0].delta.content || ''; 
                   const finished = data.choices[0].finish_reason === 'stop'; 
                   
                   if (content || finished) { 
                     yield { 
                       content: content, 
                       finished: finished 
                     }; 
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
     console.error('阿里云百炼 API 调用失败:', error); 
     throw error; 
   } 
 }`
      },
      {
        id: 'aliyun-qwen3-max',
        name: 'qwen3-max',
        displayName: '通义千问3-Max',
        platformId: 'aliyun-bailian',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: '通义千问3-Max 高性能大语言模型',
        pricing: { inputTokens: 0.004, outputTokens: 0.012 },
       jsCode: `async function processModel(input, config, abortSignal) { 
    // 构建请求数据 
    const requestData = { 
      messages: input.messages, 
      model: 'qwen3-max', 
      stream: true, 
    }; 
    
    console.log('阿里云百炼 Qwen3-Max 请求:', requestData); 
    
    try { 
      // 发送请求到阿里云百炼 API 
      const response = await fetch(\`\${config.baseUrl}\`, { 
        method: 'POST', 
        headers: { 
          'Authorization': \`Bearer \${config.apiKey}\`, 
          'Content-Type': 'application/json' 
        }, 
        body: JSON.stringify(requestData),
        signal: abortSignal
      }); 
      
      if (!response.ok) { 
        const errorText = await response.text(); 
        throw new Error(\`阿里云百炼 Qwen3-Max API 错误 \${response.status}: \${errorText}\`); 
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
            const lines = buffer.split('\\n'); 
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
                  
                  if (data.choices && data.choices[0] && data.choices[0].delta) { 
                    const content = data.choices[0].delta.content || ''; 
                    const finished = data.choices[0].finish_reason === 'stop'; 
                    
                    if (content || finished) { 
                      yield { 
                        content: content, 
                        finished: finished 
                      }; 
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
  }`
      },
      {
        id: 'aliyun-deepseek-r1',
        name: 'deepseek-ai/DeepSeek-R1',
        displayName: 'DeepSeek-R1',
        platformId: 'aliyun-bailian',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: 'DeepSeek-R1 推理模型，支持 reasoning_content 流式输出',
        jsCode: `async function processModel(input, config) { 
   // 构建请求数据 
   const requestData = { 
     messages: input.messages, 
     model: 'deepseek-ai/DeepSeek-R1', 
     stream: true, 
     max_tokens: 4096, 
     temperature: 0.7, 
     top_p: 0.9 
   }; 
 
   console.log('SiliconFlow 请求:', requestData); 
 
   try { 
     // 发送请求到 SiliconFlow API 
     const response = await fetch(
       \`\${config.baseUrl}\`, 
       { 
         method: 'POST', 
         headers: { 
           'Authorization': \`Bearer \${config.apiKey}\`, 
           'Content-Type': 'application/json' 
         }, 
         body: JSON.stringify(requestData) 
       }
     ); 
 
     if (!response.ok) { 
       const errorText = await response.text(); 
       throw new Error(\`SiliconFlow API 错误 \${response.status}: \${errorText}\`); 
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
           const lines = buffer.split('\n'); 
           buffer = lines.pop() || ''; 
 
           for (const line of lines) { 
             const trimmedLine = line.trim(); 
 
             // === 调试：打印原始 SSE 行 === 
             if (trimmedLine.startsWith('data: ')) { 
               console.log('Raw SSE chunk:', trimmedLine); 
             } else if (trimmedLine !== '') { 
               console.log('Raw non-data line:', trimmedLine); 
             } 
             // ======================================== 
 
             if (trimmedLine === '' || trimmedLine === 'data: [DONE]') { 
               continue; 
             } 
 
             if (trimmedLine.startsWith('data: ')) { 
               try { 
                 const jsonStr = trimmedLine.slice(6); 
                 const data = JSON.parse(jsonStr); 
 
                 if (data.choices && data.choices[0] && data.choices[0].delta) { 
                   const delta = data.choices[0].delta; 
 
                   // 同时获取 content 与 reasoning_content 
                   const content = delta.content ?? ''; 
                   const reasoning_content = delta.reasoning_content ?? ''; 
 
                   const finished = data.choices[0].finish_reason === 'stop'; 
 
                   // 只要有任意内容或结束标记就 yield 
                   if (content || reasoning_content || finished) { 
                     yield { 
                       content, 
                       reasoning_content, 
                       finished 
                     }; 
                   } 
                 } 
               } catch (parseError) { 
                 console.warn('解析 SSE 数据失败:', parseError, trimmedLine); 
               } 
             } 
           } 
         } 
       } finally { 
         reader.releaseLock(); 
       } 
     })(); 
   } catch (error) { 
     console.error('SiliconFlow API 调用失败:', error); 
     throw error; 
   } 
 }`
      },
      {
        id: 'aliyun-deepseek-v3',
        name: 'deepseek-v3',
        displayName: 'DeepSeek-V3',
        platformId: 'aliyun-bailian',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'text',
        description: 'DeepSeek-V3 高性能大语言模型（阿里云百炼兼容模式）',
        jsCode: `async function processModel(input, config) { 
   // 构建请求数据 
   const requestData = { 
     messages: input.messages, 
     model: 'deepseek-v3', 
     stream: true, 
   }; 
   
   console.log('阿里云百炼 请求:', requestData); 
   
   try { 
     // 发送请求到阿里云百炼 API 
     const response = await fetch(\`\${config.baseUrl}\`, { 
       method: 'POST', 
       headers: { 
         'Authorization': \`Bearer \${config.apiKey}\`, 
         'Content-Type': 'application/json' 
       }, 
       body: JSON.stringify(requestData) 
     }); 
     
     if (!response.ok) { 
       const errorText = await response.text(); 
       throw new Error(\`阿里云百炼 API 错误 \${response.status}: \${errorText}\`); 
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
                 
                 if (data.choices && data.choices[0] && data.choices[0].delta) { 
                   const content = data.choices[0].delta.content || ''; 
                   const finished = data.choices[0].finish_reason === 'stop'; 
                   
                   if (content || finished) { 
                     yield { 
                       content: content, 
                       finished: finished 
                     }; 
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
     console.error('阿里云百炼 API 调用失败:', error); 
     throw error; 
   } 
 }`
      },
      {
        id: 'aliyun-qwen3-vl-plus',
        name: 'qwen3-vl-plus',
        displayName: '通义千问3-VL-Plus',
        platformId: 'aliyun-bailian',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        enabled: true,
        category: 'vision',
        description: '通义千问3-VL-Plus 视觉语言模型，支持图像理解和分析',
        pricing: { inputTokens: 0.006, outputTokens: 0.018 },
        jsCode: `async function processModel(input, config, abortSignal) { 
    // 构建请求数据，支持视觉输入 
    const requestData = { 
      messages: input.messages, 
      model: 'qwen3-vl-plus', 
      stream: true, 
      max_tokens: 4096, 
      temperature: 0.7, 
      top_p: 0.9 
    }; 
    
    console.log('阿里云百炼 Qwen3-VL 请求:', requestData); 
    
    try { 
      // 发送请求到阿里云百炼 API 
      const response = await fetch(\`\${config.baseUrl}\`, { 
        method: 'POST', 
        headers: { 
          'Authorization': \`Bearer \${config.apiKey}\`, 
          'Content-Type': 'application/json' 
        }, 
        body: JSON.stringify(requestData),
        signal: abortSignal
      }); 
      
      if (!response.ok) { 
        const errorText = await response.text(); 
        throw new Error(\`阿里云百炼 Qwen3-VL API 错误 \${response.status}: \${errorText}\`); 
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
            const lines = buffer.split('\\n'); 
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
                  
                  if (data.choices && data.choices[0] && data.choices[0].delta) { 
                    const content = data.choices[0].delta.content || ''; 
                    const finished = data.choices[0].finish_reason === 'stop'; 
                    
                    if (content || finished) { 
                      yield { 
                        content: content, 
                        finished: finished 
                      }; 
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
      console.error('阿里云百炼 Qwen3-VL API 调用失败:', error); 
      throw error; 
    } 
  }`
      }
    ],
    description: '阿里云百炼AI平台服务'
  },
  
]

// 默认模型配置
const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  selectedTextModel: null,
  selectedVisionModel: null,
  platforms: PREDEFINED_PLATFORMS.map(platform => ({
    ...platform,
    apiKey: '',
    enabled: true, // 默认启用所有预定义平台，方便开发调试
    models: platform.models.map(model => ({
      ...model,
      enabled: true // 默认启用所有预定义模型
    }))
  })),
  globalSettings: {
    timeout: 30000,
    retryCount: 3,
    enableLogging: false
  },
  deletedPredefinedPlatforms: [],
  deletedPredefinedModels: []
}

// 模型配置存储键
const MODEL_SETTINGS_STORAGE_KEY = 'model_settings'

/**
 * 模型配置管理器类
 */
class ModelConfigManager {
  private settings: ModelSettings
  private listeners: Set<(settings: ModelSettings) => void> = new Set()

  constructor() {
    this.settings = reactive(this.loadSettings())
    this.setupAutoSave()
  }

  /**
   * 从本地存储加载模型配置
   */
  private loadSettings(): ModelSettings {
    try {
      const stored = localStorage.getItem(MODEL_SETTINGS_STORAGE_KEY)
      if (stored) {
        const parsedSettings = JSON.parse(stored)
        // 合并预定义平台和用户配置，同时尊重用户删除的预设项
        const mergedPlatforms = this.mergePlatforms(
          parsedSettings.platforms || [],
          parsedSettings.deletedPredefinedPlatforms || [],
          parsedSettings.deletedPredefinedModels || []
        )
        return {
          ...DEFAULT_MODEL_SETTINGS,
          ...parsedSettings,
          platforms: mergedPlatforms,
          deletedPredefinedPlatforms: parsedSettings.deletedPredefinedPlatforms || [],
          deletedPredefinedModels: parsedSettings.deletedPredefinedModels || []
        }
      }
    } catch (error) {
      console.warn('加载模型配置失败，使用默认配置:', error)
    }
    return { ...DEFAULT_MODEL_SETTINGS }
  }

  /**
   * 合并预定义平台和用户配置
   */
  private mergePlatforms(
    userPlatforms: AIPlatform[],
    deletedPlatforms: string[] = [],
    deletedModels: string[] = []
  ): AIPlatform[] {
    const mergedPlatforms: AIPlatform[] = []
    const userPlatformMap = new Map(userPlatforms.map(p => [p.id, p]))
    const deletedPlatformSet = new Set(deletedPlatforms)
    const deletedModelSet = new Set(deletedModels)

    // 添加预定义平台，保留用户的API Key、启用状态和图标
    PREDEFINED_PLATFORMS.forEach(predefined => {
      // 如果用户删除了该预设平台，则跳过恢复
      if (deletedPlatformSet.has(predefined.id)) {
        userPlatformMap.delete(predefined.id)
        return
      }
      const userPlatform = userPlatformMap.get(predefined.id)
      // 如果用户配置中不存在该预设平台（可能已被删除），则不恢复
      if (!userPlatform) {
        return
      }
      mergedPlatforms.push({
        ...predefined,
        apiKey: userPlatform?.apiKey || '',
        enabled: userPlatform?.enabled || false,
        icon: userPlatform?.icon || predefined.icon, // 保留用户自定义的图标，如果没有则使用预定义的
        models: this.mergeModels(predefined.models, userPlatform?.models || [], predefined.id, deletedModelSet)
      })
      userPlatformMap.delete(predefined.id)
    })

    // 添加用户自定义平台
    userPlatformMap.forEach(platform => {
      mergedPlatforms.push(platform)
    })

    return mergedPlatforms
  }

  /**
   * 合并预定义模型和用户配置
   */
  private mergeModels(
    predefinedModels: AIModel[],
    userModels: AIModel[],
    platformId: string,
    deletedModelSet: Set<string>
  ): AIModel[] {
    const mergedModels: AIModel[] = []
    const userModelMap = new Map(userModels.map(m => [m.id, m]))

    // 添加预定义模型，保留用户的配置
    predefinedModels.forEach(predefined => {
      // 如果该预设模型被用户删除（记录为 platformId:modelId），则跳过恢复
      const deletedKey = `${platformId}:${predefined.id}`
      if (deletedModelSet.has(deletedKey)) {
        userModelMap.delete(predefined.id)
        return
      }
      // 如果用户配置中不存在该预设模型（可能已被删除），则不恢复
      if (!userModelMap.has(predefined.id)) {
        return
      }
      const userModel = userModelMap.get(predefined.id)
      mergedModels.push({
        ...predefined,
        ...userModel,
        id: predefined.id,
        name: predefined.name,
        platformId: predefined.platformId
      })
      userModelMap.delete(predefined.id)
    })

    // 添加用户自定义模型
    userModelMap.forEach(model => {
      mergedModels.push(model)
    })

    return mergedModels
  }

  /**
   * 保存配置到本地存储
   */
  private saveSettings(): void {
    try {
      localStorage.setItem(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(this.settings))
      this.notifyListeners()
    } catch (error) {
      console.error('保存模型配置失败:', error)
      throw new Error('模型配置保存失败')
    }
  }

  /**
   * 设置自动保存
   */
  private setupAutoSave(): void {
    watch(
      () => this.settings,
      () => {
        this.saveSettings()
      },
      { deep: true }
    )
  }

  /**
   * 通知监听器配置已更改
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.settings)
      } catch (error) {
        console.error('模型配置监听器执行失败:', error)
      }
    })
  }

  /**
   * 获取当前配置
   */
  getSettings(): ModelSettings {
    return this.settings
  }

  /**
   * 获取所有平台
   */
  getPlatforms(): AIPlatform[] {
    return this.settings.platforms
  }

  /**
   * 获取启用的平台
   */
  getEnabledPlatforms(): AIPlatform[] {
    // 平台必须启用，且有启用的模型才返回
    return this.settings.platforms.filter(p => 
      p.enabled && 
      p.models && 
      p.models.some(model => model.enabled)
    )
  }

  /**
   * 获取所有可用模型
   */
  getAvailableModels(): AIModel[] {
    return this.getEnabledPlatforms()
      .flatMap(platform => platform.models)
      .filter(model => model.enabled)
  }

  /**
   * 获取当前选中的文本模型
   */
  getSelectedTextModel(): AIModel | null {
    if (!this.settings.selectedTextModel) return null
    
    const allModels = this.settings.platforms.flatMap(p => p.models)
    return allModels.find(m => m.id === this.settings.selectedTextModel && m.category === 'text') || null
  }

  /**
   * 获取当前选中的视觉模型
   */
  getSelectedVisionModel(): AIModel | null {
    if (!this.settings.selectedVisionModel) return null
    
    const allModels = this.settings.platforms.flatMap(p => p.models)
    return allModels.find(m => m.id === this.settings.selectedVisionModel && m.category === 'vision') || null
  }

  /**
   * 获取当前选中的模型（文本模型或视觉模型）
   */
  getSelectedModel(): AIModel | null {
    // 优先返回文本模型，如果没有则返回视觉模型
    const textModel = this.getSelectedTextModel()
    if (textModel) {
      return textModel
    }
    return this.getSelectedVisionModel()
  }

  /**
   * 设置选中的文本模型
   */
  setSelectedTextModel(modelId: string | null): void {
    this.settings.selectedTextModel = modelId
    // 移除互斥逻辑，允许同时选择文本和视觉模型
  }

  /**
   * 设置选中的视觉模型
   */
  setSelectedVisionModel(modelId: string | null): void {
    this.settings.selectedVisionModel = modelId
    // 移除互斥逻辑，允许同时选择文本和视觉模型
  }

  /**
   * 设置选中的模型（兼容旧接口，设置文本模型）
   */
  setSelectedModel(modelId: string | null): void {
    this.setSelectedTextModel(modelId)
  }

  /**
   * 添加自定义平台
   */
  addPlatform(platform: Omit<AIPlatform, 'id'>): string {
    const id = `custom_${Date.now()}`
    const newPlatform: AIPlatform = {
      ...platform,
      id,
      displayName: platform.name, // 确保设置 displayName 字段
      models: platform.models || [] // 使用传入的模型数组，如果为空则使用空数组
    }
    
    this.settings.platforms.push(newPlatform)
    return id
  }

  /**
   * 更新平台配置
   */
  updatePlatform(platformId: string, updates: Partial<AIPlatform>): void {
    const platform = this.settings.platforms.find(p => p.id === platformId)
    if (platform) {
      Object.assign(platform, updates)
      // 如果更新了name字段，同时更新displayName
      if (updates.name) {
        platform.displayName = updates.name
      }
    }
  }

  /**
   * 删除平台
   */
  removePlatform(platformId: string): void {
    const index = this.settings.platforms.findIndex(p => p.id === platformId)
    if (index !== -1) {
      // 如果删除的平台包含当前选中的模型，清除选择
      const platform = this.settings.platforms[index]
      const selectedModel = this.getSelectedModel()
      if (selectedModel && selectedModel.platformId === platformId) {
        this.settings.selectedTextModel = null
      }
      // 如果是预设平台，记录到删除列表，避免下次启动恢复
      const isPredefined = PREDEFINED_PLATFORMS.some(p => p.id === platformId)
      if (isPredefined) {
        const list = this.settings.deletedPredefinedPlatforms || []
        if (!list.includes(platformId)) {
          list.push(platformId)
          this.settings.deletedPredefinedPlatforms = list
        }
      }
      
      this.settings.platforms.splice(index, 1)
    }
  }

  /**
   * 添加自定义模型到平台
   */
  addModelToPlatform(platformId: string, model: Omit<AIModel, 'id' | 'platformId'>): string {
    const platform = this.settings.platforms.find(p => p.id === platformId)
    if (!platform) {
      throw new Error('平台不存在')
    }

    const modelId = `${platformId}_${model.name}_${Date.now()}`
    const newModel: AIModel = {
      ...model,
      id: modelId,
      platformId
    }

    platform.models.push(newModel)
    return modelId
  }

  /**
   * 更新模型配置
   */
  updateModel(modelId: string, updates: Partial<AIModel>): void {
    for (const platform of this.settings.platforms) {
      const model = platform.models.find(m => m.id === modelId)
      if (model) {
        Object.assign(model, updates)
        break
      }
    }
  }

  /**
   * 删除模型
   */
  removeModel(modelId: string): void {
    for (const platform of this.settings.platforms) {
      const index = platform.models.findIndex(m => m.id === modelId)
      if (index !== -1) {
        // 如果删除的是当前选中的模型，清除选择
        if (this.settings.selectedTextModel === modelId) {
          this.settings.selectedTextModel = null
        }
        // 如果是预设模型，记录删除键 "platformId:modelId"，避免下次启动恢复
        const predefinedPlatform = PREDEFINED_PLATFORMS.find(p => p.id === platform.id)
        const isPredefinedModel = predefinedPlatform?.models.some(m => m.id === modelId) || false
        if (predefinedPlatform && isPredefinedModel) {
          const key = `${platform.id}:${modelId}`
          const list = this.settings.deletedPredefinedModels || []
          if (!list.includes(key)) {
            list.push(key)
            this.settings.deletedPredefinedModels = list
          }
        }
        
        platform.models.splice(index, 1)
        break
      }
    }
  }

  /**
   * 更新全局设置
   */
  updateGlobalSettings(updates: Partial<ModelSettings['globalSettings']>): void {
    Object.assign(this.settings.globalSettings, updates)
  }

  /**
   * 重置配置
   */
  reset(): void {
    Object.assign(this.settings, DEFAULT_MODEL_SETTINGS)
  }

  /**
   * 导出配置
   */
  export(): string {
    return JSON.stringify(this.settings, null, 2)
  }

  /**
   * 导入配置
   */
  import(jsonString: string): void {
    try {
      const importedSettings = JSON.parse(jsonString)
      if (this.validateSettings(importedSettings)) {
        Object.assign(this.settings, importedSettings)
      } else {
        throw new Error('配置格式无效')
      }
    } catch (error) {
      console.error('导入配置失败:', error)
      throw new Error('配置导入失败')
    }
  }

  /**
   * 验证配置格式
   */
  private validateSettings(settings: any): boolean {
    return (
      typeof settings === 'object' &&
      Array.isArray(settings.platforms) &&
      typeof settings.globalSettings === 'object'
    )
  }

  /**
   * 添加配置变更监听器
   */
  addListener(listener: (settings: ModelSettings) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 移除配置变更监听器
   */
  removeListener(listener: (settings: ModelSettings) => void): void {
    this.listeners.delete(listener)
  }
}

// 导出单例实例
export const modelConfigManager = new ModelConfigManager()

// 导出类型
export type { ModelConfigManager }

// 导出组合式函数
export function useModelConfig() {
  const settings = modelConfigManager.getSettings()
  
  return {
    settings,
    platforms: computed(() => modelConfigManager.getPlatforms()),
    selectedModel: computed(() => modelConfigManager.getSelectedModel()),
    selectedTextModel: computed(() => modelConfigManager.getSelectedTextModel()),
    selectedVisionModel: computed(() => modelConfigManager.getSelectedVisionModel()),
    availableModels: computed(() => modelConfigManager.getAvailableModels()),
    
    // 方法
    setSelectedModel: modelConfigManager.setSelectedModel.bind(modelConfigManager),
    setSelectedTextModel: modelConfigManager.setSelectedTextModel.bind(modelConfigManager),
    setSelectedVisionModel: modelConfigManager.setSelectedVisionModel.bind(modelConfigManager),
    addPlatform: modelConfigManager.addPlatform.bind(modelConfigManager),
    updatePlatform: modelConfigManager.updatePlatform.bind(modelConfigManager),
    removePlatform: modelConfigManager.removePlatform.bind(modelConfigManager),
    addModelToPlatform: modelConfigManager.addModelToPlatform.bind(modelConfigManager),
    updateModel: modelConfigManager.updateModel.bind(modelConfigManager),
    removeModel: modelConfigManager.removeModel.bind(modelConfigManager),
    updateGlobalSettings: modelConfigManager.updateGlobalSettings.bind(modelConfigManager),
    
    // 工具方法
    export: modelConfigManager.export.bind(modelConfigManager),
    import: modelConfigManager.import.bind(modelConfigManager),
    reset: modelConfigManager.reset.bind(modelConfigManager),
    addListener: modelConfigManager.addListener.bind(modelConfigManager),
    removeListener: modelConfigManager.removeListener.bind(modelConfigManager)
  }
}