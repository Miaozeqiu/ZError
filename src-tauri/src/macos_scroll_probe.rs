//! Opt-in debug-only geometry probe (ZERROR_SCROLL_TRACE=1). Contains no page or input text.
use std::{cell::{Cell, RefCell}, collections::VecDeque, ptr::NonNull, time::{SystemTime, UNIX_EPOCH}, sync::OnceLock};
use block2::RcBlock;
use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSView};
use objc2_core_graphics::{CGEvent, CGEventField};
use objc2_foundation::{NSString, NSTimer, NSRunLoop, NSRunLoopCommonModes};
thread_local! {
    static PRIMED: Cell<bool> = const { Cell::new(false) };
    static EVENTS: RefCell<VecDeque<serde_json::Value>> = RefCell::new(VecDeque::new());
    static TIMER: RefCell<Option<Retained<NSTimer>>> = const { RefCell::new(None) };
}
const SCRIPT: &str = r#"(()=>{
const p=document.querySelector('.chat-thread');if(!p)return JSON.stringify({mounted:false});
const s=window.__zerrorScrollProbe??={events:[]};
const record=(kind,extra={})=>{s.events.push({at:Date.now(),kind,top:p.scrollTop,height:p.scrollHeight,client:p.clientHeight,...extra});if(s.events.length>1500)s.events.splice(750,1)};
if(s.pane!==p){s.pane=p;record('mount');
 const d=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
 Object.defineProperty(p,'scrollTop',{configurable:true,get(){return d.get.call(this)},set(v){record('write',{value:v,stack:new Error().stack?.split('\n').slice(1,6).join('\n')});d.set.call(this,v)}});
 p.addEventListener('wheel',e=>record('wheel',{x:e.deltaX,y:e.deltaY,mode:e.deltaMode}),{passive:true,capture:true});
 p.addEventListener('scroll',()=>record('scroll'),{passive:true});
 const ro=new ResizeObserver(()=>record('resize'));ro.observe(p);for(const c of p.children)ro.observe(c);
}
record('sample');return JSON.stringify({events:s.events});
})()"#;
pub fn event(view: &NSView, stage: &str, event: &NSEvent) {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    if !ENABLED.get_or_init(|| std::env::var_os("ZERROR_SCROLL_TRACE").as_deref() == Some(std::ffi::OsStr::new("1"))) { return; }
    unsafe {
    let cg=event.CGEvent();
    let field=|f|cg.as_ref().map(|e|CGEvent::double_value_field(Some(e),f));
    let entry=serde_json::json!({"at":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        "stage":stage,"kind":event.r#type().0,"x":event.scrollingDeltaX(),"y":event.scrollingDeltaY(),
        "precise":event.hasPreciseScrollingDeltas(),"phase":event.phase().0,"momentum":event.momentumPhase().0,
        "pointY":field(CGEventField::ScrollWheelEventPointDeltaAxis1),
        "fixedY":field(CGEventField::ScrollWheelEventFixedPtDeltaAxis1),
        "acceleratedY":field(CGEventField::ScrollWheelEventAcceleratedDeltaAxis1)});
    EVENTS.with(|events|{let mut e=events.borrow_mut();e.push_back(entry);if e.len()>1500{e.remove(750);}});
    TIMER.with(|slot| {
        if slot.borrow().is_some(){return}
        let view=unsafe{Retained::retain(view as *const NSView as *mut NSView)}.unwrap();
        let callback=RcBlock::new(move |_:NonNull<NSTimer>| {
            TIMER.with(|slot|{slot.borrow_mut().take();});
            let native=EVENTS.with(|e|e.borrow().clone());
            let result=RcBlock::new(move |value:*mut AnyObject,error:*mut AnyObject| {
                if !error.is_null() || value.is_null(){return}
                let string=unsafe{&*(value as *const NSString)}.to_string();
                let js=serde_json::from_str::<serde_json::Value>(&string).unwrap_or_default();
                if let Ok(json)=serde_json::to_vec(&serde_json::json!({"native":native,"js":js})) {
                    let _=std::fs::write("/tmp/zerror-scroll-trace.json",json);
                }
            });
            let script=NSString::from_str(SCRIPT);
            unsafe {let _:()=msg_send![&*view,evaluateJavaScript:&*script,completionHandler:&*result];}
        });
        let delay=PRIMED.with(|p|if p.replace(true){0.5}else{0.001});
        let timer=NSTimer::timerWithTimeInterval_repeats_block(delay,false,&callback);
        NSRunLoop::mainRunLoop().addTimer_forMode(&timer,NSRunLoopCommonModes);
        *slot.borrow_mut()=Some(timer);
    });
}}
