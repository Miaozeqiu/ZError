import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { d2Assets } from './scripts/vite/d2Assets';
import { mermaidParser } from './scripts/vite/mermaidParser';
import { sharedChunks } from './scripts/vite/sharedChunks';
import { resolve } from 'path';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { IconifyJSON } from '@iconify/types';

const host = process.env.TAURI_DEV_HOST;

// IDE regression pages stay available during development and never ship in the app.
const devRegressionPagesPlugin = (): Plugin => ({
  name: 'dev-regression-pages',
  apply: 'serve',
  configureServer(server) {
    const pages = new Set(['/push-fixture.html', '/ckplayer-catalog.html'])
    server.middlewares.use('/e2e', (req, res, next) => {
      const page = (req.url || '').split('?')[0]
      if (!pages.has(page) || !['GET', 'HEAD'].includes(req.method || '')) return next()
      try {
        const html = readFileSync(resolve(__dirname, 'testdata/browser/fixtures', page.slice(1)), 'utf8')
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(req.method === 'HEAD' ? undefined : html)
      } catch (error) {
        next(error)
      }
    })
  },
})

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

// Include only the offline Lucide icons used by the app.
const agentIconNames = [
  'globe',
  'github',
  'settings-2',
  'square-pen',
  'key-round',
  'external-link',
  'trash',
  'monitor',
  'maximize-2',
  'minimize-2',
  'x',
  'plus',
  'paperclip',
  'folder-plus',
  'search',
  'eye',
  'copy',
  'quote',
  'eye-off',
  'volume-2',
  'volume-x',
  'link',
  'refresh-cw',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'mouse-pointer-click',
  'square-mouse-pointer',
  'keyboard',
  'arrow-up-down',
  'code-xml',
  'camera',
  'list-checks',
  'workflow',
  'network',
  'share-2',
  'clock',
  'check',
  'play',
  'book-open',
  'notebook-pen',
  'shield',
  'circle-dot',
  'circle-check',
  'circle-minus',
  'circle',
] as const
const lucide: IconifyJSON = JSON.parse(readFileSync(
  resolve(__dirname, 'node_modules/@iconify-json/lucide/icons.json'), 'utf8',
));
const agentLucideIcons: IconifyJSON = {
  prefix: lucide.prefix,
  width: lucide.width,
  height: lucide.height,
  icons: Object.fromEntries(agentIconNames.map(name => {
    const icon = lucide.icons[name];
    if (!icon) throw new Error(`Unknown Lucide icon: ${name}`);
    return [name, icon];
  })),
};

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), d2Assets(), mermaidParser(), agentDebugLogPlugin(), devRegressionPagesPlugin()],
  define: { __AGENT_LUCIDE_ICONS__: JSON.stringify(agentLucideIcons) },
  // 数据脚本的 WASM 加载器使用动态导入；合成单个经典 Worker，兼容旧版 WKWebView。
  worker: { rollupOptions: { output: { inlineDynamicImports: true } } },
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@terrastruct/d2': resolve(__dirname, 'node_modules/@terrastruct/d2/dist/browser/index.js'),
    },
  },

  build: {
    rollupOptions: {
      output: { manualChunks: sharedChunks },
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

  // Restrict test discovery before traversal: native build trees and local logs
  // contain many files and are unrelated to frontend contract tests.
  test: {
    include: ['testdata/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/target/**', '**/logs/**', '**/dist/**'],
  },
  
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
    proxy: {
      '/__agent-bridge': {
        target: 'http://127.0.0.1:1429',
        rewrite: path => path.replace(/^\/__agent-bridge/, ''),
      },
    },
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
