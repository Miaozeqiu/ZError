//! evaluation implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn eval_score(v: &Value) -> i32 {
  if let Some(flag) = v.as_bool() {
    return if flag { 8 } else { -1 };
  }
  if v.is_null() || *v == json!({ "ok": false }) {
    return -1;
  }
  if let Some(text) = v.as_str() {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed == "null" || trimmed == "[]" || trimmed == "{}" {
      return 0;
    }
    return (trimmed.len().min(400) as i32) + 2;
  }
  let len = |key: &str| v.get(key).and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
  let extras = v
    .get("extras")
    .and_then(|x| x.as_array())
    .map(|a| {
      a.iter()
        .map(|e| {
          e.get("questions").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0)
            + e.get("works").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0)
        })
        .sum::<usize>()
    })
    .unwrap_or(0);
  let filled = v.get("filledCount").and_then(|x| x.as_i64()).unwrap_or(0) as usize;
  let jobs = len("jobs") + len("unfinished");
  let question_li = v.get("questionLi").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
  let work_li = v.get("workLi").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
  let catalog_li = v.get("catalogLi").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
  let catalog_score = if question_li > 0 { 0 } else { catalog_li * 8 };
  let has_progress = usize::from(
    v.get("hasProgress").and_then(|x| x.as_bool()).unwrap_or(false)
      || v
        .get("text")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .contains("已完成任务点"),
  ) * 50;
  let text_bonus = {
    let text = v.get("text").and_then(|x| x.as_str()).unwrap_or("");
    if catalog_li > 0 || has_progress > 0 {
      (text.len() / 800).min(40) as usize
    } else {
      0
    }
  };
  let question_score = if question_li > 0 {
    200 + question_li * 20
  } else {
    0
  };
  let url = v.get("url").and_then(|x| x.as_str()).unwrap_or("");
  let work_url_bonus = if question_li == 0
    && (url.contains("doHomeWork")
      || url.contains("work/do")
      || url.contains("workPreview")
      || url.contains("mooc-ans/work"))
  {
    40
  } else {
    0
  };
  let has_video = usize::from(
    v.get("hasVideo").and_then(|x| x.as_bool()).unwrap_or(false)
      && (v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0) > 1.0
        || v.get("current").and_then(|x| x.as_f64()).unwrap_or(0.0) > 0.2
        || v.get("ready").and_then(|x| x.as_u64()).unwrap_or(0) >= 1
        || !(v.get("paused").and_then(|x| x.as_bool()).unwrap_or(true))),
  );
  let tab_count = v
    .get("tabCount")
    .and_then(|x| x.as_u64())
    .unwrap_or(0) as usize;
  let tabs = if tab_count > 0 { tab_count } else { len("steps") };
  let tab_bonus = if tabs > 1 { 22 } else { 0 };
  let ok = usize::from(v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false));
  let found = usize::from(v.get("found").and_then(|x| x.as_bool()).unwrap_or(false));
  let point = usize::from(
    v.get("x").and_then(|x| x.as_f64()).is_some() && v.get("y").and_then(|x| x.as_f64()).is_some(),
  );
  (len("questions") * 10
    + len("works") * 5
    + extras * 4
    + filled
    + jobs * 3
    + question_score
    + work_url_bonus
    + work_li * 2
    + catalog_score
    + has_progress
    + text_bonus
    + has_video * 15
    + tab_bonus
    + ok
    + found * 8
    + point * 20
    + 1) as i32
}

pub(super) async fn eval_all_frames(id: &str, expression: &str) -> Result<Value, String> {
  let report = match tokio::time::timeout(Duration::from_millis(2200), eval_frames_inner(id, expression)).await {
    Ok(Ok(value)) => value,
    Ok(Err(err)) => return Err(err),
    Err(_) => json!({
      "frames": [],
      "result": Value::Null,
      "error": "扫帧超时",
    }),
  };
  if let Some(best) = report.get("result").cloned() {
    if !best.is_null() {
      return Ok(best);
    }
  }
  if let Some(err) = report.get("error").and_then(|v| v.as_str()) {
    if !err.is_empty() {
      return Err(err.to_string());
    }
  }
  Ok(Value::Null)
}

pub(super) fn skip_child_eval_url(url: &str) -> bool {
  let raw = url.trim();
  raw.is_empty()
    || raw.eq_ignore_ascii_case("about:blank")
    || raw.starts_with("about:blank")
    || raw.starts_with("chrome-error:")
    || raw.starts_with("devtools:")
    || raw.starts_with("chrome-extension:")
}

pub(super) async fn eval_frames_inner(id: &str, expression: &str) -> Result<Value, String> {
  let page = bind_page(id).await?;
  let mut rows = vec![(String::new(), page.url.clone(), page.conn.evaluate_ms(expression, page.session.as_deref(), 600).await)];
  let deadline = std::time::Instant::now() + Duration::from_millis(1600);
  if let Ok(Ok(contexts)) = tokio::time::timeout(Duration::from_millis(700), crate::cef::frames::contexts(&page)).await {
    let children: Vec<_> = contexts.iter().filter(|frame| !frame.path.is_empty() && !skip_child_eval_url(&frame.url)).collect();
    for batch in children.chunks(8) {
      if std::time::Instant::now() >= deadline { break; }
      let results = join_all(batch.iter().map(|frame| async {
        let result = tokio::time::timeout(Duration::from_millis(400), crate::cef::frames::evaluate(&page, frame, expression)).await
          .unwrap_or_else(|_| Err("frame 执行超时".into()));
        (frame.id.clone(), frame.url.clone(), result)
      })).await;
      rows.extend(results);
    }
  }
  let mut frames = Vec::new();
  let mut best = Value::Null;
  let mut best_score = -1;
  let mut last_err = String::new();
  // 同 URL 的多个播放器是不同 frame，不能按 URL 去重。
  for (frame_id, url, result) in rows {
    match result {
      Ok(value) => {
        let score = eval_score(&value);
        if score > best_score { best = value.clone(); best_score = score; }
        frames.push(json!({ "frameId": frame_id, "url": url, "result": value, "error": Value::Null }));
      }
      Err(error) => {
        let nice = format_eval_error_near(&error, expression);
        last_err = nice.clone();
        frames.push(json!({ "frameId": frame_id, "url": url, "result": Value::Null, "error": nice }));
      }
    }
  }
  Ok(json!({ "frames": frames, "result": best, "error": if best_score < 0 { last_err } else { String::new() } }))
}

pub async fn eval_script(_app: AppHandle, id: String, script: String) -> Result<String, String> {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  let value = eval_all_frames(&id, &prepare_eval_script(script)).await?;
  Ok(value.to_string())
}

/// 只跑顶层 page，不扫每个 iframe。任务点/进度从 top 自己下钻即可。
pub async fn eval_script_main(_app: AppHandle, id: String, script: String) -> Result<String, String> {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  let value = eval_main_json(&id, &prepare_eval_script(script)).await?;
  Ok(value.to_string())
}

pub async fn eval_script_frames(_app: AppHandle, id: String, script: String) -> Result<Value, String> {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  if script.len() > 20_000 {
    return Err("脚本过长（上限 20000 字）".into());
  }
  if script.contains("location.href=")
    || script.contains("location.replace")
    || script.contains("location.assign")
  {
    return Err("禁止用 eval 改 location。跳转用 browser_navigate / click。".into());
  }
  let touches_iframe = script.contains("contentDocument")
    || script.contains("contentWindow")
    || script.contains(".frames[");
  let mut report = match tokio::time::timeout(
    Duration::from_millis(2200),
    eval_frames_inner(&id, &prepare_eval_script(script)),
  ).await {
    Ok(Ok(value)) => value,
    Ok(Err(err)) => return Err(err),
    Err(_) => json!({
      "frames": [],
      "result": Value::Null,
      "error": "扫帧超时",
    }),
  };
  let hint = if touches_iframe {
    "检测到 iframe.contentDocument / contentWindow。CDP 已在每个 frame 内执行同一脚本，请直接用 document，不要跨框取 DOM。"
  } else {
    "脚本已在顶层和各 iframe 各跑一遍。写 document.querySelector 即可；不要 iframe.contentDocument。"
  };
  if let Some(obj) = report.as_object_mut() {
    obj.insert("hint".into(), json!(hint));
  }
  Ok(report)
}
