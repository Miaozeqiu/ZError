import { describe, expect, it } from 'vitest'
import { build, createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root=fileURLToPath(new URL('../../',import.meta.url))
describe('数据脚本执行环境的开发和安装包构建',()=>{
  it('开发服务器提供模块入口，实际构造使用模块 Worker',async()=>{
    const server=await createServer({root,configFile:false,logLevel:'silent',optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false,watch:null}})
    try {
      const result=await server.transformRequest('/src/services/script/dataScript.ts')
      expect(result?.code).toContain('worker_file&type=module')
      expect(result?.code).toMatch(/type:\s*["']module["']/)
      const worker=await server.transformRequest('/src/services/script/dataScriptWorker.ts?worker_file&type=module')
      expect(worker?.code).toContain('dataScriptRuntime')
    } finally {await server.close()}
  })
  it('正式打包的 Worker 无需模块加载，即可作为经典脚本初始化',async()=>{
    const result=await build({root,configFile:false,logLevel:'silent',publicDir:false,
      worker:{rollupOptions:{output:{inlineDynamicImports:true}}},
      build:{write:false,minify:true,rollupOptions:{input:fileURLToPath(new URL('../../src/services/script/dataScript.ts',import.meta.url))}},
    })
    const outputs=(Array.isArray(result)?result:[result]).flatMap(bundle=>'output' in bundle?bundle.output:[])
    const workers=outputs.filter(item=>item.type==='asset'&&/dataScriptWorker-.*\.js$/.test(item.fileName))
    expect(workers.length).toBeGreaterThan(0)
    for(const worker of workers){
      const self:{onmessage?:unknown}={}
      runInNewContext(String((worker as any).source),{self,TextEncoder,TextDecoder,URL,performance},{timeout:1000})
      expect(typeof self.onmessage).toBe('function')
    }
  })
})
