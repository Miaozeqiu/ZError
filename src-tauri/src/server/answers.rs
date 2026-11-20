//! answers implementation; the parent module preserves the public facade.
use super::*;

/// 从选项文本解析 A/B/C → 选项正文
pub(super) fn parse_option_letter_map(options: Option<&str>) -> HashMap<char, String> {
    options.and_then(crate::database::query_match::labeled_options)
        .unwrap_or_default()
        .into_iter()
        .collect()
}

/// 去掉行首选项字母前缀：`B. 传动角` → `传动角`
/// 有选项表时，仅当去前缀后能对应到某选项正文才剥离。
pub(super) fn strip_leading_option_label(text: &str, map: &HashMap<char, String>) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let patterns: [(&str, bool); 2] = [
        (r"^([A-Za-z])([\.、．\)])\s+(.+)$", false),
        (r"^([A-Za-z])([\.、．\)])(.+)$", true),
    ];

    for (pat, tight) in patterns {
        let Ok(re) = Regex::new(pat) else {
            continue;
        };
        let Some(caps) = re.captures(trimmed) else {
            continue;
        };
        let Some(letter) = caps
            .get(1)
            .and_then(|m| m.as_str().chars().next())
            .map(|c| c.to_ascii_uppercase())
        else {
            continue;
        };
        let sep = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let rest = caps.get(3).map(|m| m.as_str().trim()).unwrap_or("");
        if rest.is_empty() {
            continue;
        }
        // 无空格且剩余全是字母：留给纯字母映射
        if tight && rest.chars().all(|c| c.is_ascii_alphabetic()) && rest.len() <= 8 {
            continue;
        }
        if map.is_empty() {
            if sep == "、" {
                continue;
            }
            return rest.to_string();
        }
        if map.get(&letter).map(|s| s.as_str()) == Some(rest) {
            return rest.to_string();
        }
        if map.values().any(|v| v == rest) {
            return rest.to_string();
        }
    }
    trimmed.to_string()
}

/// 将模型/题库答案规范为选项正文（去字母前缀，纯字母映射）
pub(super) fn normalize_answer_against_options(answer: &str, options: Option<&str>) -> String {
    let raw = answer.trim();
    if raw.is_empty() {
        return String::new();
    }

    let map = parse_option_letter_map(options);
    let parts: Vec<&str> = if raw.contains("###") {
        raw.split("###").collect()
    } else {
        vec![raw]
    };

    let mut normalized: Vec<String> = Vec::new();
    for part in parts {
        let mut p = strip_leading_option_label(part.trim(), &map);
        if p.is_empty() {
            // Empty completion slots are positional; dropping them shifts later answers.
            normalized.push(String::new());
            continue;
        }

        let compact: String = p.chars().filter(|c| !c.is_whitespace()).collect();
        if !map.is_empty()
            && !compact.is_empty()
            && compact.chars().all(|c| c.is_ascii_alphabetic())
            && compact.len() <= 8
        {
            let letters: Vec<char> = compact.chars().map(|c| c.to_ascii_uppercase()).collect();
            let texts: Vec<String> = letters
                .iter()
                .filter_map(|ch| map.get(ch).cloned())
                .collect();
            if texts.len() == letters.len() && !texts.is_empty() {
                p = texts.join("###");
            }
        }
        normalized.push(p);
    }

    if normalized.len() == 1 && normalized[0].contains("###") && !raw.contains("###") {
        return normalized[0].clone();
    }
    normalized.join("###")
}

/// 从JSON响应中提取answer字段
///
/// # Arguments
/// * `json_content` - AI返回的JSON字符串
///
/// # Returns
/// * `String` - 提取的答案内容,如果解析失败则返回原始内容
pub(super) fn extract_answer_from_json(json_content: &str) -> String {
    // 1) 去除可能的 markdown 代码块标记
    let mut cleaned = json_content.trim().to_string();
    if cleaned.starts_with("```json") {
        cleaned = cleaned[7..].to_string();
    } else if cleaned.starts_with("```") {
        cleaned = cleaned[3..].to_string();
    }
    if cleaned.ends_with("```") {
        cleaned = cleaned[..cleaned.len() - 3].to_string();
    }
    cleaned = cleaned.trim().to_string();

    println!("🔍 清理后的内容: {}", cleaned);

    // 提取答案的内部工具函数
    fn extract_field_from_value(v: &Value) -> Option<String> {
        if let Some(answer) = v.get("answer").and_then(|a| a.as_str()) {
            return Some(answer.to_string());
        }
        if let Some(answer) = v.get("anwser").and_then(|a| a.as_str()) {
            return Some(answer.to_string());
        }
        None
    }

    // 2) 首先尝试直接解析整个文本为 JSON
    if let Ok(v) = serde_json::from_str::<Value>(&cleaned) {
        if let Some(ans) = extract_field_from_value(&v) {
            println!("✅ 直接解析文本为JSON并提取到答案: {}", ans);
            return ans;
        }
    }

    // 3) 失败则从末尾尝试提取最后一个平衡的 JSON 对象片段
    fn extract_last_balanced_json(text: &str) -> Option<String> {
        let bytes = text.as_bytes();
        let mut end: Option<usize> = None;
        let mut depth: i32 = 0;
        let mut i = bytes.len();
        while i > 0 {
            i -= 1;
            let b = bytes[i];
            if end.is_none() {
                if b == b'}' {
                    end = Some(i);
                    depth = 1;
                    continue;
                }
            } else {
                if b == b'}' {
                    depth += 1;
                } else if b == b'{' {
                    depth -= 1;
                    if depth == 0 {
                        let start = i;
                        let slice = &text[start..=end.unwrap()];
                        return Some(slice.to_string());
                    }
                }
            }
        }
        None
    }

    if let Some(json_str) = extract_last_balanced_json(&cleaned) {
        println!("🔎 发现末尾的JSON片段: {}", json_str);
        if let Ok(v) = serde_json::from_str::<Value>(&json_str) {
            if let Some(ans) = extract_field_from_value(&v) {
                println!("✅ 从末尾JSON片段中提取到答案: {}", ans);
                return ans;
            }
        } else {
            println!("⚠️ 末尾JSON片段解析失败");
        }
    }

    // 4) 使用正则在混合文本中直接捕获 answer 字段
    let re = Regex::new(r#"(?s)\{\s*\"(?:answer|anwser)\"\s*:\s*\"(.*?)\"[\s\S]*?\}"#).unwrap();
    if let Some(caps) = re.captures(&cleaned) {
        if let Some(m) = caps.get(1) {
            let ans = m.as_str().to_string();
            println!("✅ 通过正则从混合文本中捕获到答案: {}", ans);
            return ans;
        }
    }

    // 5) 尝试从中英文"答案:"或"answer:"后面提取文本
    let text_re = Regex::new(r"(?i)(?:答案|answer)[：:]\s*(.+?)(?:\n|$)").unwrap();
    if let Some(caps) = text_re.captures(&cleaned) {
        if let Some(m) = caps.get(1) {
            let ans = m.as_str().trim().to_string();
            if !ans.is_empty() {
                println!("✅ 从\"答案: \"标记后提取到文本: {}", &ans[..std::cmp::min(ans.len(), 100)]);
                return ans;
            }
        }
    }

    // 6) 如果内容看起来是纯文本答案（不含JSON结构）,直接返回清理后的内容
    let cleaned_trimmed = cleaned.trim();
    if cleaned_trimmed.len() > 0 && cleaned_trimmed.len() < 2000 && !cleaned_trimmed.starts_with('{') && !cleaned_trimmed.starts_with('[') {
        // 检查是否像是一个直接答案（简短文本,不含复杂结构）
        let lines: Vec<&str> = cleaned_trimmed.lines().filter(|l| !l.trim().is_empty()).collect();
        if lines.len() <= 3 {
            println!("✅ 将纯文本内容作为答案使用: {}", &cleaned_trimmed[..std::cmp::min(cleaned_trimmed.len(), 100)]);
            return cleaned_trimmed.to_string();
        }
    }

    // 7) 回退：返回原始内容
    println!("⚠️ 未能提取到结构化答案,返回原始内容");
    json_content.to_string()
}
