//! Scoped, fixed DOM operations. No package JavaScript is evaluated in the page.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

const SCRIPT: &str = include_str!("document_script.js");
const STALE: &str = "页面文档已更换，请重新读取后操作";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Document {
    frame_id: String,
    loader_id: String,
    url: String,
    #[serde(skip)]
    session: Option<String>,
}

fn allowed(url: &str, host: &str) -> bool {
    url::Url::parse(url).is_ok_and(|url| {
        url.scheme() == "https"
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url
                .host_str()
                .is_some_and(|name| name == host || name.ends_with(&format!(".{host}")))
    })
}

fn select<'a>(rows: &'a [Document], args: &Value, host: &str) -> Result<&'a Document, String> {
    let expected: Document = serde_json::from_value(args["document"].clone()).map_err(|_| STALE)?;
    rows.iter()
        .find(|row| {
            row.frame_id == expected.frame_id
                && row.loader_id == expected.loader_id
                && row.url == expected.url
                && allowed(&row.url, host)
        })
        .ok_or_else(|| STALE.into())
}

struct Engine {
    #[cfg(target_os = "macos")]
    page: crate::cef::PageBind,
    #[cfg(windows)]
    view: tauri::Webview,
    #[cfg(target_os = "linux")]
    view: tauri::Webview,
}

impl Engine {
    #[cfg(not(target_os = "linux"))]
    async fn command(
        &self,
        _doc: &Document,
        _method: &'static str,
        _args: Value,
    ) -> Result<Value, String> {
        #[cfg(target_os = "macos")]
        {
            return self
                .page
                .conn
                .call(_method, _args, _doc.session.as_deref())
                .await;
        }
        #[cfg(windows)]
        {
            return self.call(_method, _args).await;
        }
        #[allow(unreachable_code)]
        Err("当前浏览器不支持子文档绑定".into())
    }

    async fn child_frame(&self, doc: &Document, selector: &str) -> Result<Option<String>, String> {
        #[cfg(target_os = "linux")]
        {
            let result = crate::linux_documents::request(
                &self.view,
                "zerror.documents.child",
                &json!(doc),
                selector.into(),
            )
            .await?;
            return if result.is_null() {
                Ok(None)
            } else {
                result
                    .as_str()
                    .map(|id| Some(id.to_owned()))
                    .ok_or_else(|| STALE.into())
            };
        }
        #[cfg(not(target_os = "linux"))]
        {
            let world = self
                .command(
                    doc,
                    "Page.createIsolatedWorld",
                    json!({ "frameId": doc.frame_id, "worldName": "zerror-document-v2" }),
                )
                .await?;
            if !self.documents().await?.contains(doc) {
                return Err(STALE.into());
            }
            let context = world["executionContextId"].as_i64().ok_or(STALE)?;
            let expression = format!("(()=>{{if(location.href!=={})throw Error('Document changed');const nodes=document.querySelectorAll({});return nodes.length===1&&/^(IFRAME|FRAME)$/.test(nodes[0].tagName)?nodes[0]:null;}})()", json!(doc.url), json!(selector));
            let object = self
                .command(
                    doc,
                    "Runtime.evaluate",
                    json!({ "contextId":context, "expression":expression, "returnByValue":false }),
                )
                .await?;
            if object.get("exceptionDetails").is_some() {
                return Err(STALE.into());
            }
            let Some(object_id) = object.pointer("/result/objectId").and_then(Value::as_str) else {
                return Ok(None);
            };
            let described = self
                .command(
                    doc,
                    "DOM.describeNode",
                    json!({ "objectId":object_id, "depth":1 }),
                )
                .await;
            let _ = self
                .command(
                    doc,
                    "Runtime.releaseObject",
                    json!({ "objectId":object_id }),
                )
                .await;
            let described = described?;
            Ok(described
                .pointer("/node/frameId")
                .or_else(|| described.pointer("/node/contentDocument/frameId"))
                .and_then(Value::as_str)
                .map(str::to_owned))
        }
    }
    async fn open(_app: &AppHandle, _id: &str) -> Result<Option<Self>, String> {
        #[cfg(target_os = "macos")]
        if crate::cef_runtime::cef_enabled() {
            return Ok(Some(Self {
                page: crate::cef::bind_page(_id).await?,
            }));
        }
        #[cfg(windows)]
        {
            return Ok(Some(Self {
                view: super::find_browser(_app, _id)?,
            }));
        }
        #[cfg(target_os = "linux")]
        {
            return Ok(Some(Self {
                view: super::find_browser(_app, _id)?,
            }));
        }
        #[allow(unreachable_code)]
        Ok(None)
    }

    #[cfg(windows)]
    async fn call(&self, method: &'static str, args: Value) -> Result<Value, String> {
        crate::webview2::call(
            &self.view,
            method,
            zeroize::Zeroizing::new(args.to_string()),
            "浏览器文档操作失败",
        )
        .await
    }

    async fn documents(&self) -> Result<Vec<Document>, String> {
        #[cfg(target_os = "linux")]
        {
            let value = crate::linux_documents::request(
                &self.view,
                "zerror.documents.list",
                &json!({}),
                String::new(),
            )
            .await?;
            let documents: Vec<Document> = serde_json::from_value(value).map_err(|_| STALE)?;
            if documents.len() > 128 {
                return Err("页面包含过多文档".into());
            }
            return Ok(documents);
        }
        #[cfg(target_os = "macos")]
        {
            return Ok(crate::cef::frames::contexts(&self.page)
                .await?
                .into_iter()
                .map(|row| Document {
                    frame_id: row.id,
                    loader_id: row.loader_id,
                    url: row.url,
                    session: row.session,
                })
                .collect());
        }
        #[cfg(windows)]
        {
            let tree = self.call("Page.getFrameTree", json!({})).await?;
            let mut rows = Vec::new();
            flatten(&tree["frameTree"], &mut rows, 0)?;
            return Ok(rows);
        }
        #[allow(unreachable_code)]
        Err("当前浏览器不支持原生文档身份".into())
    }

    async fn evaluate(
        &self,
        document: &Document,
        expression: String,
        user_gesture: bool,
    ) -> Result<Value, String> {
        #[cfg(target_os = "linux")]
        {
            // WebKitGTK's isolated world does not expose a synthetic user-gesture API.
            // Media promises report autoplay denial normally; never weaken web security.
            let _ = user_gesture;
            let reply = crate::linux_documents::request(
                &self.view,
                "zerror.documents.evaluate",
                &json!(document),
                expression,
            )
            .await?;
            return reply
                .get("value")
                .cloned()
                .ok_or_else(|| "页面未返回文档回执".into());
        }
        #[cfg(target_os = "macos")]
        {
            let frame = crate::cef::frames::FrameContext {
                id: document.frame_id.clone(),
                loader_id: document.loader_id.clone(),
                url: document.url.clone(),
                name: String::new(),
                path: String::new(),
                session: document.session.clone(),
            };
            // This fixed script may return the media play promise. Page scripts are never accepted here.
            let world = self
                .page
                .conn
                .call(
                    "Page.createIsolatedWorld",
                    json!({ "frameId": frame.id, "worldName": "zerror-document-v2" }),
                    frame.session.as_deref(),
                )
                .await?;
            if !self.documents().await?.contains(document) {
                return Err(STALE.into());
            }
            let context = world["executionContextId"].as_i64().ok_or(STALE)?;
            let raw = self
                .page
                .conn
                .call_ms(
                    "Runtime.evaluate",
                    json!({ "contextId": context, "expression": expression,
                "returnByValue": true, "awaitPromise": true, "userGesture": user_gesture }),
                    frame.session.as_deref(),
                    35000,
                )
                .await?;
            return evaluate_result(raw);
        }
        #[cfg(windows)]
        {
            let world = self
                .call(
                    "Page.createIsolatedWorld",
                    json!({ "frameId": document.frame_id, "worldName": "zerror-document-v2" }),
                )
                .await?;
            if !self.documents().await?.contains(document) {
                return Err(STALE.into());
            }
            let context = world["executionContextId"].as_i64().ok_or(STALE)?;
            return evaluate_result(
                crate::webview2::call_ms(
                    &self.view,
                    "Runtime.evaluate",
                    zeroize::Zeroizing::new(
                        json!({ "contextId": context, "expression": expression,
                "returnByValue": true, "awaitPromise": true, "userGesture": user_gesture })
                        .to_string(),
                    ),
                    "浏览器文档操作失败",
                    35000,
                )
                .await?,
            );
        }
        #[allow(unreachable_code)]
        {
            let _ = (document, expression, user_gesture);
            Err("当前浏览器不支持文档操作".into())
        }
    }
}

#[cfg(any(windows, test))]
fn flatten(tree: &Value, rows: &mut Vec<Document>, depth: usize) -> Result<(), String> {
    if depth > 16 || rows.len() >= 128 {
        return Err("页面包含过多文档".into());
    }
    let frame = &tree["frame"];
    let text = |key: &str| frame[key].as_str().unwrap_or_default().to_owned();
    if text("id").is_empty() || text("loaderId").is_empty() {
        return Err(STALE.into());
    }
    rows.push(Document {
        frame_id: text("id"),
        loader_id: text("loaderId"),
        url: text("url"),
        session: None,
    });
    for child in tree["childFrames"].as_array().into_iter().flatten() {
        flatten(child, rows, depth + 1)?;
    }
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
fn evaluate_result(raw: Value) -> Result<Value, String> {
    if raw.get("exceptionDetails").is_some() {
        return Err("页面拒绝了文档操作，请重新核对".into());
    }
    let value = raw
        .pointer("/result/value")
        .cloned()
        .ok_or("页面未返回文档回执")?;
    if value.to_string().len() > 128 * 1024 {
        return Err("文档回执超过大小限制，请缩小读取范围".into());
    }
    Ok(value)
}

async fn fallback(
    app: &AppHandle,
    id: &str,
    expected: Option<&Document>,
    args: &Value,
) -> Result<Value, String> {
    let state = super::browser_get_state(app.clone(), id.to_owned()).await?;
    let doc = expected.cloned().unwrap_or(Document {
        frame_id: "main".into(),
        loader_id: String::new(),
        url: state.url,
        session: None,
    });
    let expression = format!("({SCRIPT})({}, {})", json!(doc), args);
    let view = super::find_browser(app, id)?;
    let token = uuid::Uuid::new_v4().to_string();
    let (send, receive) = tokio::sync::oneshot::channel();
    super::pending_evals()
        .lock()
        .map_err(|_| "文档执行通道被占用")?
        .insert(token.clone(), send);
    struct Pending(String);
    impl Drop for Pending {
        fn drop(&mut self) {
            let _ = super::take_eval(&self.0);
        }
    }
    let _pending = Pending(token.clone());
    let prefix = json!(format!("ZRRESULT:{token}:"));
    let script = format!(
        r#"(function(){{
      var previous = document.title;
      function done(value) {{
        var text = JSON.stringify(value);
        if (text.length > 131072) text = JSON.stringify({{ok:false,error:'文档回执超过大小限制'}});
        var marker = {prefix} + text;
        document.title = marker;
        setTimeout(function(){{if(document.title===marker) document.title=previous;}},30);
      }}
      Promise.resolve().then(function(){{return {expression};}}).then(done,function(){{done({{ok:false,error:'页面拒绝了文档操作'}});}});
    }})();"#
    );
    view.eval(&script).map_err(|_| "文档执行失败")?;
    let raw = tokio::time::timeout(std::time::Duration::from_secs(35), receive)
        .await
        .map_err(|_| "文档执行超时")?
        .map_err(|_| "文档回执丢失")?;
    serde_json::from_str(&raw).map_err(|_| "页面未返回有效文档身份".into())
}

pub(super) async fn dispatch(app: &AppHandle, id: &str, args: &Value) -> Result<Value, String> {
    let host = args["host"]
        .as_str()
        .filter(|host| {
            !host.is_empty()
                && host.len() <= 253
                && host
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'-')
        })
        .ok_or("缺少网站授权范围")?;
    #[cfg(windows)]
    let _lock = crate::webview2_secrets::lock(id).await;
    let engine = Engine::open(app, id).await?;
    let mut fallback_children = 0;
    let rows = if let Some(engine) = &engine {
        engine.documents().await?
    } else {
        let identity = fallback(app, id, None, &json!({"action":"identity"})).await?;
        fallback_children = identity["children"].as_u64().unwrap_or(0) as usize;
        vec![serde_json::from_value(identity).map_err(|_| STALE)?]
    };
    if rows.is_empty() || rows[0].loader_id.is_empty() || !allowed(&rows[0].url, host) {
        return Err("当前页面不在网站授权范围内".into());
    }
    let action = args["action"].as_str().unwrap_or_default();
    if action == "list" {
        let documents: Vec<_> = rows
            .iter()
            .filter(|row| !row.loader_id.is_empty() && allowed(&row.url, host))
            .collect();
        return Ok(
            json!({ "ok": true, "documents": documents, "blockedFrames": rows.len() - documents.len() + fallback_children, "childFramesSupported": engine.is_some() }),
        );
    }
    if action == "navigate" {
        let doc = select(&rows, args, host)?;
        if doc != &rows[0] || !args["url"].as_str().is_some_and(|url| allowed(url, host)) {
            return Err("导航目标不在授权范围或不是顶层文档".into());
        }
        let expression = format!("({SCRIPT})({}, {})", json!(doc), args);
        #[cfg(windows)]
        drop(_lock);
        return if let Some(engine) = &engine {
            engine.evaluate(doc, expression, false).await
        } else {
            fallback(app, id, Some(doc), args).await
        };
    }
    validate_action(args)?;
    let doc = select(&rows, args, host)?.clone();
    if action == "frames" {
        let Some(engine) = &engine else {
            return Ok(json!({ "ok":false,"reason":"frames_unsupported" }));
        };
        let frame_id = engine
            .child_frame(&doc, args["selector"].as_str().ok_or("缺少 iframe 选择器")?)
            .await?;
        let fresh = engine.documents().await?;
        if !fresh.contains(&doc) || !fresh.first().is_some_and(|root| allowed(&root.url, host)) {
            return Err(STALE.into());
        }
        let documents: Vec<_> = fresh
            .iter()
            .filter(|row| {
                row.frame_id != doc.frame_id
                    && Some(&row.frame_id) == frame_id.as_ref()
                    && allowed(&row.url, host)
            })
            .collect();
        return Ok(json!({ "ok":true,"documents":documents }));
    }
    if action == "fill_secret" {
        let locator = json!({ "by": "css", "value": args["selector"], "nth": args["nth"], "frameId": doc.frame_id, "loaderId": doc.loader_id });
        let reference = args["secret_ref"].as_str().ok_or("缺少凭据引用")?;
        #[cfg(target_os = "macos")]
        if engine.is_some() {
            return crate::cef::cdp_fill_secret(app.clone(), id.into(), locator, reference.into())
                .await;
        }
        #[cfg(windows)]
        {
            drop(_lock);
            return crate::webview2_secrets::fill(app, id, &locator, reference).await;
        }
        #[allow(unreachable_code)]
        {
            let _ = (locator, reference);
            return Err("当前浏览器不支持安全凭据填写".into());
        }
    }
    #[cfg(windows)]
    drop(_lock);
    // Comparison is not a credential-guessing oracle, even if page code removes a DOM marker.
    if matches!(action, "compare" | "value" | "glyphs") {
        crate::secret_browser::guard(app, id).await?;
    }
    let mut projected = args.clone();
    if action == "query" {
        projected["allowFlags"] = json!(crate::secret_browser::guard(app, id).await.is_ok());
    }
    let expression = format!("({SCRIPT})({}, {})", json!(doc), projected);
    let result = if let Some(engine) = &engine {
        engine
            .evaluate(&doc, expression, action == "media_play")
            .await?
    } else {
        let fresh = fallback(app, id, None, &json!({"action":"identity"})).await?;
        let current: Document = serde_json::from_value(fresh).map_err(|_| STALE)?;
        if current != doc {
            return Err(STALE.into());
        }
        fallback(app, id, Some(&doc), &projected).await?
    };
    if matches!(
        action,
        "query" | "glyphs" | "value" | "image" | "compare" | "media_read" | "media_wait"
    ) {
        let fresh = if let Some(engine) = &engine {
            engine.documents().await?
        } else {
            vec![serde_json::from_value(
                fallback(app, id, None, &json!({"action":"identity"})).await?,
            )
            .map_err(|_| STALE)?]
        };
        if !fresh.contains(&doc) || !fresh.first().is_some_and(|root| allowed(&root.url, host)) {
            return Err(STALE.into());
        }
    }
    Ok(result)
}

fn validate_action(args: &Value) -> Result<(), String> {
    if !matches!(
        args["action"].as_str(),
        Some(
            "query"
                | "reveal"
                | "frames"
                | "glyphs"
                | "scroll"
                | "select"
                | "value"
                | "image"
                | "compare"
                | "click"
                | "fill"
                | "fill_secret"
                | "media_read"
                | "media_play"
                | "media_pause"
                | "media_mute"
                | "media_wait"
                | "media_cancel"
        )
    ) {
        return Err("不支持的文档操作".into());
    }
    if !args["selector"]
        .as_str()
        .is_some_and(|s| !s.trim().is_empty() && s.len() <= 512)
    {
        return Err("文档选择器无效".into());
    }
    if args
        .get("nth")
        .is_some_and(|n| !n.is_null() && !n.as_u64().is_some_and(|n| (1..=100).contains(&n)))
    {
        return Err("元素编号无效".into());
    }
    if args["action"] == "query"
        && !args["limit"]
            .as_u64()
            .is_some_and(|n| (1..=40).contains(&n))
    {
        return Err("读取数量无效".into());
    }
    if matches!(args["action"].as_str(), Some("fill" | "compare"))
        && !args["text"].as_str().is_some_and(|s| s.len() <= 8192)
    {
        return Err("填写内容无效".into());
    }
    if let Some(attributes) = args.get("attributes") {
        if !attributes.as_array().is_some_and(|rows| {
            rows.len() <= 12
                && rows.iter().all(|row| {
                    row.as_str().is_some_and(|name| {
                        !name.is_empty()
                            && name.len() <= 64
                            && name.bytes().all(|byte| {
                                byte.is_ascii_lowercase()
                                    || byte.is_ascii_digit()
                                    || byte == b'-'
                                    || byte == b'_'
                            })
                            && !["value", "style", "srcdoc", "password", "content", "nonce"]
                                .contains(&name)
                    })
                })
        }) {
            return Err("文档属性请求无效".into());
        }
    }
    if args["action"] == "glyphs" {
        let raster = &args["raster"];
        let size = raster["size"].as_u64().unwrap_or(0);
        let valid_grid = |key: &str| {
            raster[key]
                .as_u64()
                .is_some_and(|n| (8..=32).contains(&n) && size % n == 0 && n * n % 8 == 0)
        };
        if !args["characters"]
            .as_str()
            .is_some_and(|text| (1..=16).contains(&text.chars().count()))
            || !(32..=512).contains(&size)
            || !valid_grid("coarse")
            || !valid_grid("fine")
            || !raster["fontSize"]
                .as_u64()
                .is_some_and(|n| (16..=512).contains(&n))
            || !raster["baseline"].as_u64().is_some_and(|n| n <= size)
            || !raster["threshold"].as_u64().is_some_and(|n| n <= 255)
        {
            return Err("字形读取参数无效".into());
        }
    }
    if args["action"] == "scroll"
        && !args["amount"]
            .as_i64()
            .is_some_and(|n| (-10000..=10000).contains(&n))
    {
        return Err("滚动距离无效".into());
    }
    if args["action"] == "select"
        && !args["index"]
            .as_u64()
            .is_some_and(|n| (1..=10000).contains(&n))
    {
        return Err("选项编号无效".into());
    }
    if args
        .get("offset")
        .is_some_and(|n| !n.as_u64().is_some_and(|n| n <= 10000))
    {
        return Err("读取偏移无效".into());
    }
    if args["action"] == "media_mute" && !args["muted"].is_boolean() {
        return Err("静音参数无效".into());
    }
    if matches!(args["action"].as_str(), Some("media_wait" | "media_cancel"))
        && !args["wait_id"]
            .as_str()
            .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
    {
        return Err("媒体等待标识无效".into());
    }
    if args["action"] == "media_wait"
        && (!args["timeoutMs"]
            .as_u64()
            .is_some_and(|n| (1..=30000).contains(&n))
            || !matches!(args["until"].as_str(), Some("ended" | "playing" | "paused")))
    {
        return Err("媒体等待参数无效".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_and_document_identity_are_checked_independently() {
        assert!(allowed(
            "https://lessons.academy.example/chapter",
            "academy.example"
        ));
        for url in [
            "https://academy.example.evil.test/",
            "http://academy.example/",
            "https://academy.example:8443/",
            "https://user@academy.example/",
        ] {
            assert!(!allowed(url, "academy.example"));
        }
        let doc = Document {
            frame_id: "frame".into(),
            loader_id: "loader".into(),
            url: "https://academy.example/".into(),
            session: None,
        };
        let rows = vec![doc.clone()];
        assert!(select(&rows, &json!({"document":doc}), "academy.example").is_ok());
        let mut stale = doc.clone();
        stale.loader_id = "replaced".into();
        assert!(select(&rows, &json!({"document":stale}), "academy.example").is_err());
        assert!(select(&rows, &json!({"document":doc}), "another.example").is_err());
    }
    #[test]
    fn sibling_frames_and_external_frames_cannot_reuse_document_authority() {
        let first = Document {
            frame_id: "gtk:process:child-one".into(),
            loader_id: "document-one".into(),
            url: "https://lessons.academy.example/shared".into(),
            session: None,
        };
        let second = Document {
            frame_id: "gtk:process:child-two".into(),
            loader_id: "document-two".into(),
            ..first.clone()
        };
        let external = Document {
            url: "https://outside.example/shared".into(),
            ..first.clone()
        };
        let rows = vec![first.clone(), second.clone(), external.clone()];
        assert_eq!(
            select(&rows, &json!({"document":second}), "academy.example").unwrap(),
            &second
        );
        let mixed = Document {
            loader_id: second.loader_id.clone(),
            ..first.clone()
        };
        assert!(select(&rows, &json!({"document":mixed}), "academy.example").is_err());
        assert!(select(&rows, &json!({"document":external}), "academy.example").is_err());
        assert!(select(&[second], &json!({"document":first}), "academy.example").is_err());
    }
    #[test]
    fn rejects_unbounded_or_unknown_dom_actions() {
        assert!(validate_action(&json!({"action":"query","selector":"p","limit":40})).is_ok());
        for args in [
            json!({"action":"evaluate","selector":"body"}),
            json!({"action":"query","selector":"p","limit":41}),
            json!({"action":"click","selector":"button","nth":0}),
            json!({"action":"media_mute","selector":"video","muted":"false"}),
        ] {
            assert!(validate_action(&args).is_err());
        }
    }
    #[test]
    fn frame_tree_is_bounded_and_keeps_loader_identity() {
        let mut rows = Vec::new();
        flatten(&json!({"frame":{"id":"root","loaderId":"one","url":"https://academy.example/"},
            "childFrames":[{"frame":{"id":"child","loaderId":"two","url":"https://academy.example/lesson"}}]}), &mut rows, 0).unwrap();
        assert_eq!(rows[1].loader_id, "two");
        assert!(flatten(&json!({"frame":{"id":"bad"}}), &mut rows, 0).is_err());
    }
}
