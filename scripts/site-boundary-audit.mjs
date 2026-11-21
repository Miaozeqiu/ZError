import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const signal = /chaoxing|zjooc|zhihuishu|学习通|在浙学|智慧树|registerSiteBrowserAdapter/i
const dedicated = /(?:\/chaoxing\/|\/zjooc\/|\/skills\/chaoxing\.ts$|\/fontDecrypt\/chaoxing\.ts$|\/legacyWebsiteTools\.ts$|\/chaoxingStartup\.ts$|\/tools\/zjoocAnswers\.ts$|\/tools\/website(?:Chapters|Chapter\w*|Homework\w*|Courses|Login|Playback)\.ts$)/
const walk = (root, relative) => readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
  const file = relative + '/' + entry.name
  return entry.isDirectory() ? walk(root, file) : /\.(?:ts|js|rs|vue|html)$/.test(entry.name) ? [file] : []
})

export function inspectSiteBoundaries(root = process.cwd()) {
  const files = {}
  for (const file of [...walk(root, 'src'), ...walk(root, 'src-tauri/src'), ...walk(root, 'public')].sort()) {
    const lines = readFileSync(path.join(root, file), 'utf8').split('\n')
    const signals = lines.filter(line => signal.test(line)).length
    const platformFile = dedicated.test(file)
    if (signals || platformFile) files[file] = { signals, ...(platformFile ? { maxLines: lines.filter(line => line.trim()).length } : {}) }
  }
  return files
}

export function compareSiteBoundaries(current, baseline) {
  const errors = []
  for (const [file, entry] of Object.entries(current)) {
    const allowed = baseline[file]
    if (!allowed) { errors.push('新增平台实现或平台耦合入口：' + file); continue }
    if (entry.signals > allowed.signals) errors.push('平台特判数量增加：' + file)
    if (entry.maxLines !== undefined && (allowed.maxLines === undefined || entry.maxLines > allowed.maxLines)) errors.push('平台专用文件扩大：' + file)
  }
  return errors
}
