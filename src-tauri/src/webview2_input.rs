//! Fixed locator probes followed by CDP input. No page script dispatches clicks or keystrokes.
use serde_json::{json, Value};
use tauri::{AppHandle, Webview};
use zeroize::Zeroizing;

const LOCATE: &str = include_str!("webview2_input.js");
const STALE: &str = "页面文档已变化，请重新读取后操作";

async fn cdp(view: &Webview, method: &'static str, args: Value) -> Result<Value, String> {
    crate::webview2::call(
        view,
        method,
        Zeroizing::new(args.to_string()),
        "Windows CDP 输入操作失败",
    )
    .await
}

async fn frame(view: &Webview) -> Result<Value, String> {
    let tree = cdp(view, "Page.getFrameTree", json!({})).await?;
    let row = tree["frameTree"]["frame"].clone();
    if row["id"].as_str().is_none() || row["loaderId"].as_str().is_none() {
        return Err(STALE.into());
    }
    Ok(row)
}

async fn verify(view: &Webview, expected: &Value) -> Result<(), String> {
    let current = frame(view).await?;
    if current["id"] != expected["id"]
        || current["loaderId"] != expected["loaderId"]
        || current["url"] != expected["url"]
    {
        return Err(STALE.into());
    }
    Ok(())
}

const PROBE: &str = r#"function(){
  if (this.nodeType!==1) return {ok:false,reason:this.reason||'invalid'};
  if (!this.isConnected) return {ok:false,reason:'not_found'};
  if (this.matches(':disabled,[aria-disabled="true"]')) return {ok:false,reason:'disabled'};
  this.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  const r=this.getBoundingClientRect();
  let x=r.left+r.width/2,y=r.top+r.height/2,win=this.ownerDocument.defaultView;
  if(r.width<1||r.height<1||this.ownerDocument.defaultView.getComputedStyle(this).visibility==='hidden') return {ok:false,reason:'hidden'};
  const hit=win.document.elementFromPoint(x,y);
  if(!hit || !(hit===this || this.contains(hit))) return {ok:false,reason:'covered'};
  try {
    while(win!==top){
      const f=win.frameElement,b=f.getBoundingClientRect();
      x=b.left+(x+f.clientLeft)*b.width/(f.offsetWidth||b.width);
      y=b.top+(y+f.clientTop)*b.height/(f.offsetHeight||b.height);
      win=f.ownerDocument.defaultView;
      if(win.document.elementFromPoint(x,y)!==f) return {ok:false,reason:'covered'};
    }
  }catch { return {ok:false,reason:'invalid'}; }
  return {ok:true,x,y,editable:this.isContentEditable||this.tagName==='TEXTAREA'||this.tagName==='INPUT',
    password:this.type==='password',readonly:!!this.readOnly,checked:!!this.checked,
    checkable:this.matches('input[type=checkbox],input[type=radio]')};
}"#;

async fn probe(view: &Webview, object: &str) -> Result<Value, String> {
    let raw = cdp(
        view,
        "Runtime.callFunctionOn",
        json!({"objectId":object,"functionDeclaration":PROBE,"returnByValue":true}),
    )
    .await?;
    Ok(raw["result"]["value"].clone())
}

async fn key(
    view: &Webview,
    name: &str,
    code: &str,
    vk: u32,
    modifiers: u32,
) -> Result<(), String> {
    // 按下事件超时也可能已生效，始终尝试释放；保留原始操作错误。
    let pressed = cdp(view,"Input.dispatchKeyEvent",json!({"type":"keyDown","key":name,"code":code,"windowsVirtualKeyCode":vk,"modifiers":modifiers,"text":if name=="Enter" {"\r"} else if name==" " {" "} else {""}})).await;
    let released = cdp(view,"Input.dispatchKeyEvent",json!({"type":"keyUp","key":name,"code":code,"windowsVirtualKeyCode":vk,"modifiers":modifiers})).await;
    pressed?;
    released?;
    Ok(())
}

pub(crate) async fn press(app: &AppHandle, id: &str, name: &str) -> Result<Value, String> {
    let _lock = crate::webview2_secrets::lock(id).await;
    let view = crate::app_browser::find_browser(app, id)?;
    let (key_name, code, vk) = match name {
        "Enter" | "Return" => ("Enter", "Enter", 13),
        "Tab" => ("Tab", "Tab", 9),
        "Escape" | "Esc" => ("Escape", "Escape", 27),
        "Backspace" => ("Backspace", "Backspace", 8),
        "Delete" => ("Delete", "Delete", 46),
        "Space" | " " => (" ", "Space", 32),
        "ArrowLeft" | "Left" => ("ArrowLeft", "ArrowLeft", 37),
        "ArrowUp" | "Up" => ("ArrowUp", "ArrowUp", 38),
        "ArrowRight" | "Right" => ("ArrowRight", "ArrowRight", 39),
        "ArrowDown" | "Down" => ("ArrowDown", "ArrowDown", 40),
        "Home" => ("Home", "Home", 36),
        "End" => ("End", "End", 35),
        "PageUp" => ("PageUp", "PageUp", 33),
        "PageDown" => ("PageDown", "PageDown", 34),
        _ => return Err("不支持的按键".into()),
    };
    key(&view, key_name, code, vk, 0).await?;
    Ok(json!({"ok":true,"dispatched":true}))
}

async fn click(
    view: &Webview,
    doc: &Value,
    object: &str,
    x: f64,
    y: f64,
    op: &str,
) -> Result<(), String> {
    let button = if op == "rightclick" { "right" } else { "left" };
    let buttons = if op == "rightclick" { 2 } else { 1 };
    // 按下、释放已携带落点。隐藏的 WebView2 不绘制移动帧，预先等待
    // mouseMoved 的回执会一直挂起；直接投递原生点击，不重放结果未知的事件。
    for count in 1..=if op == "dblclick" { 2 } else { 1 } {
        let current = probe(view, object).await?;
        verify(view, doc).await?;
        if current["ok"] != true
            || current["x"].as_f64() != Some(x)
            || current["y"].as_f64() != Some(y)
        {
            return Err("点击落点已变化，请重新读取页面".into());
        }
        let pressed=cdp(view,"Input.dispatchMouseEvent",json!({"type":"mousePressed","x":x,"y":y,"button":button,"buttons":buttons,"clickCount":count})).await;
        let released=cdp(view,"Input.dispatchMouseEvent",json!({"type":"mouseReleased","x":x,"y":y,"button":button,"buttons":0,"clickCount":count})).await;
        pressed?;
        released?;
    }
    Ok(())
}

pub(crate) async fn dispatch(app: &AppHandle, id: &str, args: &Value) -> Result<Value, String> {
    let timeout = args["timeout"].as_u64().unwrap_or(1500).clamp(0, 20000);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout);
    loop {
        let result = dispatch_once(app, id, args).await?;
        if result["ok"] == true
            || result["dispatched"] == true
            || !matches!(
                result["reason"].as_str(),
                Some("not_found" | "hidden" | "covered" | "unstable")
            )
            || std::time::Instant::now() >= deadline
        {
            return Ok(result);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

async fn dispatch_once(app: &AppHandle, id: &str, args: &Value) -> Result<Value, String> {
    let op = args["op"].as_str().ok_or("缺少输入操作")?;
    if ![
        "click",
        "dblclick",
        "rightclick",
        "hover",
        "fill",
        "ready",
        "check",
        "uncheck",
    ]
    .contains(&op)
    {
        return Err("不支持的输入操作".into());
    }
    let locators = args["locators"].as_array().ok_or("缺少定位条件")?;
    if locators.is_empty() || locators.len() > 16 || args.to_string().len() > 100_000 {
        return Err("定位参数超出范围".into());
    }
    let _lock = crate::webview2_secrets::lock(id).await;
    let view = crate::app_browser::find_browser(app, id)?;
    if op == "fill" {
        crate::secret_browser::guard(app, id).await?;
    }
    let doc = frame(&view).await?;
    let world = cdp(
        &view,
        "Page.createIsolatedWorld",
        json!({"frameId":doc["id"],"worldName":"zerror-native-input"}),
    )
    .await?;
    let context = world["executionContextId"].as_i64().ok_or(STALE)?;
    let mut last = json!({"ok":false,"reason":"not_found","retry":true,"dispatched":false});
    for loc in locators {
        // Native backend identities belong to a different snapshot path. Never reinterpret them as text.
        if loc.get("backend").is_some_and(|v| !v.is_null())
            || loc.get("frameId").is_some_and(|v| v != &doc["id"])
            || loc.get("loaderId").is_some_and(|v| v != &doc["loaderId"])
        {
            return Err(STALE.into());
        }
        if !["css", "text", "role", "label"].contains(&loc["by"].as_str().unwrap_or(""))
            || loc["value"]
                .as_str()
                .is_none_or(|v| v.is_empty() || v.len() > 4096)
        {
            return Err("定位条件无效".into());
        }
        let raw = cdp(&view,"Runtime.evaluate",json!({"contextId":context,"expression":format!("({LOCATE})({loc})"),"returnByValue":false})).await?;
        let Some(object) = raw["result"]["objectId"].as_str() else {
            return Err("无法定位当前元素".into());
        };
        let result = act(&view, &doc, object, op, args).await;
        let _ = cdp(&view, "Runtime.releaseObject", json!({"objectId":object})).await;
        let value = result?;
        if value["ok"] == true || value["dispatched"] == true {
            return Ok(value);
        }
        if value["reason"] == "ambiguous" || value["reason"] == "disabled" {
            return Ok(value);
        }
        last = value;
    }
    Ok(last)
}

// The caller holds the tab operation lock and has already checked its scoped document.
pub(crate) async fn click_object(view: &Webview, object: &str) -> Result<Value, String> {
    let allowed = cdp(view, "Runtime.callFunctionOn", json!({
        "objectId": object,
        "functionDeclaration": "function(){return this.isConnected && this.ownerDocument===document && this.matches('a,button,[role=button],input[type=submit],input[type=button]');}",
        "returnByValue": true,
    })).await?;
    if allowed["result"]["value"] != true {
        return Ok(json!({"ok":false,"dispatched":false,"reason":"invalid"}));
    }
    let doc = frame(view).await?;
    act(view, &doc, object, "click", &json!({})).await
}

async fn act(
    view: &Webview,
    doc: &Value,
    object: &str,
    op: &str,
    args: &Value,
) -> Result<Value, String> {
    let first = probe(view, object).await?;
    if first["ok"] != true {
        return Ok(first);
    }
    if op == "ready" {
        return Ok(first);
    }
    tokio::time::sleep(std::time::Duration::from_millis(32)).await;
    let fresh = probe(view, object).await?;
    if fresh["ok"] != true {
        return Ok(fresh);
    }
    if first["x"] != fresh["x"] || first["y"] != fresh["y"] {
        return Ok(json!({"ok":false,"reason":"unstable","dispatched":false}));
    }
    verify(view, doc).await?;
    let x = fresh["x"].as_f64().ok_or(STALE)?;
    let y = fresh["y"].as_f64().ok_or(STALE)?;
    if matches!(op, "check" | "uncheck") {
        if fresh["checkable"] != true {
            return Err("目标不是复选框或单选框".into());
        }
        let checked = op == "check";
        if fresh["checked"] == checked {
            return Ok(json!({"ok":true,"checked":checked,"dispatched":false}));
        }
        click(view, doc, object, x, y, "click").await?;
        let actual = probe(view, object).await?;
        return Ok(
            json!({"ok":actual["checked"]==checked,"checked":actual["checked"],"dispatched":true}),
        );
    }
    if op == "fill" {
        if fresh["editable"] != true || fresh["readonly"] == true {
            return Err("目标不可编辑".into());
        }
        let text = args["text"].as_str().ok_or("缺少填写内容")?;
        cdp(
            view,
            "Runtime.callFunctionOn",
            json!({"objectId":object,"functionDeclaration":"function(){this.focus();}"}),
        )
        .await?;
        verify(view, doc).await?;
        key(view, "a", "KeyA", 65, 2).await?;
        verify(view, doc).await?;
        let focused=cdp(view,"Runtime.callFunctionOn",json!({"objectId":object,"functionDeclaration":"function(){return this.isConnected && this.ownerDocument.activeElement===this;}","returnByValue":true})).await?;
        if focused["result"]["value"] != true {
            return Err("输入焦点已变化，请重新读取页面".into());
        }
        cdp(view, "Input.insertText", json!({"text":text})).await?;
        let receipt = cdp(view,"Runtime.callFunctionOn",json!({"objectId":object,"functionDeclaration":"function(text){return this.isConnected && (this.isContentEditable ? this.textContent : this.value)===text;}","arguments":[{"value":text}],"returnByValue":true})).await?;
        let filled = receipt["result"]["value"] == true;
        return Ok(
            json!({"ok":filled,"filled":filled,"password":fresh["password"],"length":text.encode_utf16().count(),"dispatched":true}),
        );
    }
    if op == "hover" {
        cdp(
            view,
            "Input.dispatchMouseEvent",
            json!({"type":"mouseMoved","x":x,"y":y,"button":"none"}),
        )
        .await?;
    } else {
        click(view, doc, object, x, y, op).await?;
    }
    Ok(json!({"ok":true,"dispatched":true}))
}
