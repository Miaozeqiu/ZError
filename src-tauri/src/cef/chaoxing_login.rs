use super::{bind_page, frames};
use serde_json::{json, Value};

// Fixed read-only probe. It never returns form values or page text, even after
// the password form has been marked private by fill_secret.
const LOGIN_STATE: &str = include_str!("chaoxing_login_state.js");

pub async fn state(id: &str) -> Result<Value, String> {
    read_state(id, LOGIN_STATE).await
}

pub async fn zjooc_state(id: &str, capture_captcha: bool) -> Result<Value, String> {
    let probe = format!("{}({})", include_str!("zjooc_login_state.js").trim(), capture_captcha);
    read_state(id, &probe).await
}

async fn read_state(id: &str, probe: &str) -> Result<Value, String> {
    let page = bind_page(id).await?;
    let tree = page
        .conn
        .call("Page.getFrameTree", json!({}), page.session.as_deref())
        .await?;
    let root = tree
        .pointer("/frameTree/frame")
        .ok_or("登录页面尚未就绪")?;
    let mut rows = Vec::new();
    frames::flatten(root, "", page.session.as_deref(), &mut rows);
    let frame = rows.first().ok_or("缺少登录页面身份")?;
    let observed = match frames::evaluate(&page, frame, probe).await {
        Ok(result) => result,
        Err(error) if crate::cdp_client::is_session_dead(&error) => return Err(error),
        Err(_) => json!({ "kind": "loading" }),
    };
    let mut observed = observed.as_object().cloned().ok_or("登录状态无效")?;
    observed.insert("url".into(), json!(frame.url));
    observed.insert("frameId".into(), json!(frame.id));
    observed.insert("loaderId".into(), json!(frame.loader_id));
    Ok(Value::Object(observed))
}
