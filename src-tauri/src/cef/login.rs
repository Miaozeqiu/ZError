use super::{bind_page, frames};
use serde_json::{json, Value};

pub async fn observe(id: &str, args: &Value) -> Result<Value, String> {
    let page = bind_page(id).await?;
    let tree = page
        .conn
        .call("Page.getFrameTree", json!({}), page.session.as_deref())
        .await?;
    let root = tree.pointer("/frameTree/frame").ok_or("登录页面尚未就绪")?;
    let mut rows = Vec::new();
    frames::flatten(root, "", page.session.as_deref(), &mut rows);
    let frame = rows.first().ok_or("缺少登录页面身份")?;
    if args["url"].as_str() != Some(frame.url.as_str()) {
        return Ok(json!({"url": frame.url}));
    }
    let (probe, rules) = crate::browser_login::observation(&frame.url, args)?;
    let observed = match frames::evaluate(&page, frame, &probe).await {
        Ok(result) => result,
        Err(error) if crate::cdp_client::is_session_dead(&error) => return Err(error),
        Err(_) => Value::Null,
    };
    let current = page
        .conn
        .call("Page.getFrameTree", json!({}), page.session.as_deref())
        .await?;
    let current = current
        .pointer("/frameTree/frame")
        .ok_or("登录页面尚未就绪")?;
    if ["id", "loaderId", "url"]
        .iter()
        .any(|key| current.get(key) != root.get(key))
    {
        return Ok(json!({}));
    }
    Ok(crate::browser_login::finish_observation(
        &frame.url,
        &frame.id,
        &frame.loader_id,
        observed,
        rules,
    ))
}
