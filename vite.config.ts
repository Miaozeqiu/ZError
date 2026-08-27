import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from 'path';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const agentDebugLogPlugin = (): Plugin => ({
  name: 'agent-debug-log',
  configureServer(server) {
    const dir = resolve(__dirname, 'logs', 'agent-chat')
    server.middlewares.use('/__agent-debug-log', (req, res, next) => {
      if (req.method !== 'POST') {
        next()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
            file?: string
            entry?: Record<string, unknown>
            replace?: boolean
            ext?: string
            text?: string
          }
          const ext = body.ext === 'md' ? 'md' : body.ext === 'html' ? 'html' : body.ext === 'json' ? 'json' : 'txt'
          const rawFile = String(body.file || 'session')
          const dumpRel = rawFile.startsWith('chaoxing-parse/')
            ? rawFile.replace(/\.\./g, '').replace(/[^a-zA-Z0-9/._-]+/g, '_').slice(0, 180)
            : ''
          if (dumpRel) {
            const dest = resolve(__dirname, 'logs', `${dumpRel}.${ext}`)
            mkdirSync(resolve(dest, '..'), { recursive: true })
            writeFileSync(dest, typeof body.text === 'string' ? body.text : '')
            res.statusCode = 204
            res.end()
            return
          }
          const file = rawFile.replace(/[^\w.-]+/g, '_').slice(0, 80)
          mkdirSync(dir, { recursive: true })
          if (body.replace && typeof body.text === 'string') {
            writeFileSync(resolve(dir, `${file}.${ext === 'md' ? 'md' : 'txt'}`), body.text)
          } else {
            appendFileSync(
              resolve(dir, `${file}.jsonl`),
              `${JSON.stringify({ ts: new Date().toISOString(), ...body.entry })}\n`,
            )
          }
          res.statusCode = 204
          res.end()
        } catch (error) {
          res.statusCode = 400
          res.end(error instanceof Error ? error.message : String(error))
        }
      })
    })
  },
})

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), agentDebugLogPlugin()],
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@terrastruct/d2': resolve(__dirname, 'node_modules/@terrastruct/d2/dist/browser/index.js'),
    },
  },

  build: {
    // 禁用类型检查以加快构建速度
    rollupOptions: {
      onwarn(warning, warn) {
        // 忽略 TypeScript 相关的警告
        if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return;
        warn(warning);
      }
    },
    // 确保静态资源被复制到构建输出
    copyPublicDir: true,
    assetsDir: 'assets',
    // 配置静态资源处理
    assetsInlineLimit: 0, // 禁用内联，确保图片作为独立文件
  },

  // 配置静态资源目录
  publicDir: 'public',
  
  // 确保 src/assets 中的文件被处理
  assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.webp', '**/*.wasm'],
  optimizeDeps: {
    exclude: ['@terrastruct/d2'],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/logs/**"],
    },
  },
}));
