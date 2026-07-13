import type { AIModel } from './modelConfig'

type ApiProtocol = AIModel['apiProtocol']

export const normalizeApiProtocol = (protocol?: string | null): ApiProtocol => {
  switch (protocol) {
    case 'openai-chat':
    case 'openai-response':
    case 'anthropic':
    case 'custom':
      return protocol
    case 'OpenAI':
    case 'openai':
      return 'openai-chat'
    case 'Responses':
      return 'openai-response'
    case 'Anthropic':
      return 'anthropic'
    default:
      return 'openai-chat'
  }
}

export const readModelIdFromJsCode = (code?: string | null): string | null => {
  if (!code) return null
  const match = code.match(/model\s*:\s*(['"`])([^'"`\n]*?)\1/)
  return match ? match[2] : null
}

export const resolveRuntimeModelId = (
  model?: Partial<Pick<AIModel, 'id' | 'modelId' | 'jsCode'>>
): string => {
  return model?.modelId?.trim() || readModelIdFromJsCode(model?.jsCode) || model?.id || ''
}

const buildCommonHelpers = () => `
  const PRESET_MODEL_ID = __MODEL_ID__;
  const ENABLE_THINKING = __ENABLE_THINKING__;

  const pickFirstString = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return '';
  };

  const normalizeBaseUrl = (baseUrl) => String(baseUrl || '').replace(/\\/+$/, '');

  const getRuntimeModelId = () => PRESET_MODEL_ID || config.modelId || input.model || config.model || '';

  const buildHeaders = (extraHeaders = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...extraHeaders
    };

    if (config.apiKey) {
      headers.Authorization = 'Bearer ' + config.apiKey;
    }

    if (config.customHeaders && typeof config.customHeaders === 'object') {
      Object.assign(headers, config.customHeaders);
    }

    return headers;
  };

  const ensureOk = async (response) => {
    if (response.ok) return;
    let message = '';
    try {
      message = await response.text();
    } catch {}
    throw new Error(message || ('HTTP ' + response.status));
  };

  const parseJsonSafe = async (response) => {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(text || '响应不是合法 JSON');
    }
  };

  const readSSEPayloads = async function* (response) {
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    const flush = async function* (chunkText) {
      const blocks = chunkText.split(/\\n\\n+/);
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        const lines = block
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        const dataLines = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());

        if (!dataLines.length) continue;

        const data = dataLines.join('\\n');
        if (!data || data === '[DONE]') continue;

        try {
          yield JSON.parse(data);
        } catch {}
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      yield* flush(buffer);

      if (done) {
        if (buffer.trim()) {
          yield* flush(buffer + '\\n\\n');
        }
        break;
      }
    }
  };

  const joinTextParts = (value) => {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      if (item.type === 'text' && typeof item.text === 'string') return item.text;
      if (item.type === 'output_text' && typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string') return item.content;
      return '';
    }).join('');
  };

  const mapResponseTool = (tool) => {
    if (!tool || tool.type !== 'function' || !tool.function) return null;
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters || {
        type: 'object',
        properties: {}
      }
    };
  };

  const mapAnthropicTool = (tool) => {
    if (!tool || tool.type !== 'function' || !tool.function) return null;
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters || {
        type: 'object',
        properties: {}
      }
    };
  };

  const normalizeOpenAIChunk = (payload) => {
    const choice = payload && payload.choices ? payload.choices[0] || {} : {};
    const delta = choice.delta || {};
    const message = choice.message || {};
    const content = joinTextParts(delta.content ?? message.content ?? payload.content ?? payload.response);
    const reasoning = pickFirstString(
      delta.reasoning_content,
      delta.reasoning,
      message.reasoning_content,
      message.reasoning,
      payload.reasoning_content,
      payload.reasoning
    );
    const toolCalls = delta.tool_calls || message.tool_calls || payload.tool_calls;

    if (!content && !reasoning && (!toolCalls || !toolCalls.length) && !payload.usage) {
      return null;
    }

    return {
      ...payload,
      content,
      reasoning_content: reasoning,
      ...(toolCalls ? { tool_calls: toolCalls } : {})
    };
  };

  const mapResponsesContent = (content) => {
    if (typeof content === 'string') {
      return [{ type: 'input_text', text: content }];
    }

    if (!Array.isArray(content)) return [];

    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return null;

        if (item.type === 'text' && typeof item.text === 'string') {
          return { type: 'input_text', text: item.text };
        }

        const imageUrl = item.image_url && typeof item.image_url.url === 'string' ? item.image_url.url : '';
        if (item.type === 'image_url' && imageUrl) {
          return { type: 'input_image', image_url: imageUrl, detail: item.image_url.detail || 'auto' };
        }

        return null;
      })
      .filter(Boolean);
  };

  const buildResponsesInput = (messages) => {
    return (messages || []).map((message) => ({
      role: message.role === 'system' ? 'system' : message.role,
      content: mapResponsesContent(message.content)
    }));
  };

  const extractResponsesText = (payload) => {
    if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;

    const outputs = Array.isArray(payload.output) ? payload.output : Array.isArray(payload.response && payload.response.output) ? payload.response.output : [];
    return outputs
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        if (Array.isArray(item.content)) {
          return item.content
            .map((part) => {
              if (!part || typeof part !== 'object') return '';
              if (typeof part.text === 'string') return part.text;
              if (typeof part.content === 'string') return part.content;
              return '';
            })
            .join('');
        }
        return typeof item.text === 'string' ? item.text : '';
      })
      .join('');
  };

  const normalizeResponsesPayload = (payload) => {
    const content = extractResponsesText(payload);
    const reasoning = pickFirstString(
      payload.reasoning_content,
      payload.reasoning,
      payload.response && payload.response.reasoning_content,
      payload.response && payload.response.reasoning
    );

    const outputs = Array.isArray(payload.output) ? payload.output : Array.isArray(payload.response && payload.response.output) ? payload.response.output : [];
    const toolCalls = outputs
      .filter((item) => item && item.type === 'function_call')
      .map((item) => ({
        id: item.call_id || item.id || 'function_call',
        function: {
          name: item.name || '',
          arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {})
        }
      }));

    if (!content && !reasoning && !toolCalls.length && !payload.usage) {
      return null;
    }

    return {
      ...payload,
      content,
      reasoning_content: reasoning,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {})
    };
  };

  const mapAnthropicContent = (content) => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return [];

    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return null;

        if (item.type === 'text' && typeof item.text === 'string') {
          return { type: 'text', text: item.text };
        }

        const imageUrl = item.image_url && typeof item.image_url.url === 'string' ? item.image_url.url : '';
        if (item.type === 'image_url' && imageUrl.startsWith('data:')) {
          const match = imageUrl.match(/^data:(.+?);base64,(.+)$/);
          if (!match) return null;
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: match[1],
              data: match[2]
            }
          };
        }

        return null;
      })
      .filter(Boolean);
  };

  const buildAnthropicMessages = (messages) => {
    const systemParts = [];
    const normalizedMessages = [];

    for (const message of messages || []) {
      if (message.role === 'system') {
        const systemText = typeof message.content === 'string' ? message.content : joinTextParts(message.content);
        if (systemText) systemParts.push(systemText);
        continue;
      }

      normalizedMessages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: mapAnthropicContent(message.content)
      });
    }

    return {
      system: systemParts.join('\\n\\n'),
      messages: normalizedMessages
    };
  };

  const normalizeAnthropicPayload = (payload) => {
    const contentBlocks = Array.isArray(payload.content) ? payload.content : [];
    const content = contentBlocks
      .filter((item) => item && item.type === 'text')
      .map((item) => item.text || '')
      .join('');
    const reasoning = contentBlocks
      .filter((item) => item && (item.type === 'thinking' || item.type === 'redacted_thinking'))
      .map((item) => item.thinking || item.text || '')
      .join('');
    const toolCalls = contentBlocks
      .filter((item) => item && item.type === 'tool_use')
      .map((item) => ({
        id: item.id || 'tool_use',
        function: {
          name: item.name || '',
          arguments: JSON.stringify(item.input || {})
        }
      }));

    if (!content && !reasoning && !toolCalls.length && !payload.usage) {
      return null;
    }

    return {
      ...payload,
      content,
      reasoning_content: reasoning,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {})
    };
  };
`

const buildOpenAIChatTemplate = (modelId: string, enableThinking = false) => `
async function processModel(input, config, fetch, abortSignal) {
${buildCommonHelpers()
  .replace('__MODEL_ID__', JSON.stringify(modelId))
  .replace('__ENABLE_THINKING__', JSON.stringify(enableThinking))
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}

  const runtimeModelId = getRuntimeModelId();
  const payload = {
    model: runtimeModelId,
    messages: input.messages || [],
    stream: input.stream !== false
  };

  if (input.tools && input.tools.length) {
    payload.tools = input.tools;
  }
  if (typeof config.temperature === 'number') payload.temperature = config.temperature;
  if (typeof config.topP === 'number') payload.top_p = config.topP;
  if (typeof config.maxTokens === 'number') payload.max_tokens = config.maxTokens;
  // 显式写入，避免部分网关在缺省时仍开启思考
  payload.enable_thinking = ENABLE_THINKING === true;

  const response = await fetch(normalizeBaseUrl(config.baseUrl) + '/v1/chat/completions', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: abortSignal
  });

  await ensureOk(response);

  if (payload.stream && response.body) {
    return (async function* () {
      for await (const event of readSSEPayloads(response)) {
        const chunk = normalizeOpenAIChunk(event);
        if (chunk) yield chunk;
      }
    })();
  }

  return normalizeOpenAIChunk(await parseJsonSafe(response)) || {};
}
`.trim()

const buildOpenAIResponsesTemplate = (modelId: string, enableThinking = false) => `
async function processModel(input, config, fetch, abortSignal) {
${buildCommonHelpers()
  .replace('__MODEL_ID__', JSON.stringify(modelId))
  .replace('__ENABLE_THINKING__', JSON.stringify(enableThinking))
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}

  const runtimeModelId = getRuntimeModelId();
  const payload = {
    model: runtimeModelId,
    input: buildResponsesInput(input.messages || []),
    stream: input.stream !== false
  };

  if (input.tools && input.tools.length) {
    payload.tools = input.tools.map(mapResponseTool).filter(Boolean);
  }
  if (ENABLE_THINKING) {
    payload.reasoning = { effort: 'medium' };
  }

  const response = await fetch(normalizeBaseUrl(config.baseUrl) + '/v1/responses', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: abortSignal
  });

  await ensureOk(response);

  if (payload.stream && response.body) {
    return (async function* () {
      const toolCallState = new Map();

      for await (const event of readSSEPayloads(response)) {
        const eventType = event && event.type ? event.type : '';

        if (eventType === 'response.output_text.delta' && typeof event.delta === 'string') {
          yield { ...event, content: event.delta };
          continue;
        }

        if (eventType.includes('reasoning') && typeof event.delta === 'string') {
          yield { ...event, reasoning_content: event.delta };
          continue;
        }

        if (eventType === 'response.output_item.added' && event.item && event.item.type === 'function_call') {
          const state = {
            id: event.item.call_id || event.item.id || 'function_call',
            name: event.item.name || ''
          };
          toolCallState.set(event.item.id || state.id, state);
          yield {
            ...event,
            tool_calls: [
              {
                id: state.id,
                function: {
                  name: state.name,
                  arguments: ''
                }
              }
            ]
          };
          continue;
        }

        if (eventType === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
          const state = toolCallState.get(event.item_id) || {
            id: event.call_id || event.item_id || 'function_call',
            name: ''
          };
          yield {
            ...event,
            tool_calls: [
              {
                id: state.id,
                function: {
                  name: state.name,
                  arguments: event.delta
                }
              }
            ]
          };
          continue;
        }

        if (event.usage) {
          yield event;
        }
      }
    })();
  }

  return normalizeResponsesPayload(await parseJsonSafe(response)) || {};
}
`.trim()

const buildAnthropicTemplate = (modelId: string, enableThinking = false) => `
async function processModel(input, config, fetch, abortSignal) {
${buildCommonHelpers()
  .replace('__MODEL_ID__', JSON.stringify(modelId))
  .replace('__ENABLE_THINKING__', JSON.stringify(enableThinking))
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}

  const runtimeModelId = getRuntimeModelId();
  const prepared = buildAnthropicMessages(input.messages || []);
  const payload = {
    model: runtimeModelId,
    max_tokens: typeof config.maxTokens === 'number' ? config.maxTokens : 4096,
    messages: prepared.messages,
    stream: input.stream !== false
  };

  if (prepared.system) {
    payload.system = prepared.system;
  }

  if (input.tools && input.tools.length) {
    payload.tools = input.tools.map(mapAnthropicTool).filter(Boolean);
  }
  if (ENABLE_THINKING) {
    payload.thinking = { type: 'adaptive', display: 'summarized' };
  }

  const response = await fetch(normalizeBaseUrl(config.baseUrl) + '/v1/messages', {
    method: 'POST',
    headers: buildHeaders({
      'anthropic-version': '2023-06-01'
    }),
    body: JSON.stringify(payload),
    signal: abortSignal
  });

  await ensureOk(response);

  if (payload.stream && response.body) {
    return (async function* () {
      const blockState = new Map();

      for await (const event of readSSEPayloads(response)) {
        if (event.type === 'content_block_start' && event.content_block) {
          blockState.set(event.index, event.content_block);

          if (event.content_block.type === 'tool_use') {
            yield {
              ...event,
              tool_calls: [
                {
                  id: event.content_block.id || 'tool_use',
                  function: {
                    name: event.content_block.name || '',
                    arguments: event.content_block.input ? JSON.stringify(event.content_block.input) : ''
                  }
                }
              ]
            };
          }
          continue;
        }

        if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
            yield { ...event, content: event.delta.text };
            continue;
          }

          if (event.delta.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
            yield { ...event, reasoning_content: event.delta.thinking };
            continue;
          }

          if (event.delta.type === 'input_json_delta' && typeof event.delta.partial_json === 'string') {
            const block = blockState.get(event.index) || {};
            yield {
              ...event,
              tool_calls: [
                {
                  id: block.id || 'tool_use',
                  function: {
                    name: block.name || '',
                    arguments: event.delta.partial_json
                  }
                }
              ]
            };
            continue;
          }
        }

        if (event.usage) {
          yield event;
        }
      }
    })();
  }

  return normalizeAnthropicPayload(await parseJsonSafe(response)) || {};
}
`.trim()

export const buildPresetProcessModelJsCode = (options: {
  protocol?: ApiProtocol
  modelId?: string
  enableThinking?: boolean
}): string => {
  const protocol = normalizeApiProtocol(options.protocol)
  const modelId = options.modelId?.trim() || ''
  const enableThinking = options.enableThinking === true

  switch (protocol) {
    case 'openai-response':
      return buildOpenAIResponsesTemplate(modelId, enableThinking)
    case 'anthropic':
      return buildAnthropicTemplate(modelId, enableThinking)
    case 'custom':
    case 'openai-chat':
    default:
      return buildOpenAIChatTemplate(modelId, enableThinking)
  }
}

export const resolveExecutableModelJsCode = (
  model?: Partial<Pick<AIModel, 'apiProtocol' | 'jsCode' | 'modelId' | 'id' | 'enableThinking'>>
): string => {
  if (!model) return ''

  const protocol = normalizeApiProtocol(model.apiProtocol)
  if (protocol === 'custom') {
    return model.jsCode?.trim() || ''
  }

  return buildPresetProcessModelJsCode({
    protocol,
    modelId: resolveRuntimeModelId(model),
    enableThinking: model.enableThinking === true
  })
}
