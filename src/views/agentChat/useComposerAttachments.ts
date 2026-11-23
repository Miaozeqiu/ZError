import { onScopeDispose, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { addComposerAttachment, addComposerImage, composerAttachments } from '../../services/agent/chatStore'
import { agentAttachmentKind, agentImageMime, AGENT_ATTACHMENT_EXTENSIONS, MAX_AGENT_ATTACHMENT_BYTES, MAX_AGENT_IMAGES } from '../../services/agent/attachmentFiles'
import { isTauriEnvironment } from '../../services/app/environmentDetector'
import { readFileBase64 } from '../../utils/ui/fileReader'

/** 选择、拖入和粘贴共用附件处理；异步读取不能落到后来切换的对话中。 */
export function useComposerAttachments(options: { version: () => number; active: () => boolean }) {
  const imageError = ref('')
  const readingImages = ref(false)
  let disposed = false, pending = 0
  let queue = Promise.resolve()
  onScopeDispose(() => { disposed = true })
  const enqueue = (work: (current: () => boolean) => Promise<void>) => {
    const version = options.version()
    const current = () => !disposed && options.version() === version && options.active()
    pending++; readingImages.value = true
    const task = queue.then(async () => {
      if (!current()) return
      imageError.value = ''
      await work(current)
    }).catch(() => { if (current()) imageError.value = '无法读取部分附件，请重新选择。' })
      .finally(() => { pending--; readingImages.value = pending > 0 })
    queue = task
    return task
  }
  const addImage = (imageUrl: string, fileName: string, filePath?: string) => {
    if (!/^data:image\/[^;,]+;base64,.+/i.test(imageUrl)) throw new Error('无法读取此图片')
    if (!addComposerImage({ imageUrl, fileName, filePath, mimeType:imageUrl.slice(5,imageUrl.indexOf(';')) || 'image/png' })) {
      imageError.value = `一次最多附带 ${MAX_AGENT_IMAGES} 张图片`
    }
  }
  const readPaths = async (paths: string[], current: () => boolean) => {
    const failures = new Set<string>()
    for (const path of new Set(paths)) {
      if (!current()) break
      const name = path.split(/[/\\]/).pop() || '附件'
      const kind = agentAttachmentKind(name)
      if (!kind) { failures.add('已跳过不支持的文件格式'); continue }
      if (composerAttachments.value.some(item => item.filePath === path)) continue
      try {
        const stat = await invoke<{ size: number; isFile: boolean }>('stat_local_file', { path })
        if (!current()) break
        if (!stat.isFile) { failures.add('不支持添加文件夹'); continue }
        if (stat.size > MAX_AGENT_ATTACHMENT_BYTES) { failures.add('单个附件不能超过 40 MB'); continue }
        if (kind === 'file') addComposerAttachment(path)
        else {
          if (composerAttachments.value.filter(item=>item.kind === 'image').length >= MAX_AGENT_IMAGES) { failures.add(`一次最多附带 ${MAX_AGENT_IMAGES} 张图片`); continue }
          const bytes = await readFileBase64(path)
          if (current()) addImage(`data:${agentImageMime(name)};base64,${bytes}`, name, path)
        }
      } catch { failures.add('部分附件无法读取，请重新选择') }
    }
    if (current() && failures.size) imageError.value = [...failures].join('；')
  }
  const addAttachmentPaths = (paths: string[]) => enqueue(current => readPaths(paths, current))
  const addAttachments = async () => {
    if (readingImages.value) return
    if (!isTauriEnvironment()) { imageError.value = '请在桌面软件中选择文档；图片也可以直接拖入或粘贴。'; return }
    await enqueue(async current => {
      const selected = await open({title:'选择附件',multiple:true,directory:false,filters:[{name:'文件和图片',extensions:AGENT_ATTACHMENT_EXTENSIONS}]})
      if (current()) await readPaths(Array.isArray(selected) ? selected : selected ? [selected] : [], current)
    })
  }
  const readBrowserFiles = (files: File[], clipboard = false) => enqueue(async current => {
    const failures = new Set<string>()
    for (const file of files) {
      if (!current()) break
      const path = (file as File & { path?: string }).path
      if (path) { await readPaths([path], current); continue }
      const kind = agentAttachmentKind(file.name) || (clipboard && /^image\/(png|jpeg|gif|webp)$/i.test(file.type) ? 'image' : null)
      if (!kind) { failures.add('已跳过不支持的文件格式'); continue }
      if (kind !== 'image') { failures.add('请在桌面软件中拖入文档，或使用「文件/图片」选择'); continue }
      if (file.size > MAX_AGENT_ATTACHMENT_BYTES) { failures.add('单个附件不能超过 40 MB'); continue }
      try {
        const imageUrl = await new Promise<string>((resolve,reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        if (current()) addImage(imageUrl, file.name || '图片')
      } catch { failures.add('部分图片无法读取，请重新选择') }
    }
    if (current() && failures.size) imageError.value = [...failures].join('；')
  })
  // 剪贴板图片没有磁盘路径，沿用 FileReader 和现有图片附件限制。
  const addDroppedFiles = (files: File[]) => readBrowserFiles(files)
  const pasteImages = (files: File[]) => readBrowserFiles(files, true)
  return { imageError, readingImages, addAttachments, addAttachmentPaths, addDroppedFiles, pasteImages }
}
