// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { useComposerAttachments } from '../../src/views/agentChat/useComposerAttachments'
import { composerAttachments } from '../../src/services/agent/chatStore'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readFileBase64 } from '../../src/utils/ui/fileReader'
import { AGENT_ATTACHMENT_EXTENSIONS } from '../../src/services/agent/attachmentFiles'
vi.mock('../../src/services/agent/chatStore',async()=>{
  const {ref}=await import('vue'),composerAttachments=ref<any[]>([])
  return {composerAttachments,
    addComposerAttachment:(filePath:string)=>composerAttachments.value.push({kind:'file',filePath}),
    addComposerImage:(item:any)=>{
      if(composerAttachments.value.filter(item=>item.kind==='image').length>=4)return false
      composerAttachments.value.push({kind:'image',...item});return true
    },
  }
})
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}))
vi.mock('@tauri-apps/plugin-dialog',()=>({open:vi.fn()}))
vi.mock('../../src/utils/ui/fileReader',()=>({readFileBase64:vi.fn(async()=>'AA==')}))
vi.mock('../../src/services/app/environmentDetector',()=>({isTauriEnvironment:()=>true}))
let app:App,root:HTMLDivElement,api:ReturnType<typeof useComposerAttachments>,version=0
beforeEach(()=>{
  vi.clearAllMocks();composerAttachments.value=[];version=0
  vi.mocked(invoke).mockImplementation(async(_command,args:any)=>({size:100,isFile:!args.path.includes('directory')}) as any)
  vi.mocked(readFileBase64).mockResolvedValue('AA==')
  root=document.createElement('div');document.body.append(root)
  app=createApp({setup(){api=useComposerAttachments({version:()=>version,active:()=>true});return()=>h('div')}});app.mount(root)
})
afterEach(()=>{app.unmount();root.remove()})
describe('文件选择与拖入共用的附件处理',()=>{
  it('选择器与拖入使用同一格式列表，原生文档和图片进入各自附件类型且去重',async()=>{
    vi.mocked(open).mockResolvedValue(['/tmp/questions.DOCX','/tmp/photo.JPG'])
    await api.addAttachments()
    expect(vi.mocked(open).mock.calls[0][0]!.filters![0].extensions).toEqual(AGENT_ATTACHMENT_EXTENSIONS)
    expect(composerAttachments.value).toEqual([expect.objectContaining({kind:'file',filePath:'/tmp/questions.DOCX'}),expect.objectContaining({kind:'image',fileName:'photo.JPG',mimeType:'image/jpeg'})])
    await api.addAttachmentPaths(['/tmp/questions.DOCX','/tmp/photo.JPG','/tmp/questions.DOCX'])
    expect(composerAttachments.value).toHaveLength(2);expect(readFileBase64).toHaveBeenCalledOnce()
  })
  it('混合拖入只加入支持的文件，拒绝文件夹、超大文件和失败读取并明确提示',async()=>{
    vi.mocked(invoke).mockImplementation(async(_command,args:any)=>{
      if(args.path.includes('broken'))throw new Error('unreadable')
      return {size:args.path.includes('large')?41*1024*1024:100,isFile:!args.path.includes('directory')} as any
    })
    await api.addAttachmentPaths(['/tmp/a.pdf','/tmp/a.exe','/tmp/directory.docx','/tmp/large.csv','/tmp/broken.txt'])
    expect(composerAttachments.value).toEqual([expect.objectContaining({filePath:'/tmp/a.pdf'})])
    expect(api.imageError.value).toMatch(/不支持.*文件夹.*40 MB.*无法读取/)
  })
  it('连续拖入串行处理，并发重复文件不会读两次',async()=>{
    await Promise.all([api.addAttachmentPaths(['/tmp/a.png']),api.addAttachmentPaths(['/tmp/a.png','/tmp/b.pdf'])])
    expect(composerAttachments.value).toHaveLength(2);expect(readFileBase64).toHaveBeenCalledOnce();expect(api.readingImages.value).toBe(false)
  })
  it('图片数量保持最多 4 张，仍继续接收同一批中的文档',async()=>{
    await api.addAttachmentPaths(['/tmp/1.png','/tmp/2.png','/tmp/3.png','/tmp/4.png','/tmp/5.png','/tmp/a.pdf'])
    expect(composerAttachments.value).toHaveLength(5);expect(readFileBase64).toHaveBeenCalledTimes(4)
    expect(api.imageError.value).toContain('4 张图片')
  })
  it('读取期间切换对话或卸载，不会把晚到的图片加入新对话',async()=>{
    let resolve!:(value:string)=>void
    vi.mocked(readFileBase64).mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
    const pending=api.addAttachmentPaths(['/tmp/a.png']);await vi.waitFor(()=>expect(readFileBase64).toHaveBeenCalled())
    version++;resolve('AA==');await pending
    expect(composerAttachments.value).toHaveLength(0)
    vi.mocked(readFileBase64).mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
    const late=api.addAttachmentPaths(['/tmp/a.png']);await vi.waitFor(()=>expect(readFileBase64).toHaveBeenCalledTimes(2))
    app.unmount();resolve('AA==');await late;expect(composerAttachments.value).toHaveLength(0)
  })
  it('网页图片后备入口保留图片数据，不把文档伪装成可读本地路径',async()=>{
    await api.addDroppedFiles([new File(['image'],'a.png',{type:'image/png'}),new File(['doc'],'a.docx')])
    expect(composerAttachments.value).toEqual([expect.objectContaining({kind:'image',fileName:'a.png',imageUrl:expect.stringContaining('data:image/png;base64,')})])
    expect(api.imageError.value).toContain('桌面软件')
    await api.pasteImages([new File(['image'],'blob',{type:'image/png'})]);expect(composerAttachments.value).toHaveLength(2)
  })
})
