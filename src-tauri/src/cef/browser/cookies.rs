//! cookies implementation; the parent module preserves the public facade.
use super::*;

pub fn cookie_header_from(cookies: &[Value]) -> String {
  cookies
    .iter()
    .filter_map(|c| {
      let name = c.get("name")?.as_str()?;
      let value = c.get("value")?.as_str()?;
      Some(format!("{name}={value}"))
    })
    .collect::<Vec<_>>()
    .join("; ")
}

pub async fn cookie_header(id: &str, url: &str) -> Result<String, String> {
  Ok(cookie_header_from(&cookies_json(id, url).await?))
}

pub async fn set_cookies(id: &str, cookies: Vec<Value>, fallback_url: &str) -> Result<Value, String> {
  let page = bind_page(id).await?;
  let _ = page
    .conn
    .call("Network.enable", json!({}), page.session.as_deref())
    .await;
  let mut saved = 0i64;
  let mut errors: Vec<String> = Vec::new();
  for item in cookies {
    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
    let value = item.get("value").and_then(|v| v.as_str()).unwrap_or("");
    if name.is_empty() {
      errors.push("cookie 缺少 name".into());
      continue;
    }
    let mut payload = json!({ "name": name, "value": value });
    let url = item
      .get("url")
      .and_then(|v| v.as_str())
      .map(str::trim)
      .filter(|s| !s.is_empty())
      .unwrap_or(fallback_url);
    if !url.is_empty() {
      payload["url"] = json!(url);
    }
    if let Some(domain) = item.get("domain").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
      payload["domain"] = json!(domain);
    }
    if let Some(path) = item.get("path").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
      payload["path"] = json!(path);
    }
    if let Some(http_only) = item.get("httpOnly").and_then(|v| v.as_bool()) {
      payload["httpOnly"] = json!(http_only);
    }
    if let Some(secure) = item.get("secure").and_then(|v| v.as_bool()) {
      payload["secure"] = json!(secure);
    }
    if let Some(same_site) = item.get("sameSite").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
      payload["sameSite"] = json!(same_site);
    }
    if payload.get("url").is_none() && payload.get("domain").is_none() {
      errors.push(format!("{name}: 缺少 url 或 domain"));
      continue;
    }
    match page
      .conn
      .call("Network.setCookie", payload, page.session.as_deref())
      .await
    {
      Ok(res) if res.get("success").and_then(|v| v.as_bool()) != Some(false) => saved += 1,
      Ok(_) => errors.push(format!("{name}: 写入失败")),
      Err(err) => errors.push(format!("{name}: {err}")),
    }
  }
  Ok(json!({
    "ok": errors.is_empty(),
    "saved": saved,
    "error": if errors.is_empty() { Value::Null } else { json!(errors.join("；")) },
  }))
}

pub async fn clear_cookies(
  id: &str,
  url: &str,
  name: Option<String>,
  domain: Option<String>,
) -> Result<Value, String> {
  let page = bind_page(id).await?;
  let _ = page
    .conn
    .call("Network.enable", json!({}), page.session.as_deref())
    .await;
  if let Some(name) = name.filter(|s| !s.trim().is_empty()) {
    let mut payload = json!({ "name": name });
    if !url.is_empty() {
      payload["url"] = json!(url);
    }
    if let Some(domain) = domain.filter(|s| !s.trim().is_empty()) {
      payload["domain"] = json!(domain);
    }
    page
      .conn
      .call("Network.deleteCookies", payload, page.session.as_deref())
      .await?;
    return Ok(json!({ "ok": true, "cleared": 1 }));
  }
  let list = cookies_json(id, url).await?;
  let mut cleared = 0i64;
  for cookie in list {
    let Some(cname) = cookie.get("name").and_then(|v| v.as_str()) else { continue };
    let mut payload = json!({ "name": cname });
    if let Some(curl) = cookie.get("url").and_then(|v| v.as_str()) {
      payload["url"] = json!(curl);
    } else if !url.is_empty() {
      payload["url"] = json!(url);
    }
    if let Some(cdomain) = cookie.get("domain").and_then(|v| v.as_str()) {
      payload["domain"] = json!(cdomain);
    }
    if let Some(cpath) = cookie.get("path").and_then(|v| v.as_str()) {
      payload["path"] = json!(cpath);
    }
    if page
      .conn
      .call("Network.deleteCookies", payload, page.session.as_deref())
      .await
      .is_ok()
    {
      cleared += 1;
    }
  }
  Ok(json!({ "ok": true, "cleared": cleared }))
}

pub async fn cookies_json(id: &str, url: &str) -> Result<Vec<Value>, String> {
  let page = bind_page(id).await?;
  let _ = page
    .conn
    .call("Network.enable", json!({}), page.session.as_deref())
    .await;
  let mut urls = vec![url.to_string()];
  if let Ok(parsed) = url::Url::parse(url) {
    if let Some(host) = parsed.host_str() {
      urls.push(format!("https://{host}/"));
    }
  }
  let result = page
    .conn
    .call(
      "Network.getCookies",
      json!({ "urls": urls }),
      page.session.as_deref(),
    )
    .await
    .unwrap_or(Value::Null);
  Ok(
    result
      .get("cookies")
      .and_then(|v| v.as_array())
      .cloned()
      .unwrap_or_default(),
  )
}
