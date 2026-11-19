use serde_json::{json, Value};

const OBSERVE: &str = include_str!("browser_login_observe.js");

// Only the built-in reader runs in a page. A repository supplies bounded data
// for the reader and never receives the inspected text or form values.
pub(crate) fn observation(
    url: &str,
    args: &Value,
) -> Result<(String, Vec<(usize, regex::Regex)>), String> {
    let document = url::Url::parse(url).map_err(|_| "登录页面地址无效")?;
    if document.scheme() != "https"
        || document.host_str().is_none()
        || !document.username().is_empty()
        || document.password().is_some()
    {
        return Err("登录页面必须使用 HTTPS".into());
    }
    let rules = args["rules"]
        .as_array()
        .filter(|rows| rows.len() <= 32)
        .ok_or("登录页面观察规则无效")?;
    let mut patterns = Vec::new();
    let mut queries = Vec::with_capacity(rules.len());
    for (index, rule) in rules.iter().enumerate() {
        let selector = rule["selector"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 512)
            .ok_or("登录页面选择器无效")?;
        let kind = rule["kind"].as_str().ok_or("缺少登录页面观察类型")?;
        match kind {
            "visible" | "editable" | "hidden_flag" | "image" | "frame_path" => (),
            "parameter" => {
                let expected = rule["pattern"]
                    .as_str()
                    .filter(|s| s.len() <= 32)
                    .ok_or("登录参数匹配规则无效")?;
                queries.push(json!({"selector": selector, "kind": kind, "expected": expected}));
                continue;
            }
            "text" => {
                let pattern = rule["pattern"]
                    .as_str()
                    .filter(|s| s.len() <= 512)
                    .ok_or("登录页面匹配规则无效")?;
                let pattern = regex::RegexBuilder::new(pattern)
                    .size_limit(131_072)
                    .build()
                    .map_err(|_| "登录页面匹配规则无效")?;
                patterns.push((index, pattern));
            }
            _ => return Err("不支持的登录页面观察类型".into()),
        }
        queries.push(json!({"selector": selector, "kind": kind}));
    }
    Ok((
        format!("({OBSERVE})({}, {})", json!(url), json!(queries)),
        patterns,
    ))
}

pub(crate) fn finish_observation(
    url: &str,
    frame: &str,
    loader: &str,
    observed: Value,
    patterns: Vec<(usize, regex::Regex)>,
) -> Value {
    let observed = crate::secret_vault::redact_best_effort(observed);
    let mut matches = observed.as_array().cloned().unwrap_or_default();
    for (index, pattern) in patterns {
        if let Some(row) = matches.get_mut(index) {
            let matched = row.as_array().is_some_and(|texts| {
                texts
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|text| pattern.is_match(text))
            });
            *row = json!(matched);
        }
    }
    json!({"url": url, "frameId": frame, "loaderId": loader, "matches": matches})
}
