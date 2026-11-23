use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, Weak},
};
use tauri::{AppHandle, Webview};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use zeroize::Zeroizing;

const CDP_ERROR: &str = "Windows 浏览器未能完成安全页面操作";
const STALE: &str = "页面已变化，请重新读取页面后再操作";

// Keep arbitrary eval and credential writes from overlapping in the same webview.
pub(crate) async fn lock(id: &str) -> OwnedMutexGuard<()> {
    type Locks = Mutex<HashMap<String, Weak<AsyncMutex<()>>>>;
    static LOCKS: OnceLock<Locks> = OnceLock::new();
    let lock = {
        let mut locks = LOCKS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        locks.retain(|_, lock| lock.strong_count() > 0);
        locks.get(id).and_then(Weak::upgrade).unwrap_or_else(|| {
            let lock = Arc::new(AsyncMutex::new(()));
            locks.insert(id.into(), Arc::downgrade(&lock));
            lock
        })
    };
    lock.lock_owned().await
}

async fn cdp(webview: &Webview, method: &'static str, params: Value) -> Result<Value, String> {
    crate::webview2::call(
        webview,
        method,
        Zeroizing::new(params.to_string()),
        CDP_ERROR,
    )
    .await
}

#[derive(PartialEq, Eq)]
struct Document {
    frame: String,
    loader: String,
    url: String,
}

impl Document {
    async fn read(webview: &Webview) -> Result<Self, String> {
        let tree = cdp(webview, "Page.getFrameTree", json!({})).await?;
        let frame = &tree["frameTree"]["frame"];
        let get = |key: &str| {
            frame[key]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .ok_or(STALE)
        };
        Ok(Self {
            frame: get("id")?,
            loader: get("loaderId")?,
            url: get("url")?,
        })
    }

    fn check_locator(&self, locator: &Value, require_identity: bool) -> Result<(), String> {
        for (key, expected) in [("frameId", &self.frame), ("loaderId", &self.loader)] {
            match locator.get(key) {
                Some(value) if value.as_str() == Some(expected.as_str()) => (),
                None if !require_identity => (),
                _ => return Err(STALE.into()),
            }
        }
        if ["frame", "framePath", "backend"]
            .iter()
            .any(|key| locator.get(key).is_some_and(|value| !value.is_null()))
        {
            return Err("Windows 安全填写需要主文档的 CSS 输入框定位".into());
        }
        Ok(())
    }

    async fn context(&self, webview: &Webview) -> Result<i64, String> {
        let world = cdp(
            webview,
            "Page.createIsolatedWorld",
            json!({
                "frameId": self.frame, "worldName": "ZError secure input"
            }),
        )
        .await?;
        if Self::read(webview).await? != *self {
            return Err(STALE.into());
        }
        world["executionContextId"]
            .as_i64()
            .ok_or_else(|| CDP_ERROR.into())
    }
}

pub(crate) async fn loader(app: &AppHandle, id: &str) -> Result<String, String> {
    Ok(Document::read(&crate::app_browser::find_browser(app, id)?)
        .await?
        .loader)
}

async fn evaluate(
    webview: &Webview,
    context: i64,
    expression: String,
    return_value: bool,
) -> Result<Value, String> {
    let result = cdp(webview, "Runtime.evaluate", json!({
        "contextId": context, "expression": expression, "returnByValue": return_value, "silent": true
    })).await?;
    Ok(result["result"].clone())
}

async fn describe_input(webview: &Webview, object: &str) -> Result<Value, String> {
    let result = cdp(
        webview,
        "Runtime.callFunctionOn",
        json!({
            "objectId": object, "returnByValue": true, "silent": true,
            "functionDeclaration": r#"function () {
          if (!(this instanceof HTMLInputElement)) return null;
          return { origin: this.ownerDocument.location.origin, type: this.type };
        }"#
        }),
    )
    .await?;
    Ok(result["result"]["value"].clone())
}

#[derive(serde::Serialize)]
struct Argument<T> {
    value: T,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InputCall<'a> {
    object_id: &'a str,
    return_by_value: bool,
    silent: bool,
    arguments: (Argument<&'a str>, Argument<&'a str>, Argument<&'a str>),
    function_declaration: &'static str,
}

const WRITE_INPUT: &str = r#"function (value, origin, type) {
    const valid = () => this instanceof HTMLInputElement && this.isConnected
        && this.ownerDocument === document && location.origin === origin && this.type === type
        && !this.matches(':disabled') && !this.readOnly && this.getClientRects().length > 0
        && getComputedStyle(this).visibility === 'visible';
    if (!valid()) return false;
    this.focus();
    if (!valid()) return false;
    this.setAttribute('data-zerror-private', 'true');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(this, value);
    this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    this.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}"#;

async fn write_input(
    webview: &Webview,
    object: &str,
    value: &str,
    origin: &str,
    input_type: &str,
) -> Result<bool, String> {
    let params = InputCall {
        object_id: object,
        return_by_value: true,
        silent: true,
        arguments: (
            Argument { value },
            Argument { value: origin },
            Argument { value: input_type },
        ),
        function_declaration: WRITE_INPUT,
    };
    let payload = Zeroizing::new(serde_json::to_string(&params).map_err(|_| CDP_ERROR)?);
    let result =
        crate::webview2::call(webview, "Runtime.callFunctionOn", payload, CDP_ERROR).await?;
    Ok(result["result"]["value"] == true)
}

pub(crate) async fn fill(
    app: &AppHandle,
    id: &str,
    locator: &Value,
    reference: &str,
) -> Result<Value, String> {
    let selector = locator["value"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() < 4096)
        .filter(|_| locator["by"] == "css")
        .ok_or("Windows 安全填写需要 CSS 输入框定位")?;
    let nth = locator["nth"].as_u64().filter(|n| *n > 0);
    let _operation = lock(id).await;
    let webview = crate::app_browser::find_browser(app, id)?;
    let doc = Document::read(&webview).await?;
    doc.check_locator(locator, false)?;
    let context = doc.context(&webview).await?;
    let query = format!(
        "((selector, nth) => {{ const nodes = document.querySelectorAll(selector); \
        return (nth ? nodes[nth - 1] : nodes.length === 1 ? nodes[0] : null) || null; }})({}, {})",
        json!(selector),
        json!(nth)
    );
    let input = evaluate(&webview, context, query, false).await?;
    let object = input["objectId"]
        .as_str()
        .ok_or("未能确定唯一的登录输入框")?;
    let result = fill_input(&webview, id, &doc, object, reference).await;
    let _ = cdp(
        &webview,
        "Runtime.releaseObject",
        json!({"objectId":object}),
    )
    .await;
    result
}

async fn fill_input(
    webview: &Webview,
    id: &str,
    doc: &Document,
    object: &str,
    reference: &str,
) -> Result<Value, String> {
    let info = describe_input(webview, object).await?;
    let origin = info["origin"].as_str().ok_or("无法验证登录输入框的来源")?;
    let input_type = info["type"]
        .as_str()
        .filter(|kind| matches!(*kind, "password" | "text" | "tel" | "email" | "number"))
        .ok_or("目标不是受支持的登录输入框")?;
    if Document::read(webview).await? != *doc
        || url::Url::parse(&doc.url)
            .ok()
            .map(|url| url.origin().ascii_serialization())
            .as_deref()
            != Some(origin)
    {
        return Err(STALE.into());
    }
    let reference = reference.to_owned();
    let target = origin.to_owned();
    let password = input_type == "password";
    let secret = tauri::async_runtime::spawn_blocking(move || {
        crate::secret_vault::resolve_site_input(&reference, &target, password)
    })
    .await
    .map_err(|_| "无法读取登录凭据")??;
    crate::secret_browser::mark(id, &doc.loader);
    let filled = write_input(webview, object, secret.as_str(), origin, input_type).await?;
    Ok(json!({"ok": filled, "filled": filled}))
}

pub(crate) async fn login_observe(app: &AppHandle, id: &str, args: &Value) -> Result<Value, String> {
    let _operation = lock(id).await;
    let webview = crate::app_browser::find_browser(app, id)?;
    let doc = Document::read(&webview).await?;
    if args["url"].as_str() != Some(doc.url.as_str()) {
        return Ok(json!({"url": doc.url, "supportsLoginAction": true}));
    }
    let (probe, rules) = crate::browser_login::observation(&doc.url, args)?;
    let context = doc.context(&webview).await?;
    let result = evaluate(&webview, context, probe, true).await?;
    if Document::read(&webview).await? != doc {
        return Ok(json!({}));
    }
    let mut result = crate::browser_login::finish_observation(&doc.url, &doc.frame, &doc.loader, result["value"].clone(), rules);
    result["supportsLoginAction"] = json!(true);
    Ok(result)
}

pub(crate) async fn login_action(app: &AppHandle, id: &str, args: &Value) -> Result<Value, String> {
    let locator = &args["locator"];
    let site = args["site"].as_str().ok_or("缺少登录网站身份")?;
    let expected = args["url"].as_str().ok_or(STALE)?;
    let target = url::Url::parse(expected).map_err(|_| STALE)?;
    let origin = target.origin().ascii_serialization();
    if !crate::secret_vault::site_accepts_origin(site, &origin) {
        return Err("当前页面不在网站的登录授权范围内".into());
    }
    let selector = args["selector"].as_str().filter(|s| !s.is_empty() && s.len() <= 512)
        .ok_or("缺少登录控件选择器")?;
    let text_match = args["label"].as_str().filter(|s| s.len() <= 80);
    let code = match args["action"].as_str() {
        Some("click") => None,
        Some("fill") => Some(args["text"].as_str()
            .filter(|s| s.len() == 5 && s.bytes().all(|b| b.is_ascii_alphanumeric()))
            .ok_or("验证码格式不正确")?),
        _ => return Err("不支持的登录页面操作".into()),
    };
    let _operation = lock(id).await;
    let webview = crate::app_browser::find_browser(app, id)?;
    let doc = Document::read(&webview).await?;
    doc.check_locator(locator, true)?;
    if doc.url != expected {
        return Err(STALE.into());
    }
    let context = doc.context(&webview).await?;
    let query = format!(
        r#"((expected, selector, text) => {{
            if (location.href !== expected) return null;
            const nodes = [...document.querySelectorAll(selector)].filter(node =>
                node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible'
                && (text === null || node.textContent.trim() === text));
            return nodes.length === 1 ? nodes[0] : null;
        }})({}, {}, {})"#, json!(expected), json!(selector), json!(text_match)
    );
    let node = evaluate(&webview, context, query, false).await?;
    let Some(object) = node["objectId"].as_str() else {
        return Ok(json!({"ok":false, "dispatched":false}));
    };
    let result = async {
        if Document::read(&webview).await? != doc {
            return Err(STALE.into());
        }
        if let Some(code) = code {
            let filled = write_input(&webview, object, code, &origin, "text").await?;
            return Ok(json!({"ok":filled, "filled":filled, "dispatched":filled}));
        }
        let result = cdp(&webview, "Runtime.callFunctionOn", json!({
            "objectId": object, "returnByValue": true, "silent": true, "arguments": [{"value":expected}],
            "functionDeclaration": r#"function(expected) {
                if (!this.isConnected || this.ownerDocument !== document || location.href !== expected
                    || !this.matches('a, button, [role="button"], input[type=submit], input[type=button]')
                    || this.matches(':disabled, [aria-disabled="true"]') || !this.getClientRects().length
                    || getComputedStyle(this).visibility !== 'visible') return false;
                this.click();
                return true;
            }"#
        })).await;
        // Navigation can destroy the context before the response reaches WebView2.
        let dispatched = result.as_ref().map_or(true, |v| v["result"]["value"] == true);
        Ok(json!({"ok":result.is_ok() && dispatched, "dispatched":dispatched}))
    }.await;
    let _ = cdp(
        &webview,
        "Runtime.releaseObject",
        json!({"objectId":object}),
    )
    .await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_locator_rejects_stale_documents_and_frame_hints() {
        let document = Document {
            frame: "top".into(),
            loader: "current".into(),
            url: "https://example.test/login".into(),
        };
        assert!(document.check_locator(&json!({}), false).is_ok());
        assert!(document.check_locator(&json!({}), true).is_err());
        assert!(document
            .check_locator(&json!({"frameId":"top", "loaderId":"current"}), true)
            .is_ok());
        assert!(document
            .check_locator(&json!({"frameId":"top", "loaderId":"old"}), false)
            .is_err());
        assert!(document
            .check_locator(&json!({"frame":"nested"}), false)
            .is_err());
    }
}
