// 简单的测试配置代码 - 直接返回结果
async function processModel(input, config) {
  // 模拟API调用
  const requestData = {
    messages: input.messages,
    model: config.model || 'test-model'
  };
  
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 返回模拟响应
  return {
    content: `测试响应: 收到消息 "${input.messages[0].content}"，使用模型 ${requestData.model}`,
    finished: true
  };
}

// 或者更简单的函数体版本（不包含function声明）：
/*
// 模拟API调用
const requestData = {
  messages: input.messages,
  model: config.model || 'test-model'
};

// 模拟网络延迟
await new Promise(resolve => setTimeout(resolve, 1000));

// 返回模拟响应
return {
  content: `测试响应: 收到消息 "${input.messages[0].content}"，使用模型 ${requestData.model}`,
  finished: true
};
*/