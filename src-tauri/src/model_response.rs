//! Model transport failures are never answers, regardless of their display format.
use regex::Regex;
use serde_json::Value;

fn payload_error(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    let error = object.get("error").filter(|v| !v.is_null() && **v != Value::Bool(false) && **v != Value::String(String::new()));
    let failed = error.is_some()
        || object.get("success").and_then(Value::as_bool) == Some(false)
        || object.get("ok").and_then(Value::as_bool) == Some(false)
        || ["status", "statusCode", "code"].iter().any(|key| {
            object.get(*key).map(|value| value.as_i64().or_else(|| value.as_str().and_then(|s| s.parse().ok()))
                .map(|n| n >= 400 || n < 0).unwrap_or_else(|| matches!(value.as_str(), Some("error" | "failed")))).unwrap_or(false)
        })
        || object.get("type").and_then(Value::as_str) == Some("error");
    if failed {
        for candidate in error.into_iter().chain(std::iter::once(value)) {
            if let Some(text) = candidate.as_str().filter(|s| !s.trim().is_empty()) { return Some(text.to_string()); }
            for key in ["message", "msg", "detail", "error_description", "reason"] {
                if let Some(text) = candidate.get(key).and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
                    return Some(text.to_string());
                }
            }
        }
        return Some("模型接口返回错误".into());
    }
    None
}

pub fn failure_message(text: &str) -> Option<String> {
    fn inspect(text: &str, depth: usize) -> Option<String> {
        if depth > 4 { return None; }
        let text = text.trim();
        let without_prefix = text.strip_prefix("```json").or_else(|| text.strip_prefix("```")).unwrap_or(text).trim();
        let clean = without_prefix.strip_suffix("```").unwrap_or(without_prefix).trim();
        if let Ok(value) = serde_json::from_str::<Value>(clean) {
            if let Some(error) = payload_error(&value) { return Some(error); }
            if let Some(inner) = value.as_str() {
                if let Some(error) = inspect(inner, depth + 1) { return Some(error); }
            }
            for key in ["answer", "anwser", "content"] {
                if let Some(inner) = value.get(key).and_then(Value::as_str) {
                    if let Some(error) = inspect(inner, depth + 1) { return Some(error); }
                }
            }
        }
        // Legacy adapters may append an error envelope after progress text.
        if !clean.starts_with('{') && clean.ends_with('}') {
            for (offset, _) in clean.match_indices('{').rev().take(32) {
                if let Ok(value) = serde_json::from_str::<Value>(&clean[offset..]) {
                    if let Some(error) = payload_error(&value) { return Some(error); }
                }
            }
        }
        let prefix = Regex::new(r"(?i)^(?:错误[:：]|error[:：]|API\s*错误|所有AI均查询失败$|HTTP(?:\s+error!?\s*(?:status:)?\s*|\s+)[45]\d\d\b|Failed to fetch\b|fetch failed\b|NetworkError\b|TimeoutError[:：]|模型响应超时|模型调用失败[:：]|网络请求失败[:：]|服务已停止，已取消所有模型请求)").unwrap();
        if prefix.is_match(clean) { return Some(clean.into()); }
        // Legacy multi-model clients prepend a model name to every failure.
        let labels = Regex::new(r"(?m)^\[[^\]\r\n]+\]\r?\n").unwrap();
        if labels.is_match(clean) {
            let parts: Vec<_> = labels.split(clean).filter(|part| !part.trim().is_empty()).collect();
            if !parts.is_empty() && parts.iter().all(|part| inspect(part, depth + 1).is_some()) { return Some(clean.into()); }
        }
        None
    }
    inspect(text, 0)
}

pub fn callback_succeeded(content: &str, reported_success: Option<bool>) -> bool {
    reported_success != Some(false) && !content.trim().is_empty() && failure_message(content).is_none()
}

pub fn validate_answer(answer: &str) -> Result<(), String> {
    if answer.split("###").all(|slot| slot.trim().is_empty()) { return Err("模型答案为空，不保存题目".into()); }
    if let Some(error) = failure_message(answer) { return Err(format!("模型调用失败，不保存题目：{}", error)); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_model_failure_contract() {
        let cases: Value = serde_json::from_str(include_str!("../../testdata/model/response-cases.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let text = case["input"].as_str().unwrap();
            let fails = case["fails"].as_bool().unwrap();
            assert_eq!(failure_message(text).is_some(), fails, "{}", text);
            assert_eq!(validate_answer(text).is_err(), fails, "{}", text);
        }
    }
    #[test]
    fn explicit_failure_never_becomes_success_even_with_answer_shaped_content() {
        assert!(!callback_succeeded(r#"{"answer":"42"}"#, Some(false)));
        assert!(!callback_succeeded(r#"{"error":{"message":"denied"}}"#, Some(true)));
        assert!(!callback_succeeded("", Some(true)));
        assert!(validate_answer("######").is_err());
        assert!(callback_succeeded(r#"{"same":false}"#, Some(true)));
        assert!(callback_succeeded(r#"{"answer":"42"}"#, Some(true)));
    }
}
