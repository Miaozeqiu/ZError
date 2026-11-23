import releaseSync from '@jitl/quickjs-wasmfile-release-sync'
import releaseWasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import { memoizePromiseFactory, newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core'

// 开发和安装包共用同一 WASM 资源定位；不依赖用户安装 Node 或 Python。
export const getQuickJS = memoizePromiseFactory(() => newQuickJSWASMModuleFromVariant(
  typeof window === 'undefined' && !('WorkerGlobalScope' in globalThis) ? releaseSync : newVariant(releaseSync, { wasmLocation: releaseWasmUrl }),
))
