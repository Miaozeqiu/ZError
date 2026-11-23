//! evaluation implementation; the parent module preserves the public facade.
use super::*;

/// Agent 用：在每个 CDP frame 执行同一脚本，返回多帧结果（内部工具仍用 browser_eval 取 best）。
#[tauri::command]
pub async fn browser_eval_frames(
  app: AppHandle,
  id: String,
  script: String, expected_epoch: Option<u64>) -> Result<serde_json::Value, String> {
  crate::secret_browser::guard(&app, &id).await?;
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, false, expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::eval_script_frames(app, id, script).await;
  }
  {
    let value = browser_eval(app, id, script, None).await?;
    let parsed: serde_json::Value =
      serde_json::from_str(&value).unwrap_or_else(|_| serde_json::Value::String(value));
    Ok(serde_json::json!({
      "frames": [{ "url": "", "result": parsed, "error": null }],
      "result": parsed,
      "hint": "当前内核未走多帧 CDP；不要写 iframe.contentDocument。"
    }))
  }

  }).await
}

/// 只把深度 0 上的 return / const / let / 分号当成语句。嵌在函数里的 return 仍是表达式。
pub(super) fn top_level_statement(script: &str) -> bool {
  let chars: Vec<char> = script.chars().collect();
  let mut i = 0;
  let mut depth = 0i32;
  let mut quote = '\0';
  while i < chars.len() {
    let ch = chars[i];
    if quote != '\0' {
      if ch == '\\' {
        i += 2;
        continue;
      }
      if ch == quote {
        quote = '\0';
      }
      i += 1;
      continue;
    }
    if ch == '"' || ch == '\'' || ch == '`' {
      quote = ch;
      i += 1;
      continue;
    }
    if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
      while i < chars.len() && chars[i] != '\n' {
        i += 1;
      }
      continue;
    }
    if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
      i += 2;
      while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
        i += 1;
      }
      i = (i + 2).min(chars.len());
      continue;
    }
    if ch == '(' || ch == '{' || ch == '[' {
      depth += 1;
      i += 1;
      continue;
    }
    if ch == ')' || ch == '}' || ch == ']' {
      depth = (depth - 1).max(0);
      i += 1;
      continue;
    }
    if depth == 0 {
      if ch == ';' {
        return true;
      }
      if ch == '_' || ch == '$' || ch.is_ascii_alphabetic() {
        let start = i;
        i += 1;
        while i < chars.len()
          && (chars[i] == '_' || chars[i] == '$' || chars[i].is_ascii_alphanumeric())
        {
          i += 1;
        }
        let word: String = chars[start..i].iter().collect();
        if matches!(
          word.as_str(),
          "return"
            | "const"
            | "let"
            | "var"
            | "function"
            | "class"
            | "if"
            | "for"
            | "while"
            | "do"
            | "switch"
            | "try"
            | "throw"
        ) {
          return true;
        }
        continue;
      }
    }
    i += 1;
  }
  false
}

pub(crate) fn prepare_eval_script(script: &str) -> String {
  let trimmed = script.trim();
  if trimmed.is_empty() {
    return trimmed.to_string();
  }
  // 只有整段已是 IIFE 表达式时才原样代入。
  // 不能单靠 ends_with(")()")：`function foo(){} (function(){})()` 也会命中。
  let already = trimmed.starts_with("(function")
    || trimmed.starts_with("(()=>")
    || trimmed.starts_with("(() =>")
    || trimmed.starts_with("(async");
  if already {
    return trimmed.to_string();
  }
  // 顶层 return / const / let 才包成函数体。嵌套 return 仍按表达式 return。
  if top_level_statement(trimmed) {
    return format!("(function(){{\n{trimmed}\n}})()");
  }
  format!("(function(){{ return ({trimmed}); }})()")
}

#[cfg(any(test, target_os = "macos"))]
pub(super) fn syntax_place(raw: &str, script: &str) -> String {
  let col = serde_json::from_str::<serde_json::Value>(raw)
    .ok()
    .and_then(|v| {
      v.get("columnNumber")
        .and_then(|n| n.as_u64())
        .or_else(|| v.pointer("/exceptionDetails/columnNumber").and_then(|n| n.as_u64()))
    });
  let Some(col) = col else {
    return "脚本里".into();
  };
  let chars: Vec<char> = script.chars().collect();
  if chars.is_empty() {
    return format!("第 {col} 列");
  }
  let idx = (col as usize).min(chars.len().saturating_sub(1));
  let start = idx.saturating_sub(10);
  let end = (idx + 10).min(chars.len());
  let near: String = chars[start..end].iter().collect();
  if near.is_empty() {
    format!("第 {col} 列")
  } else {
    format!("第 {col} 列附近「{near}」")
  }
}

/// 把 CDP exceptionDetails JSON 收成短中文，方便 Agent 看。
#[cfg(test)]
pub(crate) fn format_eval_error(raw: &str) -> String {
  format_eval_error_near(raw, "")
}

#[cfg(any(test, target_os = "macos"))]
pub(crate) fn format_eval_error_near(raw: &str, script: &str) -> String {
  let lower = raw.to_ascii_lowercase();
  let syntax = lower.contains("syntaxerror")
    || lower.contains("unexpected token")
    || lower.contains("illegal return");
  let place = syntax_place(raw, script);
  if lower.contains("illegal return statement") {
    return format!(
      "脚本语法错：顶层不能写 return。错在{place}。多数信息在 get_page 的 video 行、[done] 标记里。"
    );
  }
  if syntax {
    let desc = serde_json::from_str::<serde_json::Value>(raw)
      .ok()
      .and_then(|v| {
        v.pointer("/exception/description")
          .or_else(|| v.pointer("/exception/value"))
          .and_then(|x| x.as_str())
          .map(|text| text.chars().take(120).collect::<String>())
      })
      .filter(|text| !text.is_empty())
      .unwrap_or_else(|| "脚本语法错".into());
    return format!("{desc}。错在{place}。多数信息在 get_page 的 video 行、[done] 标记里。");
  }
  if raw.contains("contentDocument")
    || raw.contains("Blocked a frame")
    || lower.contains("cross-origin")
    || raw.contains("iframe not accessible")
  {
    return "不要读 iframe.contentDocument。CDP 会在每个 frame 内执行脚本，直接用 document / querySelector。".into();
  }
  if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
    let desc = v
      .pointer("/exception/description")
      .or_else(|| v.pointer("/exception/value"))
      .or_else(|| v.get("text"))
      .and_then(|x| x.as_str())
      .unwrap_or("");
    if !desc.is_empty() {
      return desc.chars().take(240).collect();
    }
  }
  raw.chars().take(240).collect()
}

#[cfg(not(target_os = "linux"))]
pub(super) fn new_eval_token() -> String {
  format!(
    "{:x}{:x}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|value| value.as_nanos())
      .unwrap_or(0),
    std::process::id()
  )
}

#[tauri::command]
pub async fn browser_eval_main(app: AppHandle, id: String, script: String, expected_epoch: Option<u64>) -> Result<String, String> {
  crate::secret_browser::guard(&app, &id).await?;
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, false, expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::eval_script_main(app, id, script).await;
  }
  browser_eval(app, id, script, None).await

  }).await
}

#[tauri::command]
pub async fn browser_eval(app: AppHandle, id: String, script: String, expected_epoch: Option<u64>) -> Result<String, String> {
  #[cfg(windows)]
  let _operation = crate::webview2_secrets::lock(&id).await;
  crate::secret_browser::guard(&app, &id).await?;
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, false, expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::eval_script(app, id, script).await;
  }
  {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  if script.len() > 400_000 {
    return Err("脚本过长".into());
  }
  let webview = find_browser(&app, &id)?;
  #[cfg(target_os = "linux")]
  return super::evaluation_linux::evaluate(&webview, prepare_eval_script(script)).await;
  #[cfg(not(target_os = "linux"))]
  {
  let token = new_eval_token();
  let prepared = prepare_eval_script(script);
  let mut wrapped = String::from("(function(){\n  var prev = document.title;\n  try {\n    var value = ");
  wrapped.push_str(&prepared);
  wrapped.push_str(";\n    window.__ZE_EVAL_MAP__ = window.__ZE_EVAL_MAP__ || {};\n    window.__ZE_EVAL_MAP__[\"");
  wrapped.push_str(&token);
  wrapped.push_str("\"] = { buf: JSON.stringify(value === undefined ? null : value), off: 0 };\n    document.title = \"ZRRESULT:");
  wrapped.push_str(&token);
  wrapped.push_str(":__READY__\";\n  } catch (e) {\n    window.__ZE_EVAL_MAP__ = window.__ZE_EVAL_MAP__ || {};\n    window.__ZE_EVAL_MAP__[\"");
  wrapped.push_str(&token);
  wrapped.push_str("\"] = { buf: JSON.stringify({__error: String(e && e.message || e)}), off: 0 };\n    document.title = \"ZRRESULT:");
  wrapped.push_str(&token);
  wrapped.push_str(":__READY__\";\n  }\n  setTimeout(function(){ document.title = prev; }, 30);\n})();");
  let first = eval_wait_title(&webview, token.clone(), wrapped).await?;
  if first != "__READY__" {
    return Ok(first);
  }
  let mut out = String::new();
  for _ in 0..200 {
    let chunk_token = new_eval_token();
    let chunk_js = format!(
      r#"(function(){{
  var prev = document.title;
  var slot = (window.__ZE_EVAL_MAP__ || {{}})["{src}"];
  var s = slot ? String(slot.buf || '') : '';
  var off = slot ? (slot.off | 0) : 0;
  var chunk = s.slice(off, off + 360);
  if (slot) slot.off = off + chunk.length;
  document.title = "ZRRESULT:{chunk_token}:" + JSON.stringify({{c: chunk, d: !slot || slot.off >= s.length}});
  setTimeout(function(){{ document.title = prev; }}, 20);
}})();"#,
      src = token,
      chunk_token = chunk_token
    );
    let raw = eval_wait_title(&webview, chunk_token, chunk_js).await?;
    let parsed: serde_json::Value =
      serde_json::from_str(&raw).map_err(|_| "读取执行结果失败".to_string())?;
    if let Some(chunk) = parsed.get("c").and_then(|v| v.as_str()) {
      out.push_str(chunk);
    }
    if parsed.get("d").and_then(|v| v.as_bool()).unwrap_or(false) {
      let _ = webview.eval(&format!(
        r#"(function(){{ try {{ if (window.__ZE_EVAL_MAP__) delete window.__ZE_EVAL_MAP__["{token}"]; }} catch (e) {{}} }})();"#
      ));
      return Ok(out);
    }
  }
  Err("执行结果过长".into())
  }
  }

  }).await
}
