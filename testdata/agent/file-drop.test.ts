// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { useAgentFileDrop } from '../../src/views/agentChat/useAgentFileDrop'
const native = vi.hoisted(() => ({ enabled:true, listen:vi.fn() }))
vi.mock('../../src/services/app/environmentDetector',()=>({isTauriEnvironment:()=>native.enabled}))
vi.mock('@tauri-apps/api/webview',()=>({getCurrentWebview:()=>({onDragDropEvent:native.listen})}))
let app:App, root:HTMLDivElement, current:ReturnType<typeof useAgentFileDrop>, nativeEvent:(event:any)=>void
const enabled=ref(true), paths=vi.fn(async()=>{}), files=vi.fn(async()=>{}), error=vi.fn(), stop=vi.fn()
const payload=(event:any)=>nativeEvent({payload:event})
const event = (kind='file', data:File[]=[]) => ({
  preventDefault:vi.fn(),stopPropagation:vi.fn(),dataTransfer:{types:kind==='file'?['Files']:['text/plain'],files:data,dropEffect:'none'},
} as any)
const mount = async () => {
  root=document.createElement('div');document.body.append(root)
  app=createApp({setup(){
    const target=ref<HTMLElement|null>(null)
    current=useAgentFileDrop({target,enabled:()=>enabled.value,paths,files,error})
    return ()=>h('section',{ref:target},current.hovering.value?h('span',{role:'status'},current.message.value):[])
  }})
  app.mount(root)
  vi.spyOn(root.firstElementChild!,'getBoundingClientRect').mockReturnValue({left:100,top:50,right:500,bottom:350,width:400,height:300} as any)
  await vi.dynamicImportSettled(); await nextTick()
}
beforeEach(()=>{
  vi.clearAllMocks();enabled.value=true;native.enabled=true
  vi.stubGlobal('devicePixelRatio',2)
  native.listen.mockImplementation(async handler=>{nativeEvent=handler;return stop})
})
afterEach(()=>{app?.unmount();root?.remove();vi.unstubAllGlobals()})
describe('Agent 文件拖入',()=>{
  it('Retina 坐标正确落入对话区，拖出或取消时清除提示',async()=>{
    await mount()
    payload({type:'enter',paths:['/tmp/题库.DOCX'],position:{x:220,y:120}});await nextTick()
    expect(root.textContent).toBe('松开即可添加')
    payload({type:'over',position:{x:1020,y:120}});await nextTick();expect(root.textContent).toBe('')
    payload({type:'over',position:{x:220,y:120}});await nextTick();expect(current.hovering.value).toBe(true)
    payload({type:'leave'});await nextTick();expect(current.hovering.value).toBe(false)
  })
  it('无 enter 也能接收原生多文件 drop，同一次 DOM drop 不重复添加',async()=>{
    await mount()
    const input=['C:\\Users\\学生\\试题.docx','/tmp/image.png']
    payload({type:'drop',paths:input,position:{x:220,y:120}})
    current.drop(event('file',[new File(['data'],'image.png',{type:'image/png'})]))
    expect(paths).toHaveBeenCalledExactlyOnceWith(input);expect(files).not.toHaveBeenCalled()
    expect(current.hovering.value).toBe(false)
  })
  it('在其他面板、弹窗或隐藏页面上不接收文件',async()=>{
    await mount()
    payload({type:'drop',paths:['/tmp/a.pdf'],position:{x:1200,y:120}})
    payload({type:'enter',paths:['/tmp/a.pdf'],position:{x:220,y:120}})
    enabled.value=false;await nextTick();expect(current.hovering.value).toBe(false)
    payload({type:'drop',paths:['/tmp/a.pdf'],position:{x:220,y:120}})
    expect(paths).not.toHaveBeenCalled()
  })
  it('显示不支持格式，混合文件仍允许加入支持的附件',async()=>{
    await mount()
    payload({type:'enter',paths:['/tmp/a.exe'],position:{x:220,y:120}});await nextTick()
    expect(root.textContent).toBe('不支持此文件类型')
    payload({type:'enter',paths:['/tmp/a.exe','/tmp/a.pdf'],position:{x:220,y:120}});await nextTick()
    expect(root.textContent).toBe('松开即可添加')
  })
  it('网页后备入口处理多文件和嵌套 dragenter，不干预文字拖动',async()=>{
    native.enabled=false;await mount()
    const text=event('text');current.enter(text);current.over(text);current.drop(text)
    expect(text.preventDefault).not.toHaveBeenCalled()
    current.enter(event());current.enter(event());current.leave(event());expect(current.hovering.value).toBe(true)
    const input=[new File(['image'],'image.png',{type:'image/png'})]
    const dropped=event('file',input);current.drop(dropped)
    expect(files).toHaveBeenCalledExactlyOnceWith(input);expect(dropped.preventDefault).toHaveBeenCalled()
    expect(current.hovering.value).toBe(false)
  })
  it('Escape 取消，卸载时释放原生和窗口监听，晚到事件无效',async()=>{
    await mount()
    payload({type:'enter',paths:['/tmp/a.pdf'],position:{x:220,y:120}})
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(current.hovering.value).toBe(false)
    app.unmount();expect(stop).toHaveBeenCalledOnce()
    payload({type:'drop',paths:['/tmp/a.pdf'],position:{x:220,y:120}});expect(paths).not.toHaveBeenCalled()
  })
  it('原生监听晚于卸载才完成时也立即释放，注册失败则保留后备入口',async()=>{
    let complete:(stop:()=>void)=>void
    native.listen.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
    await mount();app.unmount();complete!(stop);await vi.dynamicImportSettled();expect(stop).toHaveBeenCalledOnce()
  })
})
