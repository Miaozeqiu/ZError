//! model implementation; the parent module preserves the public facade.
use super::*;

/// 从设置计算模型等待预算：(静默超时秒, 绝对上限秒)
/// - inactivity：无新进度多久判超时（≈ 单次最长响应 + 余量）
/// - absolute：整段等待硬上限（覆盖重试，且不受 keepalive 续命）
pub(super) fn model_wait_budget_secs(has_url: bool) -> (u64, u64) {
    let cfg = read_app_config();
    let timeout = cfg
        .get("modelResponseTimeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(40)
        .clamp(5, 600);
    let retries = cfg
        .get("modelRetryCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(2)
        .min(10);
    let inactivity = timeout.saturating_add(20).max(30);
    let absolute = timeout
        .saturating_mul(retries + 1)
        .saturating_add(if has_url { 90 } else { 60 })
        .max(inactivity);
    (inactivity, absolute)
}

pub(super) fn build_model_query_prompt(
    title: &str,
    options: Option<&str>,
    query_type: Option<&str>,
) -> String {
    let mut q = String::from(
        "你是一个专业的答题助手。请按以下要求作答：\n"
    );

    q.push_str("1. 先在内部完成审题与推理（可简要），再给出最终答案。\n");
    q.push_str("2. 最后一行输出**唯一**一个 JSON 对象，不要用 markdown 代码块包裹，JSON 前后不要附加说明。\n");
    q.push_str("3. JSON 格式严格为：{\"answer\": \"最终答案\"}\n");
    q.push_str("4. answer 只写答案正文本身：选择题必须与【选项】中去掉「A.」「B.」后的文字完全一致；判断题只写「正确」或「错误」；填空题只写填空内容。\n");
    q.push_str("5. 严禁把选项字母写进 answer：不要写 A/B/C/D，不要写「B. 传动角」「D. meeting」，应直接写「传动角」「meeting」。不要把分析过程写进 answer。\n\n");

    if let Some(raw_type) = query_type.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(kind) = detect_question_kind(raw_type) {
            q.push_str(&format!("【题目类型：{}题】\n", kind.chinese_name()));
            q.push_str(&format!("提示：{}\n", kind.prompt_hint()));
            q.push_str(kind.few_shot_block());
            q.push('\n');
        } else {
            q.push_str(&format!("【题目类型字段：{}】\n", raw_type));
        }
    }

    q.push_str(&format!("【题目】\n{}\n", title));

    if let Some(options) = options.map(str::trim).filter(|value| !value.is_empty()) {
        q.push_str(&format!("【选项】\n{}\n", options));
    }

    q.push_str("\n请作答，并在最后输出答案 JSON：");

    q
}

pub(super) fn build_same_question_check_prompt(title: &str, options: Option<&str>, candidates: &[(QuestionMatch, String)]) -> String {
    let candidate_list: Vec<serde_json::Value> = candidates
        .iter()
        .map(|(c, _)| {
            serde_json::json!({
                "id": c.id,
                "question": c.question,
                "options": c.options,
            })
        })
        .collect();

    let payload = serde_json::json!({
        "title": title,
        "options": options,
        "candidates": candidate_list,
    });

    format!(
        "{}{}",
        SAME_QUESTION_CHECK_PREFIX,
        serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string())
    )
}

pub(super) fn parse_same_question_result(content: &str) -> Option<i64> {
    let trimmed = content.trim();
    if trimmed.is_empty() || is_model_error(trimmed).is_some() {
        return None;
    }

    let json_str = if let Some(start) = trimmed.find('{') {
        let end = trimmed.rfind('}').unwrap_or(trimmed.len() - 1);
        &trimmed[start..=end]
    } else {
        trimmed
    };

    let value: Value = serde_json::from_str(json_str).ok()?;
    let same = value.get("same").and_then(|v| v.as_bool()).unwrap_or(false);
    if !same {
        return None;
    }
    value
        .get("matched_id")
        .and_then(|v| v.as_i64())
        .or_else(|| {
            value
                .get("matched_id")
                .and_then(|v| v.as_u64())
                .map(|v| v as i64)
        })
}

pub(super) fn build_normal_model_query(request: &QueryRequest, has_url: bool) -> String {
    if has_url {
        let mut q = format!("__URL_QUESTION__:{}", request.title);
        if let Some(options) = &request.options {
            if !options.is_empty() {
                q.push_str(&format!("\n__OPTIONS__:{}", options));
            }
        }
        q
    } else {
        build_model_query_prompt(
            &request.title,
            request.options.as_deref(),
            request.query_type.as_deref(),
        )
    }
}

pub(super) fn emit_model_call_request(
    app: Option<&AppHandle>,
    request_id: &str,
    query: &str,
    images: &[String],
) {
    if let Some(app) = app {
        let mut payload = serde_json::json!({
            "request_id": request_id,
            "query": query,
        });
        // 图片题优化：base64 数组，与 query 中 [图片N] 占位符严格同序；非图片题不传
        if !images.is_empty() {
            payload["images"] = serde_json::json!(images);
        }
        if let Err(e) = app.emit("model-call-request", payload) {
            println!("⚠️ emit model-call-request failed: {}", e);
        } else {
            println!("📣 Emitted model-call-request via Tauri event");
        }
    }
}

pub(super) async fn wait_and_store_ai_answer(
    logger: &crate::logger::RequestLogger,
    app: Option<&AppHandle>,
    request: &QueryRequest,
    request_id: &str,
    request_origin: &str,
    has_url: bool,
) -> (u16, QueryResponse) {
    // 图片题优化（OCS >= 5.1.0）：images 非空时使用占位符化题干 + base64 数组，
    // 前端按 [图片N] 直接拼接多模态消息，无需下载 URL（规避防盗链）。
    let (prompt_title, prompt_options, images) = resolve_question_payload(request);
    let has_images = !images.is_empty();

    let formatted_query = if has_images {
        let mut q = format!("__IMAGE_QUESTION__:{}", prompt_title);
        if let Some(options) = &prompt_options {
            if !options.is_empty() {
                q.push_str(&format!("\n__OPTIONS__:{}", options));
            }
        }
        q
    } else {
        // 旧协议：URL 题走 __URL_QUESTION__（前端下载 URL），纯文本题走普通 prompt
        let effective = QueryRequest {
            title: prompt_title,
            options: prompt_options,
            query_type: request.query_type.clone(),
            images: None,
            suggestion_title: None,
            suggestion_options: None,
        };
        build_normal_model_query(&effective, has_url)
    };

    logger.send_model_call_request(
        request_id.to_string(),
        formatted_query.clone(),
        if has_images { Some(images.clone()) } else { None },
    );
    emit_model_call_request(app, request_id, &formatted_query, &images);

    // 覆盖前端超时 × 重试；absolute 防止 keepalive 无限续命
    // 图片题（多模态推理）与 URL 题（需下载图片）同样适用加长预算
    let (inactivity_secs, absolute_secs) = model_wait_budget_secs(has_url || has_images);
    println!(
        "⏳ model wait budget: inactivity={}s absolute={}s (has_url={}, has_images={})",
        inactivity_secs, absolute_secs, has_url, has_images
    );
    match logger
        .wait_for_model_response(request_id.to_string(), inactivity_secs, absolute_secs)
        .await
    {
        Ok(model_content) => {
            println!("✅ Received model response: {}", model_content);
            if let Some((status, err_msg)) = classify_model_failure(&model_content) {
                return (status, QueryResponse::error(err_msg));
            }

            let mut extracted_answer = extract_answer_from_json(&model_content);
            if model_content.contains("题目不完整,无法确定具体问题.") {
                extracted_answer = String::new();
                println!("⚠️ 检测到题目不完整,将答案留空");
            }
            extracted_answer = extracted_answer.trim().to_string();
            // 图片题：把答案中的 [图片N] 占位符还原为原始 URL（入库与返回均使用还原后的文本）
            if has_images {
                let before_restore = extracted_answer.clone();
                extracted_answer = restore_image_placeholders(&extracted_answer, request);
                if extracted_answer != before_restore {
                    println!("🔧 答案图片占位符已还原为 URL");
                }
            }
            if let Some((status, message)) = classify_model_failure(&extracted_answer) {
                return (status, QueryResponse::error(message));
            }
            // 去掉 A./B. 前缀，纯字母映射为选项正文，避免返回/入库带序号的答案
            let before_norm = extracted_answer.clone();
            extracted_answer = normalize_answer_against_options(
                &extracted_answer,
                request.options.as_deref(),
            );
            if extracted_answer != before_norm {
                println!(
                    "🔧 答案已规范化: [{}] → [{}]",
                    before_norm, extracted_answer
                );
            }

            let (inserted_id, not_saved_reason) = if extracted_answer.is_empty() {
                println!("⚠️ AI最终处理结果答案为空,跳过保存题目");
                (0, Some(QuerySaveFailure::EmptyAnswer))
            } else if !should_auto_add_to_question_bank() {
                println!("ℹ️ autoAddToQuestionBank=false，跳过将 AI 回答写入本地题库");
                (0, Some(QuerySaveFailure::AutoSaveDisabled))
            } else {
                match insert_ai_response(
                    &request.title,
                    &extracted_answer,
                    request.options.clone(),
                    request.query_type.clone(),
                    true,
                ) {
                    Ok(id) => {
                        println!("✅ AI response stored to database");
                        (id, None)
                    }
                    Err(e) => {
                        println!("❌ Failed to store AI response: {}", e);
                        (0, Some(QuerySaveFailure::WriteFailed))
                    }
                }
            };

            let mut data = build_query_data(
                request_origin,
                inserted_id,
                &request.title,
                extracted_answer,
                true,
                false,
            );
            data.not_saved_reason = not_saved_reason;
            (200, QueryResponse::success(vec![data]))
        }
        Err(e) => {
            println!("❌ Model call timeout or error: {}", e);
            let (status, message) = classify_explicit_model_failure(&e);
            (status, QueryResponse::error(message))
        }
    }
}

pub(super) fn is_timeout_like_model_failure(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("timeout")
        || lower.contains("超时")
        || lower.contains("no new tokens")
        || lower.contains("aborted")
        || lower.contains("abort")
        || lower.contains("cancelled")
        || lower.contains("canceled")
        || lower.contains("取消")
        || lower.contains("服务已停止")
}

/// 将模型失败文本映射为 RequestLog 状态码：
/// 未选择模型 → 400，超时类 → 408，其它 → 500
pub(super) fn classify_model_failure(text: &str) -> Option<(u16, String)> {
    let error = is_model_error(text)?;
    Some(classify_explicit_model_failure(&error))
}

pub(super) fn classify_explicit_model_failure(text: &str) -> (u16, String) {
    if text.contains("未选择模型") {
        (400, "错误: 未选择模型".into())
    } else if is_timeout_like_model_failure(text) {
        (408, text.to_string())
    } else {
        (500, if text.trim().is_empty() { "模型调用失败".into() } else { text.to_string() })
    }
}

pub(super) fn is_model_error(text: &str) -> Option<String> {
    crate::model_response::failure_message(text)
}
