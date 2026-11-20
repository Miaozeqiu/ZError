//! snapshot implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn input_fields_of(raw: &Value) -> Vec<InputField> {
  let Some(list) = raw.as_array() else {
    return Vec::new();
  };
  list
    .iter()
    .map(|row| InputField {
      id: row.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      name: row.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      placeholder: row.get("placeholder").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      title: row.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      aria: row.get("aria").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      used: false,
    })
    .filter(|field| !field.id.is_empty() || !field.placeholder.is_empty() || !field.title.is_empty() || !field.aria.is_empty())
    .collect()
}

pub(super) fn take_input_field<'a>(ax_name: &str, fields: &'a mut [InputField]) -> Option<&'a InputField> {
  let ax = ax_name.trim();
  if ax.is_empty() || ax == "(无文案)" {
    let idx = fields.iter().position(|field| !field.used && !field.placeholder.is_empty())?;
    fields[idx].used = true;
    return Some(&fields[idx]);
  }
  let idx = fields.iter().position(|field| {
    !field.used && (field.title == ax || field.aria == ax || field.placeholder == ax)
  })?;
  fields[idx].used = true;
  Some(&fields[idx])
}

/// 无障碍名经常来自看不见的 title。框里写着的占位符才是页面上的字。
pub(super) fn visible_input_name(ax_name: &str, field: &InputField) -> String {
  let ph = field.placeholder.trim();
  let ax = ax_name.trim();
  if !ph.is_empty() && ph != ax && (ax.is_empty() || ax == "(无文案)" || field.title == ax || field.aria == ax) {
    return ph.to_string();
  }
  ax.to_string()
}

pub(super) fn css_attr(value: &str) -> String {
  value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub(super) fn input_css(field: &InputField) -> Option<String> {
  let id = field.id.trim();
  if !id.is_empty()
    && id.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
    && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':')
  {
    return Some(format!("#{id}"));
  }
  if !id.is_empty() {
    let esc = css_attr(id);
    return Some(format!("[id=\"{esc}\"]"));
  }
  let ph = field.placeholder.trim();
  if !ph.is_empty() {
    let esc = css_attr(ph);
    return Some(format!("input[placeholder=\"{esc}\"],textarea[placeholder=\"{esc}\"]"));
  }
  let name = field.name.trim();
  if !name.is_empty() {
    let esc = css_attr(name);
    return Some(format!("input[name=\"{esc}\"],textarea[name=\"{esc}\"]"));
  }
  None
}

pub(super) fn rewrite_textbox_refs(refs: &mut [Value], raw_fields: &Value) {
  let mut fields = input_fields_of(raw_fields);
  for node in refs.iter_mut() {
    let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("");
    if !matches!(role, "textbox" | "searchbox") {
      continue;
    }
    let ax = node.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let Some(field) = take_input_field(&ax, &mut fields) else {
      continue;
    };
    let show = visible_input_name(&ax, field);
    let Some(css) = input_css(field) else {
      continue;
    };
    let backend = node.pointer("/locator/backend").and_then(Value::as_i64).unwrap_or(0);
    if let Some(obj) = node.as_object_mut() {
      obj.insert("name".into(), json!(show));
      obj.insert("locator".into(), json!({ "by": "css", "value": css, "name": show }));
      if backend > 0 {
        if let Some(locator) = obj.get_mut("locator") { locator["backend"] = json!(backend); }
      }
    }
  }
}

/// 超长标题截断保留。整条丢掉时，章节名超过 96 字就从快照里消失。
pub(super) fn clip_ax_name(role: &str, raw_in: &str) -> Option<String> {
  let raw = raw_in.trim();
  let max_len = if matches!(role, "treeitem" | "listitem" | "option") {
    120
  } else {
    96
  };
  if raw.is_empty() {
    if role == "video" {
      return Some("视频".into());
    }
    if role == "audio" {
      return Some("音频".into());
    }
    if !matches!(role, "button" | "link" | "textbox" | "tab" | "checkbox") {
      return None;
    }
    return Some("(无文案)".into());
  }
  if raw.chars().count() > max_len {
    let keep = max_len.saturating_sub(1);
    let cut: String = raw.chars().take(keep).collect();
    return Some(format!("{cut}…"));
  }
  Some(raw.to_string())
}

#[cfg(test)]
pub(super) fn usable_frame_url(url: &str) -> bool {
  let u = url.trim().to_ascii_lowercase();
  !(u.is_empty() || u == "about:blank" || u.starts_with("about:") || u.starts_with("javascript:"))
}

pub(super) fn child_frame_cap(query: &SnapshotQuery) -> usize {
  if query.acted {
    let has = query
      .frame
      .as_deref()
      .map(|item| !item.trim().is_empty())
      .unwrap_or(false);
    if has { 1 } else { 0 }
  } else {
    query.max_frames.clamp(1, 8)
  }
}

pub(super) fn frame_url_matches(url: &str, want: &str) -> bool {
  let needle = want.trim().to_ascii_lowercase();
  if needle.is_empty() {
    return false;
  }
  url.to_ascii_lowercase().contains(&needle)
}

pub(super) fn ax_prop<'a>(node: &'a Value, key: &str) -> Option<&'a str> {
  let props = node.get("properties")?.as_array()?;
  for prop in props {
    if prop.get("name").and_then(|v| v.as_str()) != Some(key) {
      continue;
    }
    return prop
      .get("value")
      .and_then(|v| v.get("value"))
      .and_then(|v| v.as_str())
      .or_else(|| prop.get("value").and_then(|v| v.as_str()));
  }
  None
}

pub(super) fn format_snap_line(
  indent: &str,
  role: &str,
  name: &str,
  id: &str,
  href: &str,
  media: &str,
  mark: &str,
) -> String {
  let media_bit = if media.is_empty() { String::new() } else { format!(" {media}") };
  let href_bit = if href.is_empty() { String::new() } else { format!(" {href}") };
  let mark_bit = match mark {
    "done" | "current" | "locked" => format!(" [{mark}]"),
    _ => String::new(),
  };
  format!("{indent}- {role} \"{name}\"{media_bit} [ref={id}]{href_bit}{mark_bit}")
}

pub(super) fn push_named_ref(
  lines: &mut Vec<String>,
  refs: &mut Vec<Value>,
  seen: &mut HashSet<String>,
  role: &str,
  name: &str,
  backend: i64,
  limit: usize,
  url: &str,
  media: &str,
  mark: &str,
  nth: i64,
) {
  if refs.len() >= limit {
    return;
  }
  let Some(name) = clip_ax_name(role, name) else {
    return;
  };
  // 同名按钮各记一颗。按名字去重会把五门课的「进入学习」收成一个。
  let key = if matches!(role, "video" | "audio") {
    format!("{role}:{nth}:{name}")
  } else if backend > 0 {
    format!("{role}:{backend}")
  } else {
    format!("{role}:{name}")
  };
  if !seen.insert(key) {
    return;
  }
  if !matches!(
    role,
    "button"
      | "link"
      | "textbox"
      | "heading"
      | "tab"
      | "checkbox"
      | "menuitem"
      | "listitem"
      | "treeitem"
      | "option"
      | "radio"
      | "switch"
      | "video"
      | "audio"
  ) {
    return;
  }
  let id = format!("e{}", refs.len() + 1);
  let href = if role == "link" && url.starts_with("http") { url } else { "" };
  lines.push(format_snap_line("", role, &name, &id, href, media, mark));
  let locator = if matches!(role, "video" | "audio") {
    json!({ "by": "css", "value": role, "nth": if nth > 0 { nth } else { 1 }, "name": name, "role": role })
  } else if backend > 0 {
    json!({ "by": "role", "value": role, "name": name, "exact": true, "backend": backend })
  } else if matches!(role, "textbox" | "searchbox" | "combobox") {
    json!({ "by": "role", "value": role, "name": name, "exact": true })
  } else if matches!(role, "treeitem" | "menuitem" | "tab" | "button" | "link" | "option" | "listitem") {
    json!({ "by": "role", "value": role, "name": name, "exact": true })
  } else {
    json!({ "by": "text", "value": name, "exact": true })
  };
  refs.push(json!({
    "id": id,
    "role": role,
    "name": name,
    "mark": mark,
    "media": media,
    "locator": locator,
  }));
}

pub(super) fn push_ax_nodes(
  nodes: &[Value],
  lines: &mut Vec<String>,
  refs: &mut Vec<Value>,
  seen: &mut HashSet<String>,
  limit: usize,
) {
  for node in nodes {
    if node["ignored"].as_bool() == Some(true) { continue; }
    if refs.len() >= limit {
      break;
    }
    let name = node
      .get("name")
      .and_then(|v| v.get("value"))
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .trim()
      .to_string();
    let role = node
      .get("role")
      .and_then(|v| v.get("value"))
      .and_then(|v| v.as_str())
      .unwrap_or("generic");
    let backend = node.get("backendDOMNodeId").and_then(|v| v.as_i64()).unwrap_or(0);
    let url = ax_prop(node, "url").unwrap_or("");
    let before = refs.len();
    push_named_ref(lines, refs, seen, role, &name, backend, limit, url, "", "", 0);
    if refs.len() > before {
      if let Some(out) = refs.last_mut().and_then(Value::as_object_mut) {
        if let Some(props) = node["properties"].as_array() {
          for prop in props {
            let key = prop["name"].as_str().unwrap_or("");
            if matches!(key, "checked" | "disabled") {
              let value = &prop["value"]["value"];
              if value.is_boolean() { out.insert(key.into(), value.clone()); }
              else if value == "true" || value == "false" { out.insert(key.into(), json!(value == "true")); }
            }
          }
        }
      }
    }
  }
}

pub(super) fn push_dom_nodes(
  nodes: &Value,
  lines: &mut Vec<String>,
  refs: &mut Vec<Value>,
  seen: &mut HashSet<String>,
  limit: usize,
) {
  let Some(list) = nodes.as_array() else { return };
  for node in list {
    let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("button");
    let media = node.get("media").and_then(|v| v.as_str()).unwrap_or("");
    let mark = node.get("mark").and_then(|v| v.as_str()).unwrap_or("");
    let nth = node.get("nth").and_then(|v| v.as_i64()).unwrap_or(0);
    if refs.iter().any(|r| r["role"] == role && r["name"] == name && r["locator"]["backend"].as_i64().unwrap_or(0) > 0) { continue; }
    if let Some(selector) = node.pointer("/locator/value").and_then(Value::as_str).filter(|s| !s.is_empty()) {
      if refs.len() >= limit || !seen.insert(format!("dom:{selector}")) { continue; }
      let mut row = node.clone();
      row["id"] = json!(format!("e{}", refs.len() + 1));
      refs.push(row);
    } else {
      push_named_ref(lines, refs, seen, role, name, 0, limit, "", media, mark, nth);
    }
  }
}

pub(super) async fn ax_of(conn: &CdpConn, session: Option<&str>, frame_id: &str) -> Vec<Value> {
  let params = if frame_id.is_empty() {
    json!({})
  } else {
    json!({ "frameId": frame_id })
  };
  let tree = conn
    .call("Accessibility.getFullAXTree", params, session)
    .await
    .unwrap_or(json!({}));
  tree.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default()
}

pub(super) fn frame_snap_priority(url: &str, ref_count: usize) -> i32 {
  let u = url.trim().to_ascii_lowercase();
  if u.is_empty() || u == "about:blank" || u.starts_with("about:") {
    return 0;
  }
  10 + ref_count as i32
}

pub(super) async fn collect_frame_snap(
  conn: &CdpConn,
  session: Option<&str>,
  url_hint: &str,
  limit: usize,
  top: bool,
  context: Option<&crate::cef::frames::FrameContext>,
) -> FrameSnap {
  let url = conn
    .evaluate("location.href", session)
    .await
    .ok()
    .and_then(|v| v.as_str().map(str::to_string))
    .unwrap_or_else(|| url_hint.to_string());
  let mut lines = Vec::new();
  let mut refs = Vec::new();
  let mut seen = HashSet::new();
  let _ = conn.call("Accessibility.enable", json!({}), session).await;
  push_ax_nodes(&ax_of(conn, session, context.map(|f| f.id.as_str()).unwrap_or("")).await, &mut lines, &mut refs, &mut seen, limit);
  if let Ok(dom) = conn.evaluate(COLLECT_DOM, session).await {
    push_dom_nodes(&dom, &mut lines, &mut refs, &mut seen, limit);
  }
  if let Ok(fields) = conn.evaluate(INPUT_FIELDS, session).await {
    rewrite_textbox_refs(&mut refs, &fields);
  }
  let priority = frame_snap_priority(&url, refs.len());
  FrameSnap {
    url,
    path: String::new(),
    label: String::new(),
    lines,
    refs,
    priority,
    top,
    cross: false,
    identity: context.cloned(),
  }
}

pub(super) fn content_rank(node: &Value) -> i32 {
  let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("");
  let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("");
  if matches!(role, "video" | "audio") {
    return -1;
  }
  if matches!(role, "treeitem" | "listitem" | "option" | "row") {
    return 0;
  }
  if matches!(role, "textbox" | "searchbox" | "combobox") {
    return 1;
  }
  if name.contains("ICP") || name.contains("版权") || name.contains("联系我们") || name.contains("备案") {
    return 9;
  }
  if matches!(role, "button" | "tab" | "menuitem") {
    return 2;
  }
  5
}

/// 名额不够时先留目录行，页脚链接往后排。返回省略的 treeitem 数。
pub(super) fn prefer_content_refs(refs: &[Value], limit: usize) -> (Vec<Value>, usize) {
  let tree_total = refs
    .iter()
    .filter(|node| node.get("role").and_then(|v| v.as_str()) == Some("treeitem"))
    .count();
  let mut indexed: Vec<(i32, usize, Value)> = refs
    .iter()
    .cloned()
    .enumerate()
    .map(|(index, node)| (content_rank(&node), index, node))
    .collect();
  indexed.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
  let taken: Vec<Value> = indexed.into_iter().take(limit).map(|(_, _, node)| node).collect();
  let tree_taken = taken
    .iter()
    .filter(|node| node.get("role").and_then(|v| v.as_str()) == Some("treeitem"))
    .count();
  (taken, tree_total.saturating_sub(tree_taken))
}

/// 顶层最多占一半名额，剩下的按框轮流取，避免目录把视频框挤掉。
pub(super) fn take_counts(lengths: &[usize], top_index: usize, limit: usize) -> Vec<usize> {
  let mut counts = vec![0usize; lengths.len()];
  let has_child = lengths.iter().enumerate().any(|(index, _)| index != top_index);
  let top_cap = if has_child { limit / 2 } else { limit };
  let top_len = lengths.get(top_index).copied().unwrap_or(0);
  if top_index < counts.len() {
    counts[top_index] = top_len.min(top_cap).min(limit);
  }
  let mut rest = limit.saturating_sub(counts.get(top_index).copied().unwrap_or(0));
  let mut cursors = vec![0usize; lengths.len()];
  while rest > 0 {
    let mut progressed = false;
    for index in 0..lengths.len() {
      if index == top_index || rest == 0 {
        continue;
      }
      if cursors[index] < lengths[index] {
        cursors[index] += 1;
        counts[index] += 1;
        rest -= 1;
        progressed = true;
      }
    }
    if !progressed {
      break;
    }
  }
  counts
}

pub(super) fn snap_from_dom(path: &str, label: &str, src: &str, nodes: &Value, cross: bool) -> FrameSnap {
  let mut lines = Vec::new();
  let mut refs = Vec::new();
  if !cross {
    let mut seen = HashSet::new();
    push_dom_nodes(nodes, &mut lines, &mut refs, &mut seen, 110);
  }
  let count = if cross { 0 } else { refs.len() };
  FrameSnap {
    url: src.to_string(),
    path: path.to_string(),
    label: label.to_string(),
    lines,
    refs,
    priority: frame_snap_priority(src, count),
    top: false,
    cross,
    identity: None,
  }
}

pub(super) fn assign_nth(nodes: &mut [Value]) {
  let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
  for (index, node) in nodes.iter().enumerate() {
    let locator = node.get("locator").cloned().unwrap_or(json!({}));
    if locator["backend"].as_i64().unwrap_or(0) > 0 { continue; }
    let by = locator.get("by").and_then(|v| v.as_str()).unwrap_or("");
    let value = locator.get("value").and_then(|v| v.as_str()).unwrap_or("");
    let name = locator.get("name").and_then(|v| v.as_str()).unwrap_or("");
    groups.entry(format!("{by}\n{value}\n{name}")).or_default().push(index);
  }
  for indexes in groups.values() {
    if indexes.len() < 2 {
      continue;
    }
    for (nth, index) in indexes.iter().enumerate() {
      if let Some(obj) = nodes[*index].get_mut("locator").and_then(|v| v.as_object_mut()) {
        obj.insert("nth".into(), json!(nth + 1));
      }
    }
  }
}

#[cfg(test)]
pub(super) fn frame_tree_rows(node: &Value, path: &str, depth: u8, out: &mut Vec<(String, String, String)>) {
  if depth as usize > crate::cef::frames::MAX_FRAME_DEPTH {
    return;
  }
  let frame = node.get("frame").unwrap_or(node);
  let id = frame.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
  let url = frame.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
  out.push((path.to_string(), id, url));
  let Some(kids) = node.get("childFrames").and_then(|v| v.as_array()) else {
    return;
  };
  for (index, kid) in kids.iter().enumerate() {
    let child = if path.is_empty() { index.to_string() } else { format!("{path}/{index}") };
    frame_tree_rows(kid, &child, depth + 1, out);
  }
}

pub async fn cdp_snapshot(_app: AppHandle, id: String, query: SnapshotQuery) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let contexts = crate::cef::frames::contexts(&page).await?;
  let metadata = page.conn.evaluate(COLLECT_FRAMES, page.session.as_deref()).await.unwrap_or(json!([]));
  let mut frames = Vec::new();
  let mut frames_capped = false;
  let mut cross_count = 0;
  let mut selected = 0;
  for context in &contexts {
    let top = context.path.is_empty();
    let meta = metadata.as_array().and_then(|rows| rows.iter().find(|row| row["path"].as_str() == Some(context.path.as_str())));
    if meta.and_then(|m| m["hidden"].as_bool()) == Some(true) { continue; }
    let label = meta.and_then(|m| m["label"].as_str()).filter(|s| !s.is_empty()).unwrap_or(&context.name);
    if !top && meta.is_none() && !crate::cef::frames::visible(&page, &contexts, context).await { continue; }
    if !top && selected >= crate::cef::frames::MAX_FRAMES { frames_capped = true; continue; }
    if !top && query.acted {
      let want = query.frame.as_deref().unwrap_or("");
      if want.is_empty() || !(want == context.id || want == context.path || want == label || frame_url_matches(&context.url, want)) { continue; }
      if selected >= 1 { frames_capped = true; continue; }
    }
    let cross = context.session != page.session;
    if !top && cross && cross_count >= child_frame_cap(&query) { frames_capped = true; continue; }
    let mut snap = if top {
      collect_frame_snap(&page.conn, context.session.as_deref(), &context.url, 220, true, Some(context)).await
    } else if let Some(meta) = meta.filter(|m| m["cross"].as_bool() != Some(true)) {
      snap_from_dom(&context.path, label, &context.url, &meta["nodes"], false)
    } else {
      // 同进程跨域和 OOPIF 都在 frame 自己的上下文读取，不从父窗口穿越 document。
      let nodes = crate::cef::frames::evaluate(&page, context, COLLECT_DOM).await.unwrap_or(json!([]));
      let mut snap = snap_from_dom(&context.path, label, &context.url, &nodes, false);
      if snap.refs.is_empty() {
        let mut seen = HashSet::new();
        push_ax_nodes(&ax_of(&page.conn, context.session.as_deref(), &context.id).await,
          &mut snap.lines, &mut snap.refs, &mut seen, 110);
      }
      snap
    };
    snap.identity = Some(context.clone());
    snap.path = context.path.clone();
    snap.label = label.to_string();
    if !top { selected += 1; }
    if cross { cross_count += 1; }
    frames.push(snap);
  }

  // 顶层先出，子框按序号。名额按框分，目录长也不会把视频框挤掉。
  let top_index = frames.iter().position(|frame| frame.top).unwrap_or(0);
  let lengths: Vec<usize> = frames.iter().map(|frame| frame.refs.len()).collect();
  let counts = take_counts(&lengths, top_index, 280);
  let mut order = Vec::new();
  if top_index < frames.len() {
    order.push(top_index);
  }
  for index in 0..frames.len() {
    if index != top_index {
      order.push(index);
    }
  }
  let mut lines = Vec::new();
  let mut refs = Vec::new();
  let mut seen = HashSet::new();
  let mut frame_out = Vec::new();
  for index in order {
    let frame = &frames[index];
    let identity = frame.identity.as_ref().map(|f| format!(" [frameId={} loaderId={}]", f.id, f.loader_id)).unwrap_or_default();
    if frame.cross {
      let label = if frame.label.is_empty() { frame.url.clone() } else { frame.label.clone() };
      lines.push(format!("- iframe \"{label}\" [frame={}]{} cross-origin", frame.path, identity));
      continue;
    }
    if frame.refs.is_empty() {
      continue;
    }
    let (mut taken, omitted_tree) = prefer_content_refs(&frame.refs, counts[index]);
    if omitted_tree > 0 {
      lines.push(format!("省略了 {omitted_tree} 个 treeitem，用 browser_find 查"));
    }
    assign_nth(&mut taken);
    let mut local_lines = Vec::new();
    if !frame.top {
      let label = if frame.label.is_empty() { frame.url.clone() } else { frame.label.clone() };
      let path = if frame.path.is_empty() { index.to_string() } else { frame.path.clone() };
      lines.push(format!("- iframe \"{label}\" [frame={path}]{identity}"));
    }
    for node in &taken {
      if refs.len() >= 280 {
        break;
      }
      let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
      let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("button");
      if name.is_empty() {
        continue;
      }
      let backend = node.get("locator").and_then(|v| v.get("backend")).and_then(|v| v.as_i64()).unwrap_or(0);
      let nth = node.get("locator").and_then(|v| v.get("nth")).and_then(|v| v.as_i64()).unwrap_or(0);
      let key = format!("{index}:{role}:{name}:{nth}:{backend}");
      if !seen.insert(key) {
        continue;
      }
      // 新快照不能把旧的 e3 重新绑定到另一颗元素。
      static SNAPSHOT_REF_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
      let id = format!("e{}", SNAPSHOT_REF_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
      let indent = if frame.top { "" } else { "  " };
      let media = node.get("media").and_then(|v| v.as_str()).unwrap_or("");
      let mark = node.get("mark").and_then(|v| v.as_str()).unwrap_or("");
      let mut line = format_snap_line(indent, role, name, &id, "", media, mark);
      if node["disabled"].as_bool() == Some(true) { line.push_str(" [disabled]"); }
      if let Some(checked) = node["checked"].as_bool() { line.push_str(if checked { " [checked=true]" } else { " [checked=false]" }); }
      lines.push(line.clone());
      local_lines.push(line);
      let mut locator = node
        .get("locator")
        .cloned()
        .unwrap_or_else(|| json!({ "by": "text", "value": name, "exact": true }));
      if let Some(obj) = locator.as_object_mut() {
        if let Some(identity) = &frame.identity {
          obj.insert("frameId".into(), json!(identity.id));
          obj.insert("loaderId".into(), json!(identity.loader_id));
        }
        if !frame.top {
          if !frame.path.is_empty() {
            obj.insert("framePath".into(), json!(frame.path));
          }
          if !frame.label.is_empty() {
            obj.insert("frame".into(), json!(frame.label));
          } else if !frame.url.is_empty() {
            obj.insert("frame".into(), json!(frame.url));
          }
        }
      }
      refs.push(json!({
        "id": id,
        "role": role,
        "name": name,
        "frame": if frame.top { Value::Null } else { json!(if frame.label.is_empty() { &frame.url } else { &frame.label }) },
        "framePath": frame.path,
        "disabled": node["disabled"].as_bool().unwrap_or(false),
        "checked": node["checked"],
        "locator": locator,
      }));
    }
    frame_out.push(json!({
      "frameId": frame.identity.as_ref().map(|f| &f.id),
      "loaderId": frame.identity.as_ref().map(|f| &f.loader_id),
      "framePath": frame.path,
      "url": frame.url,
      "priority": frame.priority,
      "snapshot": local_lines.join("\n"),
      "refCount": local_lines.len(),
    }));
  }

  let iframes = page.conn
    .evaluate(
      r#"(function(){
        var out = [];
        try {
          var list = document.querySelectorAll('iframe[src]');
          for (var i = 0; i < list.length && out.length < 8; i++) {
            var el = list[i];
            var live = '';
            try { live = String((el.contentWindow && el.contentWindow.location && el.contentWindow.location.href) || ''); } catch (e) {}
            out.push({ id: el.id || '', src: live || el.src || '' });
          }
        } catch (e) {}
        return out;
      })()"#,
      page.session.as_deref(),
    )
    .await
    .unwrap_or(json!([]));
  let url = frames
    .last()
    .map(|f| f.url.clone())
    .unwrap_or_else(|| page.url.clone());
  // 顶层 url：优先记主文档
  let top_url = page
    .conn
    .evaluate("location.href", page.session.as_deref())
    .await
    .ok()
    .and_then(|v| v.as_str().map(str::to_string))
    .unwrap_or(url);
  let title = page
    .conn
    .evaluate("document.title", page.session.as_deref())
    .await
    .ok()
    .and_then(|v| v.as_str().map(str::to_string))
    .unwrap_or_default();
  let preferred = frame_out
    .iter()
    .max_by_key(|item| item.get("priority").and_then(|v| v.as_i64()).unwrap_or(0))
    .cloned()
    .unwrap_or(json!({}));
  Ok(json!({
    "url": top_url,
    "title": title,
    "snapshot": lines.join("\n"),
    "refs": refs,
    "captcha": false,
    "iframes": iframes,
    "frames": frame_out,
    "preferredFrame": preferred,
    "framesCapped": frames_capped,
    "hint": CHROME_UA_NOTE,
  }))
}

pub async fn cdp_screenshot(_app: AppHandle, id: String) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let session = page.session.clone();
  let sid = session.as_deref();
  let _ = page.conn.call("Page.enable", json!({}), sid).await;
  let first = page
    .conn
    .call(
      "Page.captureScreenshot",
      json!({ "format": "jpeg", "quality": 55, "fromSurface": true }),
      sid,
    )
    .await;
  let shot = match first {
    Ok(value)
      if value
        .get("data")
        .and_then(|item| item.as_str())
        .map(|item| !item.is_empty())
        .unwrap_or(false) =>
    {
      value
    }
    _ => {
      page
        .conn
        .call("Page.captureScreenshot", json!({ "format": "jpeg", "quality": 55 }), sid)
        .await?
    }
  };
  let data = shot
    .get("data")
    .and_then(|item| item.as_str())
    .unwrap_or("")
    .to_string();
  if data.is_empty() {
    return Err("截图为空".into());
  }
  Ok(json!({
    "url": page.url,
    "image": format!("data:image/jpeg;base64,{}", data),
  }))
}
