import type { GetManualChunk } from 'rollup'

/** Keep shared service and tool boundaries explicit so dynamic imports remain useful. */
const sharedModules = new Set([
  'security/secureStore', 'security/secureFetch', 'app/settings', 'model/config',
  'browser/control', 'browser/eval', 'browser/protocol', 'browser/appBrowser',
  'browser/videoWatch', 'browser/siteGraphCore', 'browser/siteGraphSave', 'browser/siteGraph',
  'agent/websiteRepository', 'agent/skillRuntime', 'agent/chatWatch', 'agent/chatStore',
  'agent/agentSkills', 'agent/agentLessons', 'agent/finishGate', 'agent/agentBrowser',
  'agent/executeChatTool', 'agent/subagent/runtime',
])
// Runtime services are acyclic and may be loaded independently.
const watchModules = new Set([
  'browser/abstractions',
  'platform/panelAccess', 'agent/agentWait', 'browser/videoWatchAgent',
  'platform/watchBind', 'platform/index',
])

export const sharedChunks: GetManualChunk = id => {
  if (id === '\0virtual:zerror-mermaid-protocol') return 'mermaid-protocol'
  if (id === '\0virtual:zerror-mermaid-grammars') return 'mermaid-grammars'
  const normalized = id.replaceAll('\\', '/')
  const local = normalized.split('/src/services/')[1]?.replace(/\.ts$/, '')
  if (watchModules.has(local)) return 'shared-' + local.replaceAll('/', '-')
  if (sharedModules.has(local)) return 'shared-' + local.replaceAll('/', '-')
  if (/\/node_modules\/@tauri-apps\//.test(normalized)) return 'tauri-api'
  if (/\/node_modules\/vue\/|\/node_modules\/@vue\//.test(normalized)) return 'vue'
  if (/\/node_modules\/(?:@codemirror|@lezer)\//.test(normalized)) {
    const grammar = /\/node_modules\/(?:@codemirror|@lezer)\/(?:lang-|javascript|json|markdown)/.test(normalized)
    return grammar ? 'code-languages' : 'code-editor'
  }
  if (/\/node_modules\/highlight.js\//.test(normalized)) return 'code-highlight'
  if (/\/node_modules\/acorn\//.test(normalized)) return 'javascript-parser'
  if (/\/node_modules\/stream-markdown-parser\//.test(normalized)) return 'markdown-parser'
  if (/\/node_modules\/mermaid\/dist\/chunks\/mermaid.core\/chunk-/.test(normalized)) {
    return 'mermaid-' + normalized.split('/').at(-1)?.replace(/\.mjs$/, '')
  }
  if (/\/node_modules\/@antv\/infographic\/esm\/designs\//.test(normalized)) return 'infographic-designs'
  if (/\/node_modules\/@antv\/infographic\/esm\/(?:renderer|resource|utils)\//.test(normalized)) return 'infographic-renderer'
  if (/\/node_modules\/(?:@xmldom|dingbat-to-unicode|jszip)\//.test(normalized)) return 'document-shared'
}
