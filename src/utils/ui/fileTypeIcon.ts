import { addCollection } from '@iconify/vue/offline'
import type { IconifyJSON } from '@iconify/types'
import vscodeFileIcons from './vscodeFileIcons.json'

addCollection(vscodeFileIcons as IconifyJSON)

const FILE_TYPE_ICONS: Record<string, string> = {
  md: 'file-type-markdown',
  mdown: 'file-type-markdown',
  markdown: 'file-type-markdown',
  js: 'file-type-js',
  mjs: 'file-type-js',
  cjs: 'file-type-js',
  jsx: 'file-type-reactjs',
  ts: 'file-type-typescript',
  cts: 'file-type-typescript',
  mts: 'file-type-typescript',
  tsx: 'file-type-reactts',
  json: 'file-type-json',
  yml: 'file-type-yaml',
  yaml: 'file-type-yaml',
  html: 'file-type-html',
  htm: 'file-type-html',
  css: 'file-type-css',
  scss: 'file-type-scss',
  less: 'file-type-less',
  vue: 'file-type-vue',
  txt: 'file-type-text',
  log: 'file-type-text',
  pdf: 'file-type-pdf2',
  doc: 'file-type-word',
  docx: 'file-type-word',
  xls: 'file-type-excel',
  xlsx: 'file-type-excel',
  csv: 'file-type-excel',
  py: 'file-type-python',
  rs: 'file-type-rust',
  toml: 'file-type-toml',
  svg: 'file-type-svg',
  png: 'file-type-image',
  jpg: 'file-type-image',
  jpeg: 'file-type-image',
  gif: 'file-type-image',
  webp: 'file-type-image',
  sh: 'file-type-shell',
  bash: 'file-type-shell',
}

const iconId = (name: string) => `vscode-icons:${name}`

export const fileTypeIconName = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return iconId(FILE_TYPE_ICONS[ext] || 'default-file')
}

export const folderTypeIconName = (open = false, kind = '') => {
  if (kind === 'parser' || kind === 'folder-type-js') {
    return iconId(open ? 'folder-type-js-opened' : 'folder-type-js')
  }
  return iconId(open ? 'default-folder-opened' : 'default-folder')
}

export const resolveFileIconName = (opts: {
  name?: string
  folder?: boolean
  open?: boolean
  icon?: string
}) => {
  if (opts.icon) {
    const base = opts.icon.replace(/^vscode-icons:/, '')
    if (opts.folder && opts.open && !base.endsWith('-opened')) return iconId(`${base}-opened`)
    return iconId(base)
  }
  if (opts.folder) return folderTypeIconName(Boolean(opts.open))
  return fileTypeIconName(opts.name || '')
}
