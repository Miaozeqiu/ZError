//! query implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn complete_query_reply(
    logger: &crate::logger::RequestLogger,
    app: Option<&AppHandle>,
    request_id: String,
    method: &str,
    response_time: u64,
    outcome: (u16, QueryResponse, crate::logger::LocalQuestionSearch),
    progress: &QueryProgress,
) -> warp::reply::Response {
    let (status, response, local_search) = outcome;
    let response_body = serde_json::to_string(&response).unwrap_or_default();
    let reply = warp::reply::json(&response).into_response();
    let http_status = reply.status().as_u16();
    let response_headers: HashMap<String, String> = reply
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();

    let local_matches = logger.log_request_complete(
        request_id.clone(),
        method.to_string(),
        "/query".to_string(),
        status,
        http_status,
        response_time,
        Some(response_body.clone()),
        Some(response_headers.clone()),
        local_search,
    );
    if let Some(app) = app {
        let _ = app.emit_to(
            "main",
            "request-log-complete",
            serde_json::json!({
                "id": &request_id,
                "status": status,
                "http_status": http_status,
                "response_time": response_time,
                "stage": "completed",
                "path": "/query",
                "method": method,
                "response_body": &response_body,
                "response_headers": &response_headers,
                "local_search": local_search,
                "local_matches": local_matches,
            }),
        );
    }
    progress.details(ProgressStep::Return, serde_json::json!({
        "status": status,
        "response_time": response_time,
    }));
    progress.finish(&response);
    reply
}

pub(super) fn read_app_config() -> serde_json::Value {
    crate::secret_vault::document_read("app_settings",None).unwrap_or_default()
}

/// 是否将 AI 回答写入本地题库（读取 config.json 的 autoAddToQuestionBank）
pub(super) fn should_auto_add_to_question_bank() -> bool {
    read_app_config()
        .get("autoAddToQuestionBank")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// 检测文本中是否包含URL
pub(super) fn contains_url(text: &str) -> bool {
    let url_regex = Regex::new(r"https?://[^\s]+").unwrap();
    url_regex.is_match(text)
}

/// 请求是否携带 base64 图片（OCS >= 5.1.0 图片题优化协议）
pub(super) fn request_has_images(request: &QueryRequest) -> bool {
    request
        .images
        .as_ref()
        .map(|list| !list.is_empty())
        .unwrap_or(false)
}

/// Align the original text with OCS's placeholder text. OCS alone assigns image
/// numbers: failed conversions are skipped and DOM URLs need no file extension.
/// Never re-enumerate URLs; an unprovable mapping is left for OCS to resolve.
pub(super) fn image_placeholder_map(original: &str, suggestion: &str) -> Option<HashMap<usize, String>> {
    let placeholders = Regex::new(r"\[图片(\d+)\]").ok()?;
    let whitespace = Regex::new(r"\s+").ok()?;
    let literal = |text: &str| whitespace.split(text).map(regex::escape).collect::<Vec<_>>().join(r"\s*");
    let mut pattern = String::from("(?s)^");
    let mut indices = Vec::new();
    let mut offset = 0;
    for capture in placeholders.captures_iter(suggestion) {
        let marker = capture.get(0)?;
        let index = capture.get(1)?.as_str().parse::<usize>().ok()?;
        if index == 0 { return None; }
        pattern.push_str(&literal(&suggestion[offset..marker.start()]));
        pattern.push_str("(.+?)");
        indices.push(index);
        offset = marker.end();
    }
    if indices.is_empty() { return Some(HashMap::new()); }
    pattern.push_str(&literal(&suggestion[offset..]));
    pattern.push('$');
    let regex = Regex::new(&pattern).ok()?;
    let captures = regex.captures(original)?;
    let mut mapping = HashMap::new();
    for (group, index) in indices.into_iter().enumerate() {
        let url = captures.get(group + 1)?.as_str().trim();
        if url.chars().any(char::is_whitespace)
            || !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("data:image/")) {
            return None;
        }
        if let Some(previous) = mapping.insert(index, url.to_string()) {
            if previous != url { return None; }
        }
    }
    Some(mapping)
}

/// Restore only mappings demonstrated by OCS's own suggestion fields. Unknown
/// placeholders remain unchanged so OCS can use its authoritative imageUrls list.
pub(super) fn restore_image_placeholders(answer: &str, request: &QueryRequest) -> String {
    if !answer.contains("[图片") { return answer.to_string(); }
    let mut mapping = HashMap::new();
    for (original, suggestion) in [
        (Some(request.title.as_str()), request.suggestion_title.as_deref()),
        (request.options.as_deref(), request.suggestion_options.as_deref()),
    ] {
        if let (Some(original), Some(suggestion)) = (original, suggestion) {
            let Some(found) = image_placeholder_map(original, suggestion) else { return answer.to_string(); };
            for (index, url) in found {
                if let Some(previous) = mapping.insert(index, url.clone()) {
                    if previous != url { return answer.to_string(); }
                }
            }
        }
    }
    Regex::new(r"\[图片(\d+)\]").unwrap().replace_all(answer, |capture: &regex::Captures| {
        capture[1].parse::<usize>().ok().and_then(|index| mapping.get(&index)).cloned()
            .unwrap_or_else(|| capture[0].to_string())
    }).to_string()
}

/// 解析用于模型提问的有效负载：
/// - 新协议（images 非空）：题干/选项用占位符化文本（suggestion_title/suggestion_options），
///   图片由前端直接使用 base64 数组，无需下载 URL；
/// - 旧协议（URL 题或纯文本题）：用原始 title/options，图片为空。
pub(super) fn resolve_question_payload(request: &QueryRequest) -> (String, Option<String>, Vec<String>) {
    if request_has_images(request) {
        let title = request
            .suggestion_title
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| request.title.clone());
        let options = request
            .suggestion_options
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| request.options.clone());
        (title, options, request.images.clone().unwrap_or_default())
    } else {
        (request.title.clone(), request.options.clone(), Vec::new())
    }
}

/// 构造用于日志/SSE 广播的请求体 JSON。
/// images 是 base64 数组，体积可达数 MB，直接进日志会造成严重膨胀，
/// 因此替换为摘要字符串，并附加 has_images 标记供前端识别图片题。
pub(super) fn build_query_request_log_body(request: &QueryRequest) -> String {
    let image_count = request
        .images
        .as_ref()
        .map(|list| list.len())
        .unwrap_or(0);
    serde_json::json!({
        "title": request.title,
        "options": request.options,
        "type": request.query_type,
        "has_images": image_count > 0,
        "images": if image_count > 0 {
            serde_json::json!(format!("<{} 张 base64 图片，日志已省略>", image_count))
        } else {
            serde_json::Value::Null
        },
        "suggestion_title": request.suggestion_title,
        "suggestion_options": request.suggestion_options,
    })
    .to_string()
}

pub(super) fn resolve_request_origin(headers: &HeaderMap, port: u16) -> String {
    let host = headers
        .get("host")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<warp::http::uri::Authority>().ok())
        .filter(|authority| !authority.as_str().contains('@'));
    match host {
        Some(host) => format!("http://{host}"),
        None => format!("http://127.0.0.1:{port}"),
    }
}

pub(super) fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(super) fn build_query_data(
    origin: &str,
    question_id: i64,
    question: &str,
    answer: String,
    is_ai: bool,
    is_pending_correction: bool,
) -> QueryData {
    let escaped_question = escape_html(question).replace('\n', "<br>");
    let correction_path = (question_id > 0 && !is_pending_correction)
        .then(|| correction::path_for(question_id));
    let question_html = if let Some(path) = &correction_path {
        format!("{escaped_question}{}", correction::link(&format!("{origin}{path}")))
    } else if is_pending_correction {
        format!("{escaped_question}<span style=\"display:block;margin-top:8px\">已标记待修正</span>")
    } else {
        escaped_question
    };

    QueryData {
        id: question_id,
        question: question_html,
        question_text: Some(question.to_owned()),
        correction_path,
        not_saved_reason: None,
        answer,
        is_ai,
        is_pending_correction,
    }
}

pub(crate) fn detect_question_kind(query_type: &str) -> Option<QuestionKind> {
    let trimmed = query_type.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.to_lowercase();

    if normalized.contains("single") || trimmed.contains("单选") || trimmed.contains("单项选择")
    {
        Some(QuestionKind::Single)
    } else if normalized.contains("multiple")
        || trimmed.contains("多选")
        || trimmed.contains("多项选择")
    {
        Some(QuestionKind::Multiple)
    } else if normalized.contains("judgement")
        || normalized.contains("judgment")
        || trimmed.contains("判断")
    {
        Some(QuestionKind::Judgement)
    } else if normalized.contains("completion") || trimmed.contains("填空") {
        Some(QuestionKind::Completion)
    } else {
        None
    }
}

pub(super) fn publish_local_matches(
    logger: &crate::logger::RequestLogger,
    app: Option<&AppHandle>,
    request_id: &str,
    matches: Vec<LocalQuestionMatch>,
    progress: &QueryProgress,
) {
    if matches.is_empty() {
        return;
    }
    progress.details(ProgressStep::Local, &matches);
    if let Some(app) = app {
        let _ = app.emit_to("main", "request-log-local-matches", serde_json::json!({
            "id": request_id,
            "local_matches": &matches,
        }));
    }
    logger.record_local_matches(request_id, matches);
}

pub(super) fn set_local_match_status(
    similar: &mut Vec<LocalQuestionMatch>,
    matched: &QuestionMatch,
    status: LocalMatchStatus,
) {
    if let Some(row) = similar.iter_mut().find(|row| row.id == matched.id) {
        row.status = status;
        row.rejection_reason = None;
    } else if matches!(status, LocalMatchStatus::Used) {
        // The options can make a lower-ranked title the answer source.
        let result = LocalQuestionMatch {
            id: matched.id,
            question: matched.question.clone(),
            similarity: matched.title_similarity,
            status,
            rejection_reason: None,
        };
        if similar.len() == SAME_QUESTION_CANDIDATE_LIMIT {
            if let Some(index) = similar.iter().rposition(|row| !matches!(row.status, LocalMatchStatus::Used)) {
                similar.remove(index);
            } else {
                return;
            }
        }
        if result.similarity > 0.0 {
            let index = similar.partition_point(|row| row.similarity >= result.similarity);
            similar.insert(index, result);
        }
    }
}

pub(super) fn answer_for_local_match(matched: &QuestionMatch, request: &QueryRequest) -> Option<String> {
    use crate::database::query_match::{labeled_options, nonempty_option_lines, same_option_text};

    // A stored letter refers to the stored order, even when the request shuffles the options.
    let answer = normalize_answer_against_options(&matched.answer, matched.options.as_deref());
    let current_options = request.options.as_deref().filter(|text| nonempty_option_lines(text).next().is_some());
    let stored_options = matched.options.as_deref().filter(|text| nonempty_option_lines(text).next().is_some());
    let Some(options_to_check) = current_options.or(stored_options) else {
        return Some(answer);
    };
    let labeled = labeled_options(options_to_check);
    let choices: Vec<_> = match &labeled {
        Some(items) => items.iter().map(|(_, text)| text.as_str()).collect(),
        None => nonempty_option_lines(options_to_check).collect(),
    };
    let expected = request.query_type.as_deref().and_then(detect_question_kind)
        .or_else(|| matched.question_type.as_deref().and_then(detect_question_kind));
    if matches!(expected, Some(QuestionKind::Completion | QuestionKind::Judgement)) {
        return Some(answer);
    }
    let parts = answer.split("###").map(|part| {
        let mut same = choices.iter().copied().filter(|value| same_option_text(value, part));
        match (same.next(), same.next()) {
            (Some(value), None) => Some(value),
            _ => None,
        }
    }).collect::<Option<Vec<_>>>()?;
    if current_options.is_none() && parts.iter().any(|part| {
        ["以上", "上述", "前两项", "后两项", "所有选项", "其他选项"]
            .iter()
            .any(|reference| part.contains(reference))
    }) {
        return None;
    }
    Some(parts.join("###"))
}

/// Read-only lookup for the course homework worker. This never uses the /query
/// route, so an absent or uncertain bank answer cannot invoke a model or write to the bank.
#[tauri::command]
pub async fn lookup_homework_bank_answers(
    questions: Vec<QueryRequest>,
) -> Result<Vec<Vec<HomeworkBankAnswer>>, String> {
    if questions.len() > 10 || questions.iter().any(|question| {
        let kind = question.query_type.as_deref().and_then(detect_question_kind);
        question.title.trim().is_empty()
            || question.title.len() > 12_000
            || question.images.is_some()
            || kind.is_none()
            || question.options.as_ref().is_some_and(|options| options.len() > 32_000)
            || (kind.is_some_and(QuestionKind::requires_options)
                && question.options.as_ref().is_none_or(|options| options.trim().is_empty()))
    }) {
        return Err("作业题库查询超出范围或缺少题型、题干或选项。".into());
    }
    let mut results = Vec::with_capacity(questions.len());
    for question in questions {
        let kind = question.query_type.as_deref().and_then(detect_question_kind).ok_or("题型不受支持。")?;
        let matches = crate::database::questions::exact_homework_bank_matches(
            question.title.clone(), question.options.clone(), kind,
        ).await.map_err(|_| "无法读取本地题库。".to_owned())?;
        results.push(homework_bank_candidates(&question, matches));
    }
    Ok(results)
}

pub(super) fn homework_bank_candidates(question: &QueryRequest, matches: Vec<QuestionMatch>) -> Vec<HomeworkBankAnswer> {
    // Even exact hits can have incompatible stored answers. Keep every eligible
    // hit so the resolver can report disagreement instead of taking the first row.
    let too_many = matches.len() > 24;
    matches.into_iter().take(24).map(|matched| {
        let answer = if too_many || matched.answer.len() > 8000 {
            String::new()
        } else {
            homework_bank_answer(&matched, question).unwrap_or_default()
        };
        HomeworkBankAnswer { id: matched.id, answer }
    }).collect()
}

pub(super) fn homework_bank_answer(matched: &QuestionMatch, question: &QueryRequest) -> Option<String> {
    use crate::database::query_match::{labeled_options, nonempty_option_lines, same_option_text};

    let kind = question.query_type.as_deref().and_then(detect_question_kind)?;
    if kind == QuestionKind::Completion {
        return Some(matched.answer.trim().to_string());
    }
    let stored = matched.options.as_deref().unwrap_or("");
    let stored_labels = labeled_options(stored).unwrap_or_default();
    let texts: Vec<_> = if stored_labels.is_empty() {
        nonempty_option_lines(stored).collect()
    } else {
        stored_labels.iter().map(|(_, text)| text.as_str()).collect()
    };
    let direct = |part: &str| {
        let mut same = texts.iter().copied().filter(|text| same_option_text(part, text));
        match (same.next(), same.next()) {
            (value, None) => Some(value),
            _ => None,
        }
    };
    let mut resolved = Vec::new();
    for part in matched.answer.split("###").map(str::trim) {
        if part.is_empty() { return None; }
        let exact_text = direct(part)?;
        let labels = part.trim().to_ascii_uppercase();
        let label_texts = (!labels.is_empty() && labels.len() <= stored_labels.len()
            && (kind == QuestionKind::Multiple || labels.len() == 1))
            .then(|| labels.chars().map(|letter| {
                stored_labels.iter().find_map(|(key, text)| (*key == letter).then_some(text.as_str()))
            }).collect::<Option<Vec<_>>>()).flatten();
        if let Some(text) = exact_text {
            if label_texts.as_ref().is_some_and(|positions| positions.len() != 1 || positions[0] != text) {
                // For example the stored answer "B" could be an option's text
                // or the stored second option. Never guess which was intended.
                return None;
            }
            resolved.push(text);
        } else if let Some(positions) = label_texts {
            resolved.extend(positions);
        } else if kind == QuestionKind::Judgement {
            // The site's displayed judgement labels are interpreted by the worker.
            resolved.push(part);
        } else {
            return None;
        }
    }
    let options = question.options.as_deref().unwrap_or("");
    let current = labeled_options(options).unwrap_or_default();
    let values: Option<Vec<_>> = resolved.into_iter().map(|part| {
        let mut same = current.iter().filter(|(_, text)| same_option_text(part, text));
        match (same.next(), same.next()) {
            (Some((_, text)), None) => Some(text.as_str()),
            (None, None) if kind == QuestionKind::Judgement => Some(part),
            _ => None,
        }
    }).collect();
    Some(values?.join("###"))
}

pub(super) async fn resolve_query_with_same_question_check(
    logger: &crate::logger::RequestLogger,
    app: Option<&AppHandle>,
    request: &QueryRequest,
    request_id: &str,
    request_origin: &str,
    progress: &QueryProgress,
) -> (u16, QueryResponse, crate::logger::LocalQuestionSearch) {
    use crate::logger::LocalQuestionSearch;
    let mut has_url = contains_url(&request.title);
    if let Some(options) = &request.options {
        if !has_url {
            has_url = contains_url(options);
        }
    }

    progress.step(ProgressStep::Local, ProgressState::Running, "正在匹配题干和选项");
    let search = match query_database_for_request(
        &request.title,
        request.options.as_deref(),
        request.query_type.as_deref(),
        SAME_QUESTION_CANDIDATE_LIMIT,
    )
    .await
    {
        Ok(search) => search,
        Err(e) => {
            eprintln!("Database query error: {}", e);
            progress.step(ProgressStep::Local, ProgressState::Failed, "无法读取本地题库");
            return (
                500,
                QueryResponse::error(format!("Database error: {}", e)),
                LocalQuestionSearch::Failed,
            );
        }
    };

    let mut similar = search.similar;

    let exact_hits: Vec<_> = search.exact.into_iter().filter_map(|matched| {
        if let Some(answer) = answer_for_local_match(&matched, request) {
            Some((matched, answer))
        } else {
            record_exact_match_rejection(&mut similar, matched.id, "本地答案无法与可用选项唯一对应");
            None
        }
    }).collect();
    let distinct_answers: std::collections::HashSet<_> = exact_hits.iter().map(|(_, answer)| {
        let mut parts: Vec<_> = answer.split("###")
            .map(crate::database::query_match::compact_query_spacing)
            .collect();
        if request.query_type.as_deref().and_then(detect_question_kind) == Some(QuestionKind::Multiple) {
            parts.sort_unstable();
        }
        parts
    }).collect();
    let conflicting_answers = distinct_answers.len() > 1;
    if conflicting_answers {
        for (matched, _) in &exact_hits {
            record_exact_match_rejection(&mut similar, matched.id, "本地有多条匹配记录，答案不一致");
        }
    }
    if !exact_hits.is_empty() && !conflicting_answers {
        println!("✅ 精确匹配命中: {} 条", exact_hits.len());
        progress.step(ProgressStep::Local, ProgressState::Done, "命中本地答案");
        for (matched, _) in &exact_hits {
            set_local_match_status(&mut similar, matched, LocalMatchStatus::Used);
        }
        publish_local_matches(logger, app, request_id, similar, progress);
        let data_list: Vec<QueryData> = exact_hits
            .into_iter()
            .map(|(m, answer)| {
                build_query_data(
                    request_origin,
                    m.id,
                    &m.question,
                    answer,
                    m.is_ai,
                    m.is_pending_correction,
                )
            })
            .collect();
        return (
            200,
            QueryResponse::success(data_list),
            LocalQuestionSearch::Hit,
        );
    }
    println!("🔍 无精确匹配: {}", request.title);

    // 2) 模糊候选 → AI 同题判断
    let candidates: Vec<_> = if conflicting_answers {
        Vec::new()
    } else {
        search.candidates.into_iter().filter_map(|matched| {
            if let Some(answer) = answer_for_local_match(&matched, request) {
                Some((matched, answer))
            } else {
                record_exact_match_rejection(&mut similar, matched.id, "本地答案无法与可用选项唯一对应");
                None
            }
        }).collect()
    };
    for (candidate, _) in &candidates {
        set_local_match_status(&mut similar, candidate, LocalMatchStatus::Candidate);
    }
    publish_local_matches(logger, app, request_id, similar.clone(), progress);

    let local_detail = if conflicting_answers {
        "本地答案有冲突，未直接采用".to_string()
    } else if candidates.is_empty() {
        if similar.is_empty() {
            "本地题库未命中".to_string()
        } else {
            "找到相似题，未命中本地答案".to_string()
        }
    } else {
        format!("找到 {} 道待核对的相似题", candidates.len())
    };
    let local_state = if similar.is_empty() {
        ProgressState::NoResult
    } else {
        ProgressState::Done
    };
    progress.step(ProgressStep::Local, local_state, local_detail);

    if !candidates.is_empty() {
        progress.step(ProgressStep::Verify, ProgressState::Running, "正在核对相似题是否为同一道题");
        println!(
            "🤖 发现 {} 条近似候选，请求 AI 同题判断",
            candidates.len()
        );
        let check_prompt =
            build_same_question_check_prompt(&request.title, request.options.as_deref(), &candidates);
        logger.send_model_call_request(request_id.to_string(), check_prompt.clone(), None);
        emit_model_call_request(app, request_id, &check_prompt, &[]);

        match logger
            .wait_for_model_response(request_id.to_string(), 30, 45)
            .await
        {
            Ok(judge_content) => {
                println!("✅ 同题判断结果: {}", judge_content);
                // 未选择模型等客户端错误：直接返回，避免再回落正常答题又等一轮
                if let Some((status, err_msg)) = classify_model_failure(&judge_content) {
                    if status == 400 && err_msg.contains("未选择模型") {
                        progress.step(ProgressStep::Verify, ProgressState::Failed, "未选择可用模型");
                        return (
                            status,
                            QueryResponse::error(err_msg),
                            LocalQuestionSearch::Unconfirmed,
                        );
                    }
                }
                if let Some(matched_id) = parse_same_question_result(&judge_content) {
                    if let Some((matched, answer)) = candidates.iter()
                        .find(|(candidate, _)| candidate.id == matched_id && question_match_is_current(candidate))
                    {
                        set_local_match_status(&mut similar, matched, LocalMatchStatus::Used);
                        publish_local_matches(logger, app, request_id, similar, progress);
                        progress.step(ProgressStep::Verify, ProgressState::Done, "确认是同一道题，采用本地答案");
                        let response_id = if should_auto_add_to_question_bank() {
                            match insert_ai_response(
                                &request.title,
                                answer,
                                request.options.clone(),
                                request.query_type.clone(),
                                matched.is_ai,
                            ) {
                                Ok(id) => {
                                    println!(
                                        "✅ 同题变体已入库, matched_id={}, new_id={}",
                                        matched_id, id
                                    );
                                    id
                                }
                                Err(e) => {
                                    println!("❌ 同题变体入库失败: {}，仍返回已有答案", e);
                                    matched.id
                                }
                            }
                        } else {
                            println!(
                                "ℹ️ autoAddToQuestionBank=false，同题命中不入库，直接返回 matched_id={}",
                                matched_id
                            );
                            matched.id
                        };

                        let data = build_query_data(
                            request_origin,
                            response_id,
                            &request.title,
                            answer.clone(),
                            matched.is_ai,
                            false,
                        );
                        return (
                            200,
                            QueryResponse::success(vec![data]),
                            LocalQuestionSearch::Hit,
                        );
                    }

                    println!(
                        "⚠️ 同题判断返回的 matched_id={} 无效，回落正常答题",
                        matched_id
                    );
                } else {
                    println!("ℹ️ AI 判定为不同题或解析失败，回落正常答题");
                }
                progress.step(ProgressStep::Verify, ProgressState::Done, "未能确认是同一道题");
            }
            Err(e) => {
                progress.step(ProgressStep::Verify, ProgressState::Failed, "未能完成相似题核对");
                if e.contains("未选择模型") {
                    let (status, message) = classify_explicit_model_failure(&e);
                    return (
                        status,
                        QueryResponse::error(message),
                        LocalQuestionSearch::Unconfirmed,
                    );
                }
                println!("⚠️ 同题判断超时/失败: {}，回落正常答题", e);
            }
        }
    } else {
        println!("🔍 无近似候选，直接走正常 AI 答题");
    }

    // 3) 正常 AI 答题
    let (status, response) = progress.track_answer(
        logger,
        request_id,
        wait_and_store_ai_answer(logger, app, request, request_id, request_origin, has_url),
    ).await;
    (status, response, LocalQuestionSearch::Miss)
}
