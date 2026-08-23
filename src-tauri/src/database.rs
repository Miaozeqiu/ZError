use jieba_rs::Jieba;
use regex::Regex;
use rusqlite::{Connection, OptionalExtension};
use crate::logger::RequestLog;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::sync::OnceLock;
use strsim::normalized_levenshtein;

/// 提取字符串中所有 URL（http/https），返回排序后的列表
fn extract_urls(text: &str) -> Vec<String> {
    // 匹配 http(s):// 开头，到空白字符或常见中文标点结束
    let re = Regex::new(r"https?://[^\s]+").unwrap();
    let mut urls: Vec<String> = re
        .find_iter(text)
        .map(|m| {
            // 去掉末尾可能粘连的中文标点（句号、逗号等 UTF-8 多字节字符不在 \s 范围内）
            let s = m.as_str().trim_end_matches(|c: char| {
                matches!(
                    c,
                    '，' | '。' | '！' | '？' | '、' | '；' | '：' | '\u{300c}'
                        ..='\u{300f}' | '（' | '）' | '【' | '】'
                )
            });
            s.to_string()
        })
        .collect();
    urls.sort();
    urls
}

/// 将字符串中所有 URL 替换为统一占位符，用于相似度比较
fn normalize_urls(text: &str) -> String {
    let re = Regex::new(r"https?://[^\s]+").unwrap();
    // 先替换，再去掉占位符末尾可能残留的中文标点（不影响相似度计算）
    re.replace_all(text, "__URL__").to_string()
}

static JIEBA: OnceLock<Jieba> = OnceLock::new();

const QUERY_STOPWORDS: &[&str] = &[
    "的",
    "地",
    "得",
    "了",
    "着",
    "吗",
    "呢",
    "啊",
    "呀",
    "吧",
    "么",
    "嘛",
    "在",
    "是",
    "和",
    "与",
    "及",
    "或",
    "并",
    "且",
    "将",
    "把",
    "被",
    "由",
    "对",
    "于",
    "中",
    "上",
    "下",
    "请问",
    "哪里",
    "哪儿",
    "哪个",
    "哪种",
    "哪项",
    "哪些",
    "什么",
    "怎么",
    "怎样",
    "如何",
    "为何",
    "为什么",
    "多少",
    "几",
    "一下",
    "以下",
    "下列",
    "题目",
    "选项",
    "答案",
    "内容",
    "说法",
    "图片",
    "图中",
    "名字",
    "名称",
    "城市",
    "国家",
    "地区",
    "地方",
];

const QUESTION_AND_OPTIONS_MATCH_KEYWORDS: &[&str] = &["以下", "下列", "下面", "下叙"];

fn should_require_option_match(title: &str) -> bool {
    QUESTION_AND_OPTIONS_MATCH_KEYWORDS
        .iter()
        .any(|keyword| title.contains(keyword))
}

fn normalize_optional_query_text(text: Option<&str>) -> Option<String> {
    text.map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

fn is_punctuation_or_space(c: char) -> bool {
    c.is_whitespace()
        || c.is_ascii_punctuation()
        || matches!(
            c,
            '，' | '。'
                | '！'
                | '？'
                | '、'
                | '；'
                | '：'
                | '（'
                | '）'
                | '【'
                | '】'
                | '《'
                | '》'
                | '“'
                | '”'
                | '‘'
                | '’'
                | '—'
                | '…'
                | '·'
        )
}

fn is_meaningful_query_token(token: &str) -> bool {
    let trimmed = token.trim();
    if trimmed.is_empty() || QUERY_STOPWORDS.contains(&trimmed) {
        return false;
    }
    if trimmed.chars().all(is_punctuation_or_space) {
        return false;
    }

    let char_count = trimmed.chars().count();
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if trimmed.chars().all(|c| c.is_ascii_alphabetic()) {
        return char_count > 1;
    }

    char_count > 1
}

fn extract_query_keywords(text: &str) -> HashSet<String> {
    let jieba = JIEBA.get_or_init(Jieba::new);
    let mut keywords: Vec<String> = jieba
        .cut_for_search(text, false)
        .into_iter()
        .map(|token| token.trim().to_lowercase())
        .filter(|token| is_meaningful_query_token(token))
        .collect();

    keywords.sort_by(|a, b| {
        b.chars()
            .count()
            .cmp(&a.chars().count())
            .then_with(|| a.cmp(b))
    });

    keywords.into_iter().collect()
}

fn keyword_coverage(query_keywords: &HashSet<String>, candidate_keywords: &HashSet<String>) -> f64 {
    if query_keywords.is_empty() {
        return 1.0;
    }

    let matched = query_keywords
        .iter()
        .filter(|token| candidate_keywords.contains(*token))
        .count();

    matched as f64 / query_keywords.len() as f64
}

fn min_keyword_coverage(query_keywords_len: usize, char_similarity: f64) -> f64 {
    if query_keywords_len <= 2 {
        return 1.0;
    }

    // 高字符相似但关键词数量不多时，要求所有关键词都命中，
    // 避免“题干几乎一致但核心词不同”的题目误匹配。
    if char_similarity >= 0.88 && query_keywords_len <= 8 {
        return 1.0;
    }

    if query_keywords_len <= 4 {
        return 1.0;
    }

    if query_keywords_len <= 8 {
        return 0.9;
    }

    0.75
}

fn compute_query_match_score(query: &str, candidate: &str) -> Option<f64> {
    let normalized_query = normalize_urls(query).trim().to_lowercase();
    let normalized_candidate = normalize_urls(candidate).trim().to_lowercase();

    if normalized_query.is_empty() || normalized_candidate.is_empty() {
        return None;
    }
    if normalized_query == normalized_candidate {
        return Some(1.0);
    }

    let char_similarity = normalized_levenshtein(&normalized_query, &normalized_candidate);
    if char_similarity < 0.72 {
        return None;
    }

    let query_keywords = extract_query_keywords(&normalized_query);
    if query_keywords.is_empty() {
        return Some(char_similarity);
    }

    let candidate_keywords = extract_query_keywords(&normalized_candidate);
    let coverage = keyword_coverage(&query_keywords, &candidate_keywords);
    let min_coverage = min_keyword_coverage(query_keywords.len(), char_similarity);
    if coverage + f64::EPSILON < min_coverage {
        return None;
    }

    Some(char_similarity * 0.7 + coverage * 0.3)
}

fn is_exact_match_score(score: f64) -> bool {
    (score - 1.0).abs() <= f64::EPSILON
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AIResponse {
    pub id: i64,
    pub question: String,
    pub options: Option<String>,
    pub answer: Option<String>,
    pub question_type: Option<String>,
    pub folder_id: i64,
    pub folder_name: Option<String>,
    pub create_time: Option<String>,
    pub is_ai: bool,
    pub is_pending_correction: bool,
    pub importance: i64,
    pub mastery: i64,
    pub difficulty: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PracticeRecord {
    pub id: i64,
    pub question_id: i64,
    pub user_answer: String,
    pub is_correct: bool,
    pub note: String,
    pub source: String,
    pub create_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PracticeSummary {
    pub question_id: i64,
    pub count: i64,
    pub last_answer: String,
    pub last_correct: bool,
    pub last_note: String,
    pub last_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PracticeMarks {
    pub question_id: i64,
    pub results: Vec<bool>,
}

fn map_ai_response_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AIResponse> {
    Ok(AIResponse {
        id: row.get(0)?,
        question: row.get(1)?,
        options: row.get(2)?,
        answer: row.get(3)?,
        question_type: row.get(4)?,
        folder_id: row.get(5)?,
        folder_name: row.get(6)?,
        create_time: row.get(7)?,
        is_ai: row.get(8)?,
        is_pending_correction: row.get(9)?,
        importance: row.get(10).unwrap_or(0),
        mastery: row.get(11).unwrap_or(0),
        difficulty: row.get(12).unwrap_or(0),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub parent_id: i64,
    pub create_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderStat {
    pub folder_id: i64,
    pub folder_name: String,
    pub question_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuestionMetricBucket {
    pub importance: i64,
    pub mastery: i64,
    pub difficulty: i64,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderPathItem {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedAIResponses {
    pub items: Vec<AIResponse>,
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudySubject {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub create_time: Option<String>,
    pub node_count: i64,
    pub progress: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyGraphNodeRow {
    pub id: i64,
    pub subject_id: i64,
    pub node_key: String,
    pub name: String,
    pub summary: String,
    pub mastery: i64,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    #[serde(default)]
    pub forgetting_stage: i64,
    #[serde(default)]
    pub last_reviewed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyGraphEdgeRow {
    pub id: i64,
    pub subject_id: i64,
    pub from_id: i64,
    pub to_id: i64,
    pub relation: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyGraphPayload {
    pub subject: StudySubject,
    pub nodes: Vec<StudyGraphNodeRow>,
    pub edges: Vec<StudyGraphEdgeRow>,
}

#[derive(Debug, Deserialize)]
pub struct StudyGraphNodeInput {
    pub key: Option<String>,
    pub name: String,
    pub summary: Option<String>,
    #[serde(default, alias = "parentKey")]
    pub parent_key: Option<String>,
    #[serde(default)]
    pub mastery: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StudyGraphEdgeInput {
    pub from_key: String,
    pub to_key: String,
    pub relation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StudyGraphNodePatch {
    pub id: i64,
    pub name: Option<String>,
    pub summary: Option<String>,
    pub mastery: Option<i64>,
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub forgetting_stage: Option<i64>,
    #[serde(default)]
    pub last_reviewed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuestionKnowledgeLink {
    pub question_id: i64,
    pub node_id: i64,
    pub node_name: String,
    pub subject_id: i64,
    pub subject_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyActivity {
    pub id: i64,
    pub subject_id: i64,
    pub kind: String,
    pub names: Vec<String>,
    pub question_count: i64,
    pub correct_count: i64,
    pub create_time: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyHeatmapPoint {
    pub names: Vec<String>,
    pub create_time: String,
}

#[derive(Debug, Deserialize)]
pub struct SplitSubjectPart {
    pub name: String,
    pub description: Option<String>,
    pub node_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub struct SplitSubjectResult {
    pub original: StudySubject,
    pub created: Vec<StudySubject>,
}

#[derive(Debug, Deserialize)]
pub struct StudyProgressUpdate {
    pub id: Option<i64>,
    pub name: Option<String>,
    #[serde(default)]
    pub forgetting_stage: Option<i64>,
    #[serde(default)]
    pub last_reviewed_at: Option<String>,
    #[serde(default)]
    pub mastery: Option<i64>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub remembered: Option<bool>,
    #[serde(default)]
    pub days_ago: Option<f64>,
}

fn get_db_path() -> String {
    #[cfg(target_os = "windows")]
    {
        let username = get_username().unwrap_or_else(|_| "Administrator".to_string());
        format!(
            "C:\\Users\\{}\\AppData\\Local\\ZError\\airesponses.db",
            username
        )
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home_dir = env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        format!("{}/.local/share/zerror/airesponses.db", home_dir)
    }
}

fn get_conn() -> Result<Connection, String> {
    let db_path = get_db_path();
    Connection::open(&db_path).map_err(|e| format!("{}", e))
}

fn map_request_log_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RequestLog> {
    let timestamp_raw: String = row.get(1)?;
    let headers_raw: Option<String> = row.get(8)?;
    let timestamp = DateTime::parse_from_rfc3339(&timestamp_raw)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());
    let headers = headers_raw
        .and_then(|value| serde_json::from_str::<HashMap<String, String>>(&value).ok());

    Ok(RequestLog {
        id: row.get(0)?,
        timestamp,
        method: row.get(2)?,
        path: row.get(3)?,
        status: row.get(4)?,
        response_time: row.get(5)?,
        request_body: row.get(6)?,
        response_body: row.get(7)?,
        headers,
        ip: row.get(9)?,
        user_agent: row.get(10)?,
        stage: row.get(11)?,
    })
}

pub fn insert_request_log(log: &RequestLog, max_logs: usize) -> Result<(), String> {
    let conn = get_conn()?;
    let headers = log
        .headers
        .as_ref()
        .map(|value| serde_json::to_string(value))
        .transpose()
        .map_err(|e| format!("{}", e))?;

    conn.execute(
        "INSERT INTO RequestLogs (RequestId, Timestamp, Method, Path, Status, ResponseTime, RequestBody, ResponseBody, Headers, Ip, UserAgent, Stage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            log.id,
            log.timestamp.to_rfc3339(),
            log.method,
            log.path,
            log.status,
            log.response_time,
            log.request_body,
            log.response_body,
            headers,
            log.ip,
            log.user_agent,
            log.stage,
        ],
    )
    .map_err(|e| format!("{}", e))?;

    if max_logs > 0 {
        conn.execute(
            "DELETE FROM RequestLogs WHERE LogId NOT IN (SELECT LogId FROM RequestLogs ORDER BY LogId DESC LIMIT ?)",
            [max_logs as i64],
        )
        .map_err(|e| format!("{}", e))?;
    }

    Ok(())
}

pub fn load_persisted_request_logs(limit: Option<usize>) -> Result<Vec<RequestLog>, String> {
    let conn = get_conn()?;
    let limit = limit.unwrap_or(1000).max(1) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT RequestId, Timestamp, Method, Path, Status, ResponseTime, RequestBody, ResponseBody, Headers, Ip, UserAgent, Stage
             FROM RequestLogs
             ORDER BY LogId DESC
             LIMIT ?",
        )
        .map_err(|e| format!("{}", e))?;

    let rows = stmt
        .query_map([limit], map_request_log_row)
        .map_err(|e| format!("{}", e))?;

    let mut logs = Vec::new();
    for row in rows {
        logs.push(row.map_err(|e| format!("{}", e))?);
    }

    Ok(logs)
}

pub fn clear_persisted_request_logs() -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM RequestLogs", [])
        .map_err(|e| format!("{}", e))?;
    Ok(())
}

/// 将今天的 /query 请求数 +1。如果当天记录不存在则创建。
pub fn increment_daily_request_count() -> Result<(), String> {
    let conn = get_conn()?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "INSERT INTO DailyRequestCounts (Day, Count) VALUES (?, 1)
         ON CONFLICT(Day) DO UPDATE SET Count = Count + 1",
        [&today],
    )
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

/// 按天返回最近 365 天内的请求计数，格式为 [("YYYY-MM-DD", count)]
pub fn get_daily_request_counts() -> Result<Vec<(String, i64)>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT Day, Count
             FROM DailyRequestCounts
             WHERE Day >= DATE('now', '-364 days')
             ORDER BY Day ASC",
        )
        .map_err(|e| format!("{}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let day: String = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            Ok((day, cnt))
        })
        .map_err(|e| format!("{}", e))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_folders() -> Result<Vec<Folder>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare("SELECT Id, Name, ParentId, CreateTime FROM Folders ORDER BY Name")
        .map_err(|e| format!("{}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                create_time: row.get(3)?,
            })
        })
        .map_err(|e| format!("{}", e))?;

    let mut folders = Vec::new();
    for row in rows {
        folders.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(folders)
}

#[tauri::command]
pub async fn get_ai_responses(folder_id: Option<i64>) -> Result<Vec<AIResponse>, String> {
    let conn = get_conn()?;
    let query = if folder_id.is_some() {
        "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
         FROM AIResponses ar
         LEFT JOIN Folders f ON ar.FolderId = f.Id
         WHERE ar.FolderId = ?
         ORDER BY ar.CreateTime DESC"
    } else {
        "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
         FROM AIResponses ar
         LEFT JOIN Folders f ON ar.FolderId = f.Id
         ORDER BY ar.CreateTime DESC"
    };

    let mut stmt = conn.prepare(query).map_err(|e| format!("{}", e))?;
    let params_vec: Vec<&dyn rusqlite::ToSql> = if let Some(ref fid) = folder_id {
        vec![fid]
    } else {
        vec![]
    };

    let rows = stmt
        .query_map(params_vec.as_slice(), map_ai_response_row)
        .map_err(|e| format!("{}", e))?;

    let mut responses = Vec::new();
    for row in rows {
        responses.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(responses)
}

#[tauri::command]
pub async fn get_paginated_questions(
    folder_id: Option<i64>,
    pending_correction_only: bool,
    page: i64,
    page_size: i64,
    sort_order: Option<String>,
    importance: Option<i64>,
    mastery: Option<i64>,
    difficulty: Option<i64>,
) -> Result<PaginatedAIResponses, String> {
    let conn = get_conn()?;
    let page = page.max(1);
    let page_size = page_size.clamp(1, 200);
    let offset = (page - 1) * page_size;
    let sort_direction = if matches!(sort_order.as_deref(), Some("asc")) {
        "ASC"
    } else {
        "DESC"
    };
    let metric_ar = {
        let mut extra = String::new();
        if let Some(value) = importance {
            extra.push_str(&format!(" AND COALESCE(ar.Importance, 0) = {}", value.clamp(0, 3)));
        }
        if let Some(value) = mastery {
            extra.push_str(&format!(" AND COALESCE(ar.Mastery, 0) = {}", value.clamp(0, 3)));
        }
        if let Some(value) = difficulty {
            extra.push_str(&format!(" AND COALESCE(ar.Difficulty, 0) = {}", value.clamp(0, 3)));
        }
        extra
    };
    let metric = {
        let mut extra = String::new();
        if let Some(value) = importance {
            extra.push_str(&format!(" AND COALESCE(Importance, 0) = {}", value.clamp(0, 3)));
        }
        if let Some(value) = mastery {
            extra.push_str(&format!(" AND COALESCE(Mastery, 0) = {}", value.clamp(0, 3)));
        }
        if let Some(value) = difficulty {
            extra.push_str(&format!(" AND COALESCE(Difficulty, 0) = {}", value.clamp(0, 3)));
        }
        extra
    };

    let (total, items) = if pending_correction_only {
        let total: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM AIResponses WHERE COALESCE(IsPendingCorrection, 0) = 1{}",
                    metric
                ),
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("{}", e))?;

        let data_query = format!(
            "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
             FROM AIResponses ar
             LEFT JOIN Folders f ON ar.FolderId = f.Id
             WHERE COALESCE(ar.IsPendingCorrection, 0) = 1{}
             ORDER BY ar.CreateTime {}
             LIMIT ? OFFSET ?",
            metric_ar, sort_direction
        );

        let mut stmt = conn.prepare(&data_query).map_err(|e| format!("{}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![page_size, offset], map_ai_response_row)
            .map_err(|e| format!("{}", e))?;

        let mut responses = Vec::new();
        for row in rows {
            responses.push(row.map_err(|e| format!("{}", e))?);
        }

        (total, responses)
    } else if let Some(folder_id) = folder_id {
        if folder_id == 0 {
            let total: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM AIResponses WHERE FolderId = 0{}", metric),
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| format!("{}", e))?;

            let data_query = format!(
                "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
                 FROM AIResponses ar
                 INNER JOIN Folders f ON ar.FolderId = f.Id
                 WHERE ar.FolderId = 0{}
                 ORDER BY ar.CreateTime {}
                 LIMIT ? OFFSET ?",
                metric_ar, sort_direction
            );

            let mut stmt = conn.prepare(&data_query).map_err(|e| format!("{}", e))?;
            let rows = stmt
                .query_map(rusqlite::params![page_size, offset], map_ai_response_row)
                .map_err(|e| format!("{}", e))?;

            let mut responses = Vec::new();
            for row in rows {
                responses.push(row.map_err(|e| format!("{}", e))?);
            }

            (total, responses)
        } else {
            let total: i64 = conn
                .query_row(
                    &format!(
                        "WITH RECURSIVE folder_tree AS (
                           SELECT Id, Name, ParentId FROM Folders WHERE Id = ?
                           UNION ALL
                           SELECT f.Id, f.Name, f.ParentId FROM Folders f
                           INNER JOIN folder_tree ft ON f.ParentId = ft.Id
                         )
                         SELECT COUNT(*)
                         FROM AIResponses ar
                         INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
                         WHERE 1 = 1{}",
                        metric_ar
                    ),
                    rusqlite::params![folder_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("{}", e))?;

            let data_query = format!(
                "WITH RECURSIVE folder_tree AS (
                   SELECT Id, Name, ParentId FROM Folders WHERE Id = ?
                   UNION ALL
                   SELECT f.Id, f.Name, f.ParentId FROM Folders f
                   INNER JOIN folder_tree ft ON f.ParentId = ft.Id
                 )
                 SELECT
                   ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType,
                   ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
                 FROM AIResponses ar
                 INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
                 INNER JOIN Folders f ON ar.FolderId = f.Id
                 WHERE 1 = 1{}
                 ORDER BY ar.CreateTime {}
                 LIMIT ? OFFSET ?",
                metric_ar, sort_direction
            );

            let mut stmt = conn.prepare(&data_query).map_err(|e| format!("{}", e))?;
            let rows = stmt
                .query_map(rusqlite::params![folder_id, page_size, offset], map_ai_response_row)
                .map_err(|e| format!("{}", e))?;

            let mut responses = Vec::new();
            for row in rows {
                responses.push(row.map_err(|e| format!("{}", e))?);
            }

            (total, responses)
        }
    } else {
        let total: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM AIResponses WHERE 1 = 1{}", metric),
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("{}", e))?;

        let data_query = format!(
            "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
             FROM AIResponses ar
             LEFT JOIN Folders f ON ar.FolderId = f.Id
             WHERE 1 = 1{}
             ORDER BY ar.CreateTime {}
             LIMIT ? OFFSET ?",
            metric_ar, sort_direction
        );

        let mut stmt = conn.prepare(&data_query).map_err(|e| format!("{}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![page_size, offset], map_ai_response_row)
            .map_err(|e| format!("{}", e))?;

        let mut responses = Vec::new();
        for row in rows {
            responses.push(row.map_err(|e| format!("{}", e))?);
        }

        (total, responses)
    };

    Ok(PaginatedAIResponses { items, total })
}

#[tauri::command]
pub async fn get_questions_recursive(folder_id: i64) -> Result<Vec<AIResponse>, String> {
    let conn = get_conn()?;

    let query = if folder_id == 0 {
        "SELECT
          ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType,
          ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
        FROM AIResponses ar
        INNER JOIN Folders f ON ar.FolderId = f.Id
        WHERE ar.FolderId = 0
        ORDER BY ar.CreateTime DESC"
    } else {
        "WITH RECURSIVE folder_tree AS (
          SELECT Id, Name, ParentId FROM Folders WHERE Id = ?
          UNION ALL
          SELECT f.Id, f.Name, f.ParentId FROM Folders f
          INNER JOIN folder_tree ft ON f.ParentId = ft.Id
        )
        SELECT
          ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType,
          ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
        FROM AIResponses ar
        INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
        INNER JOIN Folders f ON ar.FolderId = f.Id
        ORDER BY ar.CreateTime DESC"
    };

    let mut stmt = conn.prepare(query).map_err(|e| format!("{}", e))?;
    let params: Vec<&dyn rusqlite::ToSql> = if folder_id == 0 {
        vec![]
    } else {
        vec![&folder_id]
    };

    let rows = stmt
        .query_map(params.as_slice(), map_ai_response_row)
        .map_err(|e| format!("{}", e))?;

    let mut responses = Vec::new();
    for row in rows {
        responses.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(responses)
}

#[tauri::command]
pub async fn get_pending_correction_questions() -> Result<Vec<AIResponse>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
             FROM AIResponses ar
             LEFT JOIN Folders f ON ar.FolderId = f.Id
             WHERE COALESCE(ar.IsPendingCorrection, 0) = 1
             ORDER BY ar.CreateTime DESC",
        )
        .map_err(|e| format!("{}", e))?;

    let rows = stmt
        .query_map([], map_ai_response_row)
        .map_err(|e| format!("{}", e))?;

    let mut responses = Vec::new();
    for row in rows {
        responses.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(responses)
}

#[tauri::command]
pub async fn get_pending_correction_question_count() -> Result<i64, String> {
    let conn = get_conn()?;
    conn.query_row(
        "SELECT COUNT(*) FROM AIResponses WHERE COALESCE(IsPendingCorrection, 0) = 1",
        [],
        |row| row.get(0),
    )
    .map_err(|e| format!("{}", e))
}

#[tauri::command]
pub async fn set_question_pending_correction(id: i64, pending: bool) -> Result<(), String> {
    let conn = get_conn()?;
    let affected = conn
        .execute(
            "UPDATE AIResponses SET IsPendingCorrection = ? WHERE Id = ?",
            rusqlite::params![pending, id],
        )
        .map_err(|e| format!("{}", e))?;

    if affected == 0 {
        return Err("题目不存在".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn get_folder_question_count(folder_id: i64) -> Result<i64, String> {
    let conn = get_conn()?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM AIResponses WHERE FolderId = ?",
            [&folder_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("{}", e))?;
    Ok(count)
}

#[tauri::command]
pub async fn get_folder_path(folder_id: i64) -> Result<Vec<FolderPathItem>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE folder_path AS (
          SELECT Id as id, Name as name, ParentId, 0 as level
          FROM Folders 
          WHERE Id = ?
          
          UNION ALL
          
          SELECT f.Id as id, f.Name as name, f.ParentId, fp.level + 1 as level
          FROM Folders f
          INNER JOIN folder_path fp ON f.Id = fp.ParentId
          WHERE f.Id != fp.id
            AND fp.id != 0
            AND fp.level < 32
        )
        SELECT id, name
        FROM folder_path
        ORDER BY level DESC",
        )
        .map_err(|e| format!("{}", e))?;

    let rows = stmt
        .query_map([&folder_id], |row| {
            Ok(FolderPathItem {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| format!("{}", e))?;

    let mut path = Vec::new();
    for row in rows {
        path.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(path)
}

#[tauri::command]
pub async fn get_folder_stats() -> Result<Vec<FolderStat>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT 
          f.Id,
          COALESCE(f.Name, '[未分类]'),
          COUNT(ar.Id) as questionCount
        FROM Folders f
        LEFT JOIN AIResponses ar ON f.Id = ar.FolderId
        GROUP BY f.Id, f.Name
        ORDER BY questionCount DESC, f.Name",
        )
        .map_err(|e| format!("{}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(FolderStat {
                folder_id: row.get(0)?,
                folder_name: row.get(1)?,
                question_count: row.get(2)?,
            })
        })
        .map_err(|e| format!("{}", e))?;

    let mut stats = Vec::new();
    for row in rows {
        stats.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(stats)
}

#[tauri::command]
pub async fn get_question_metric_stats(
    folder_id: Option<i64>,
    pending_correction_only: bool,
) -> Result<Vec<QuestionMetricBucket>, String> {
    let conn = get_conn()?;
    let query = if pending_correction_only {
        "SELECT COALESCE(Importance, 0), COALESCE(Mastery, 0), COALESCE(Difficulty, 0), COUNT(*)
         FROM AIResponses
         WHERE COALESCE(IsPendingCorrection, 0) = 1
         GROUP BY COALESCE(Importance, 0), COALESCE(Mastery, 0), COALESCE(Difficulty, 0)".to_string()
    } else if let Some(folder_id) = folder_id {
        if folder_id == 0 {
            "SELECT COALESCE(Importance, 0), COALESCE(Mastery, 0), COALESCE(Difficulty, 0), COUNT(*)
             FROM AIResponses
             WHERE FolderId = 0
             GROUP BY COALESCE(Importance, 0), COALESCE(Mastery, 0), COALESCE(Difficulty, 0)".to_string()
        } else {
            "WITH RECURSIVE folder_tree AS (
               SELECT Id FROM Folders WHERE Id = ?
               UNION ALL
               SELECT f.Id FROM Folders f
               INNER JOIN folder_tree ft ON f.ParentId = ft.Id
             )
             SELECT COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0), COUNT(*)
             FROM AIResponses ar
             INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
             GROUP BY COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)".to_string()
        }
    } else {
        "SELECT COALESCE(Importance, 0), COALESCE(Mastery, 0), COALESCE(Difficulty, 0), COUNT(*)
         FROM AIResponses
         GROUP BY COALESCE(Importance, 0), COALESCE(Mastery, 0), COALESCE(Difficulty, 0)".to_string()
    };

    let mut stmt = conn.prepare(&query).map_err(|e| format!("{}", e))?;
    let mut buckets = Vec::new();
    if !pending_correction_only && folder_id.unwrap_or(0) != 0 {
        let rows = stmt
            .query_map(rusqlite::params![folder_id.unwrap()], |row| {
                Ok(QuestionMetricBucket {
                    importance: row.get(0)?,
                    mastery: row.get(1)?,
                    difficulty: row.get(2)?,
                    count: row.get(3)?,
                })
            })
            .map_err(|e| format!("{}", e))?;
        for row in rows {
            buckets.push(row.map_err(|e| format!("{}", e))?);
        }
    } else {
        let rows = stmt
            .query_map([], |row| {
                Ok(QuestionMetricBucket {
                    importance: row.get(0)?,
                    mastery: row.get(1)?,
                    difficulty: row.get(2)?,
                    count: row.get(3)?,
                })
            })
            .map_err(|e| format!("{}", e))?;
        for row in rows {
            buckets.push(row.map_err(|e| format!("{}", e))?);
        }
    }
    Ok(buckets)
}

// 辅助函数：获取目标文件夹（智能归类）
fn get_target_folder_id(conn: &Connection, parent_folder_id: i64) -> Result<i64, rusqlite::Error> {
    if parent_folder_id == 0 {
        return Ok(0);
    }

    let sub_folders_exist: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM Folders WHERE ParentId = ?)",
        [&parent_folder_id],
        |row| row.get(0),
    )?;

    if !sub_folders_exist {
        return Ok(parent_folder_id);
    }

    let uncategorized_id: Option<i64> = conn
        .query_row(
            "SELECT Id FROM Folders WHERE ParentId = ? AND Name = '[未分类]'",
            [&parent_folder_id],
            |row| Ok(row.get(0)?),
        )
        .optional()?;

    if let Some(id) = uncategorized_id {
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO Folders (Name, ParentId, CreateTime) VALUES (?, ?, datetime('now'))",
            rusqlite::params!["[未分类]", parent_folder_id],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

fn get_configured_save_folder_id(conn: &Connection) -> i64 {
    let config_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("config.json");

    let configured_folder_id = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|config| {
            config.get("questionSaveFolderId").and_then(|value| {
                value
                    .as_i64()
                    .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
            })
        })
        .unwrap_or(0);

    if configured_folder_id <= 0 {
        return 0;
    }

    let folder_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM Folders WHERE Id = ?)",
            [configured_folder_id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !folder_exists {
        println!(
            "⚠️ 配置的题目保存文件夹不存在，已回退到默认文件夹: {}",
            configured_folder_id
        );
        return 0;
    }

    match get_target_folder_id(conn, configured_folder_id) {
        Ok(folder_id) => folder_id,
        Err(error) => {
            println!("⚠️ 解析题目保存文件夹失败，已回退到默认文件夹: {}", error);
            0
        }
    }
}

#[tauri::command]
pub async fn add_question(
    content: String,
    options: Option<String>,
    answer: String,
    question_type: Option<String>,
    folder_id: i64,
    is_ai: Option<bool>,
    importance: Option<i64>,
    mastery: Option<i64>,
    difficulty: Option<i64>,
) -> Result<AIResponse, String> {
    let conn = get_conn()?;
    let is_ai = is_ai.unwrap_or(false);
    let importance = importance.unwrap_or(0).clamp(0, 3);
    let mastery = mastery.unwrap_or(0).clamp(0, 3);
    let difficulty = difficulty.unwrap_or(0).clamp(0, 3);

    if is_ai && answer.trim().is_empty() {
        return Err("AI处理结果答案为空，不保存题目".to_string());
    }

    let target_folder_id = get_target_folder_id(&conn, folder_id).map_err(|e| format!("{}", e))?;

    conn.execute(
        "INSERT INTO AIResponses (Question, Options, Answer, QuestionType, FolderId, IsAi, Importance, Mastery, Difficulty, CreateTime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        rusqlite::params![content, options, answer, question_type, target_folder_id, is_ai, importance, mastery, difficulty],
    ).map_err(|e| format!("{}", e))?;

    let id = conn.last_insert_rowid();

    // 获取完整的插入数据返回
    let response = conn.query_row(
        "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
         FROM AIResponses ar
         LEFT JOIN Folders f ON ar.FolderId = f.Id
         WHERE ar.Id = ?",
        [id],
        map_ai_response_row,
    ).map_err(|e| format!("{}", e))?;

    Ok(response)
}

#[tauri::command]
pub async fn update_question(
    id: i64,
    question: Option<String>,
    options: Option<String>,
    answer: Option<String>,
    question_type: Option<String>,
    importance: Option<i64>,
    mastery: Option<i64>,
    difficulty: Option<i64>,
) -> Result<(), String> {
    let conn = get_conn()?;
    let mut has_content_updates = false;

    if let Some(q) = question {
        conn.execute(
            "UPDATE AIResponses SET Question = ? WHERE Id = ?",
            rusqlite::params![q, id],
        )
        .map_err(|e| format!("{}", e))?;
        has_content_updates = true;
    }
    if let Some(o) = options {
        conn.execute(
            "UPDATE AIResponses SET Options = ? WHERE Id = ?",
            rusqlite::params![o, id],
        )
        .map_err(|e| format!("{}", e))?;
        has_content_updates = true;
    }
    if let Some(a) = answer {
        conn.execute(
            "UPDATE AIResponses SET Answer = ? WHERE Id = ?",
            rusqlite::params![a, id],
        )
        .map_err(|e| format!("{}", e))?;
        has_content_updates = true;
    }
    if let Some(t) = question_type {
        conn.execute(
            "UPDATE AIResponses SET QuestionType = ? WHERE Id = ?",
            rusqlite::params![t, id],
        )
        .map_err(|e| format!("{}", e))?;
        has_content_updates = true;
    }
    if let Some(value) = importance {
        conn.execute(
            "UPDATE AIResponses SET Importance = ? WHERE Id = ?",
            rusqlite::params![value.clamp(0, 3), id],
        )
        .map_err(|e| format!("{}", e))?;
    }
    if let Some(value) = mastery {
        conn.execute(
            "UPDATE AIResponses SET Mastery = ? WHERE Id = ?",
            rusqlite::params![value.clamp(0, 3), id],
        )
        .map_err(|e| format!("{}", e))?;
    }
    if let Some(value) = difficulty {
        conn.execute(
            "UPDATE AIResponses SET Difficulty = ? WHERE Id = ?",
            rusqlite::params![value.clamp(0, 3), id],
        )
        .map_err(|e| format!("{}", e))?;
    }

    if has_content_updates {
        conn.execute(
            "UPDATE AIResponses SET IsPendingCorrection = 0 WHERE Id = ?",
            rusqlite::params![id],
        )
        .map_err(|e| format!("{}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn move_question(question_id: i64, target_folder_id: i64) -> Result<(), String> {
    let conn = get_conn()?;
    let actual_target_id =
        get_target_folder_id(&conn, target_folder_id).map_err(|e| format!("{}", e))?;

    conn.execute(
        "UPDATE AIResponses SET FolderId = ? WHERE Id = ?",
        rusqlite::params![actual_target_id, question_id],
    )
    .map_err(|e| format!("{}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn copy_question(question_id: i64, target_folder_id: i64) -> Result<(), String> {
    let conn = get_conn()?;
    let actual_target_id =
        get_target_folder_id(&conn, target_folder_id).map_err(|e| format!("{}", e))?;

    // 获取原题
    let (q, o, a, qt, ia, ipc, importance, mastery, difficulty): (String, Option<String>, String, Option<String>, bool, bool, i64, i64, i64) = conn
        .query_row(
            "SELECT Question, Options, Answer, QuestionType, IsAi, COALESCE(IsPendingCorrection, 0), COALESCE(Importance, 0), COALESCE(Mastery, 0), COALESCE(Difficulty, 0) FROM AIResponses WHERE Id = ?",
            [question_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .map_err(|e| format!("{}", e))?;

    conn.execute(
        "INSERT INTO AIResponses (Question, Options, Answer, QuestionType, FolderId, IsAi, IsPendingCorrection, Importance, Mastery, Difficulty, CreateTime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        rusqlite::params![q, o, a, qt, actual_target_id, ia, ipc, importance, mastery, difficulty],
    ).map_err(|e| format!("{}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_questions_by_ids(ids: Vec<i64>) -> Result<Vec<AIResponse>, String> {
    let conn = get_conn()?;
    let mut items = Vec::new();
    for id in ids {
        if id <= 0 {
            continue;
        }
        if let Ok(item) = conn.query_row(
            "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
             FROM AIResponses ar
             LEFT JOIN Folders f ON ar.FolderId = f.Id
             WHERE ar.Id = ?",
            [id],
            map_ai_response_row,
        ) {
            items.push(item);
        }
    }
    Ok(items)
}

fn map_practice_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PracticeRecord> {
    Ok(PracticeRecord {
        id: row.get(0)?,
        question_id: row.get(1)?,
        user_answer: row.get(2)?,
        is_correct: row.get::<_, i64>(3)? != 0,
        note: row.get(4)?,
        source: row.get(5)?,
        create_time: row.get(6)?,
    })
}

#[tauri::command]
pub async fn add_practice_record(
    question_id: i64,
    user_answer: String,
    is_correct: bool,
    note: Option<String>,
    source: Option<String>,
) -> Result<PracticeRecord, String> {
    if question_id <= 0 {
        return Err("题目 Id 无效".to_string());
    }
    let conn = get_conn()?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM AIResponses WHERE Id = ?",
            [question_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("{}", e))?;
    if exists == 0 {
        return Err("题目不存在".to_string());
    }
    let note = note.unwrap_or_default();
    let source = source.unwrap_or_else(|| "agent".to_string());
    conn.execute(
        "INSERT INTO QuestionPracticeHistory (QuestionId, UserAnswer, IsCorrect, Note, Source, CreateTime)
         VALUES (?, ?, ?, ?, ?, datetime('now'))",
        rusqlite::params![question_id, user_answer, if is_correct { 1 } else { 0 }, note, source],
    )
    .map_err(|e| format!("{}", e))?;
    let id = conn.last_insert_rowid();
    let _ = record_practice_activity(&conn, question_id, is_correct);
    conn.query_row(
        "SELECT Id, QuestionId, UserAnswer, IsCorrect, Note, Source, CreateTime
         FROM QuestionPracticeHistory WHERE Id = ?",
        [id],
        map_practice_row,
    )
    .map_err(|e| format!("{}", e))
}

#[tauri::command]
pub async fn update_practice_note(id: i64, note: String) -> Result<(), String> {
    let conn = get_conn()?;
    let changed = conn
        .execute(
            "UPDATE QuestionPracticeHistory SET Note = ? WHERE Id = ?",
            rusqlite::params![note, id],
        )
        .map_err(|e| format!("{}", e))?;
    if changed == 0 {
        return Err("练习记录不存在".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_practice_history(
    question_id: i64,
    limit: Option<i64>,
) -> Result<Vec<PracticeRecord>, String> {
    let conn = get_conn()?;
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let mut stmt = conn
        .prepare(
            "SELECT Id, QuestionId, UserAnswer, IsCorrect, Note, Source, CreateTime
             FROM QuestionPracticeHistory
             WHERE QuestionId = ?
             ORDER BY Id DESC
             LIMIT ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![question_id, limit], map_practice_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

#[tauri::command]
pub async fn get_practice_summaries(ids: Vec<i64>) -> Result<Vec<PracticeSummary>, String> {
    let conn = get_conn()?;
    let mut items = Vec::new();
    for id in ids {
        if id <= 0 {
            continue;
        }
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM QuestionPracticeHistory WHERE QuestionId = ?",
                [id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if count == 0 {
            items.push(PracticeSummary {
                question_id: id,
                count: 0,
                last_answer: String::new(),
                last_correct: false,
                last_note: String::new(),
                last_time: None,
            });
            continue;
        }
        let last = conn
            .query_row(
                "SELECT UserAnswer, IsCorrect, Note, CreateTime
                 FROM QuestionPracticeHistory
                 WHERE QuestionId = ?
                 ORDER BY Id DESC
                 LIMIT 1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? != 0,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .map_err(|e| format!("{}", e))?;
        items.push(PracticeSummary {
            question_id: id,
            count,
            last_answer: last.0,
            last_correct: last.1,
            last_note: last.2,
            last_time: last.3,
        });
    }
    Ok(items)
}

#[tauri::command]
pub async fn get_recent_practice_marks(
    ids: Vec<i64>,
    limit: Option<i64>,
) -> Result<Vec<PracticeMarks>, String> {
    let conn = get_conn()?;
    let limit = limit.unwrap_or(5).clamp(1, 10) as usize;
    let unique: Vec<i64> = ids
        .into_iter()
        .filter(|id| *id > 0)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    if unique.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = unique.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT QuestionId, IsCorrect
         FROM QuestionPracticeHistory
         WHERE QuestionId IN ({placeholders})
         ORDER BY QuestionId, Id DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(unique.iter().copied()), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)? != 0))
        })
        .map_err(|e| format!("{}", e))?;
    let mut grouped = std::collections::HashMap::<i64, Vec<bool>>::new();
    for row in rows {
        let (question_id, is_correct) = row.map_err(|e| format!("{}", e))?;
        let list = grouped.entry(question_id).or_default();
        if list.len() < limit {
            list.push(is_correct);
        }
    }
    Ok(unique
        .into_iter()
        .map(|question_id| {
            let mut results = grouped.remove(&question_id).unwrap_or_default();
            results.reverse();
            PracticeMarks {
                question_id,
                results,
            }
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentWrongQuestion {
    pub question_id: i64,
    pub last_wrong_answer: String,
    pub last_wrong_note: String,
    pub last_wrong_time: Option<String>,
    pub wrong_count: i64,
}

#[tauri::command]
pub async fn list_recent_wrong_questions(
    subject_id: Option<i64>,
    node_id: Option<i64>,
    folder_id: Option<i64>,
    days: Option<i64>,
    limit: Option<i64>,
    unresolved_only: Option<bool>,
) -> Result<Vec<RecentWrongQuestion>, String> {
    let conn = get_conn()?;
    let limit = limit.unwrap_or(20).clamp(1, 40);
    let mut sql = String::from(
        "SELECT p.QuestionId, p.UserAnswer, p.Note, p.CreateTime,
                (SELECT COUNT(1) FROM QuestionPracticeHistory w
                 WHERE w.QuestionId = p.QuestionId
                   AND w.IsCorrect = 0
                   AND length(trim(w.UserAnswer)) > 0) AS wrong_count
         FROM QuestionPracticeHistory p
         WHERE p.IsCorrect = 0
           AND length(trim(p.UserAnswer)) > 0
           AND p.Id = (
             SELECT MAX(x.Id) FROM QuestionPracticeHistory x
             WHERE x.QuestionId = p.QuestionId
               AND x.IsCorrect = 0
               AND length(trim(x.UserAnswer)) > 0
           )",
    );
    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(days) = days.filter(|value| *value > 0) {
        sql.push_str(" AND datetime(p.CreateTime) >= datetime('now', ?)");
        params.push(rusqlite::types::Value::Text(format!("-{} days", days.clamp(1, 365))));
    }
    if let Some(node_id) = node_id.filter(|value| *value > 0) {
        sql.push_str(
            " AND p.QuestionId IN (
                WITH RECURSIVE subtree(Id) AS (
                    SELECT Id FROM StudyGraphNodes WHERE Id = ?
                    UNION ALL
                    SELECT n.Id
                    FROM StudyGraphNodes n
                    JOIN subtree s ON n.ParentId = s.Id
                    WHERE n.Id != s.Id
                )
                SELECT DISTINCT q.QuestionId
                FROM QuestionKnowledgeNodes q
                JOIN subtree s ON s.Id = q.NodeId
             )",
        );
        params.push(rusqlite::types::Value::Integer(node_id));
    } else if let Some(subject_id) = subject_id.filter(|value| *value > 0) {
        sql.push_str(
            " AND p.QuestionId IN (
                SELECT DISTINCT q.QuestionId
                FROM QuestionKnowledgeNodes q
                JOIN StudyGraphNodes n ON n.Id = q.NodeId
                WHERE n.SubjectId = ?
             )",
        );
        params.push(rusqlite::types::Value::Integer(subject_id));
    }
    if let Some(folder_id) = folder_id.filter(|value| *value >= 0) {
        sql.push_str(" AND EXISTS (SELECT 1 FROM AIResponses a WHERE a.Id = p.QuestionId AND a.FolderId = ?)");
        params.push(rusqlite::types::Value::Integer(folder_id));
    }
    if unresolved_only.unwrap_or(false) {
        sql.push_str(
            " AND (
                SELECT y.IsCorrect FROM QuestionPracticeHistory y
                WHERE y.QuestionId = p.QuestionId AND length(trim(y.UserAnswer)) > 0
                ORDER BY y.Id DESC LIMIT 1
              ) = 0",
        );
    }
    sql.push_str(" ORDER BY p.Id DESC LIMIT ?");
    params.push(rusqlite::types::Value::Integer(limit));
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params), |row| {
            Ok(RecentWrongQuestion {
                question_id: row.get(0)?,
                last_wrong_answer: row.get(1)?,
                last_wrong_note: row.get(2)?,
                last_wrong_time: row.get(3)?,
                wrong_count: row.get(4)?,
            })
        })
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

fn clamp_mastery(value: i64) -> i64 {
    if value < 0 {
        0
    } else if value > 3 {
        3
    } else {
        value
    }
}

fn clamp_forgetting_stage(value: i64) -> i64 {
    value.clamp(0, 6)
}

fn forgetting_strength_days(stage: i64) -> f64 {
    match clamp_forgetting_stage(stage) {
        0 => 0.5,
        1 => 1.0,
        2 => 2.0,
        3 => 4.0,
        4 => 7.0,
        5 => 15.0,
        _ => 30.0,
    }
}

fn parse_study_quality(raw: Option<&str>) -> &'static str {
    let text = raw.unwrap_or("").trim().to_ascii_lowercase();
    if matches!(
        text.as_str(),
        "poor" | "bad" | "weak" | "差" | "生疏" | "忘" | "不会"
    ) {
        "poor"
    } else if matches!(
        text.as_str(),
        "fair" | "ok" | "okay" | "medium" | "一般" | "还行" | "半对" | "有印象"
    ) {
        "fair"
    } else {
        "good"
    }
}

fn reviewed_at_for_quality(stage: i64, quality: &str, now: DateTime<Utc>) -> String {
    let target = match quality {
        "poor" => 0.4_f64,
        "fair" => 0.72_f64,
        _ => return now.to_rfc3339(),
    };
    let days = -target.ln() * forgetting_strength_days(stage).max(0.25);
    let millis = (days * 86_400_000.0).round() as i64;
    (now - Duration::milliseconds(millis)).to_rfc3339()
}

fn stage_base_mastery(stage: i64) -> i64 {
    match clamp_forgetting_stage(stage) {
        0 => 1,
        1 | 2 | 3 => 2,
        _ => 3,
    }
}

fn parse_reviewed_at(raw: &str) -> Option<DateTime<Utc>> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(text) {
        return Some(dt.with_timezone(&Utc));
    }
    NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|value| value.and_utc())
}

fn lapse_forgetting(mut stage: i64, mut days: f64) -> (i64, f64, f64) {
    stage = clamp_forgetting_stage(stage);
    let mut retention = 1.0;
    while stage > 0 && days > forgetting_strength_days(stage) {
        retention *= (-1.0_f64).exp();
        days -= forgetting_strength_days(stage);
        stage -= 1;
    }
    retention *= (-days / forgetting_strength_days(stage)).exp();
    (stage, days, retention)
}

fn days_since_reviewed(raw: Option<&str>) -> f64 {
    let Some(at) = raw.and_then(parse_reviewed_at) else {
        return 0.0;
    };
    let secs = (Utc::now() - at).num_seconds().max(0) as f64;
    secs / 86_400.0
}

fn days_between_reviewed(from: Option<&str>, to: &str) -> f64 {
    let Some(start) = from.and_then(parse_reviewed_at) else {
        return 0.0;
    };
    let end = parse_reviewed_at(to).unwrap_or_else(Utc::now);
    (end - start).num_seconds().max(0) as f64 / 86_400.0
}

fn next_forgetting_stage(
    prev_stage: i64,
    prev_reviewed: Option<&str>,
    remembered: bool,
    at: &str,
) -> i64 {
    let had_review = prev_reviewed
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if !had_review && clamp_forgetting_stage(prev_stage) <= 0 {
        return 0;
    }
    let days = days_between_reviewed(prev_reviewed, at);
    let (stage, _days, retention) = lapse_forgetting(prev_stage, days);
    if !remembered {
        return (stage - 1).max(0);
    }
    let too_soon = days < forgetting_strength_days(prev_stage) * 0.35 && days < 0.75;
    if too_soon && retention >= 0.85 {
        return stage;
    }
    if retention >= 0.3 {
        return (stage + 1).min(6);
    }
    (stage - 1).max(0)
}

fn effective_mastery(stored: i64, stage: i64, last_reviewed: Option<&str>) -> i64 {
    let reviewed = last_reviewed.map(str::trim).filter(|value| !value.is_empty());
    if stored == 0 && clamp_forgetting_stage(stage) == 0 && reviewed.is_none() {
        return 0;
    }
    let (lapsed_stage, _days, retention) =
        lapse_forgetting(stage, days_since_reviewed(reviewed));
    let base = stage_base_mastery(lapsed_stage);
    if retention >= 0.7 {
        base
    } else if retention >= 0.4 {
        base.min(2).max(1)
    } else {
        1
    }
}

fn mastery_for_stage(stage: i64, last_reviewed: Option<&str>) -> i64 {
    effective_mastery(1, stage, last_reviewed)
}

fn map_study_subject_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StudySubject> {
    Ok(StudySubject {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        create_time: row.get(3)?,
        node_count: row.get(4)?,
        progress: 0.0,
    })
}

fn node_retention(mastery: i64, stage: i64, last_reviewed: Option<&str>) -> Option<f64> {
    let reviewed = last_reviewed.map(str::trim).filter(|value| !value.is_empty());
    if mastery == 0 && clamp_forgetting_stage(stage) == 0 && reviewed.is_none() {
        None
    } else {
        let (_lapsed_stage, _days, retention) =
            lapse_forgetting(stage, days_since_reviewed(reviewed));
        Some(retention)
    }
}

fn average_retention(scores: &[Option<f64>]) -> Option<f64> {
    if scores.is_empty() || scores.iter().all(|score| score.is_none()) {
        return None;
    }
    Some(scores.iter().map(|score| score.unwrap_or(0.0)).sum::<f64>() / scores.len() as f64)
}

fn rolled_node_retention(
    index: usize,
    items: &[(i64, i64, i64, Option<i64>, Option<String>)],
    children: &[Vec<usize>],
) -> Option<f64> {
    if children[index].is_empty() {
        return node_retention(items[index].1, items[index].2, items[index].4.as_deref());
    }
    let scores: Vec<Option<f64>> = children[index]
        .iter()
        .map(|child| rolled_node_retention(*child, items, children))
        .collect();
    average_retention(&scores)
}

fn load_subject_memory(
    conn: &Connection,
    subject_id: i64,
) -> Result<Vec<(i64, i64, i64, Option<i64>, Option<String>)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT Id, Mastery, COALESCE(ForgettingStage, 0), ParentId, LastReviewedAt
             FROM StudyGraphNodes WHERE SubjectId = ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1).unwrap_or(0),
                row.get::<_, i64>(2).unwrap_or(0),
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

fn progress_from_memory(items: &[(i64, i64, i64, Option<i64>, Option<String>)]) -> f64 {
    if items.is_empty() {
        return 0.0;
    }
    let id_to_index: HashMap<i64, usize> = items
        .iter()
        .enumerate()
        .map(|(index, item)| (item.0, index))
        .collect();
    let mut children = vec![Vec::new(); items.len()];
    let mut roots = Vec::new();
    for (index, item) in items.iter().enumerate() {
        match item.3.and_then(|parent| id_to_index.get(&parent).copied()) {
            Some(parent) if parent != index => children[parent].push(index),
            _ => roots.push(index),
        }
    }
    if roots.is_empty() {
        roots.extend(0..items.len());
    }
    let scores: Vec<Option<f64>> = roots
        .iter()
        .map(|index| rolled_node_retention(*index, items, &children))
        .collect();
    average_retention(&scores).unwrap_or(0.0).clamp(0.0, 1.0)
}

fn load_study_subject(conn: &Connection, subject_id: i64) -> Result<StudySubject, String> {
    let mut subject = conn
        .query_row(
            "SELECT s.Id, s.Name, s.Description, s.CreateTime,
                    COUNT(n.Id), 0
             FROM StudySubjects s
             LEFT JOIN StudyGraphNodes n ON n.SubjectId = s.Id
             WHERE s.Id = ?
             GROUP BY s.Id",
            [subject_id],
            map_study_subject_row,
        )
        .map_err(|_| "学习科目不存在".to_string())?;
    let memory = load_subject_memory(conn, subject_id)?;
    subject.node_count = memory.len() as i64;
    subject.progress = progress_from_memory(&memory);
    Ok(subject)
}

fn load_study_graph(conn: &Connection, subject_id: i64) -> Result<StudyGraphPayload, String> {
    let subject = load_study_subject(conn, subject_id)?;
    let mut node_stmt = conn
        .prepare(
            "SELECT Id, SubjectId, NodeKey, Name, Summary, Mastery, ParentId, SortOrder,
                    COALESCE(ForgettingStage, 0), LastReviewedAt
             FROM StudyGraphNodes WHERE SubjectId = ? ORDER BY SortOrder, Id",
        )
        .map_err(|e| format!("{}", e))?;
    let nodes = node_stmt
        .query_map([subject_id], |row| {
            let stored: i64 = row.get(5)?;
            let stage: i64 = row.get(8)?;
            let reviewed: Option<String> = row.get(9)?;
            Ok(StudyGraphNodeRow {
                id: row.get(0)?,
                subject_id: row.get(1)?,
                node_key: row.get(2)?,
                name: row.get(3)?,
                summary: row.get(4)?,
                mastery: effective_mastery(stored, stage, reviewed.as_deref()),
                parent_id: row.get(6)?,
                sort_order: row.get(7)?,
                forgetting_stage: clamp_forgetting_stage(stage),
                last_reviewed_at: reviewed,
            })
        })
        .map_err(|e| format!("{}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("{}", e))?;
    let mut edge_stmt = conn
        .prepare(
            "SELECT Id, SubjectId, FromId, ToId, Relation
             FROM StudyGraphEdges WHERE SubjectId = ? ORDER BY Id",
        )
        .map_err(|e| format!("{}", e))?;
    let edges = edge_stmt
        .query_map([subject_id], |row| {
            Ok(StudyGraphEdgeRow {
                id: row.get(0)?,
                subject_id: row.get(1)?,
                from_id: row.get(2)?,
                to_id: row.get(3)?,
                relation: row.get(4)?,
            })
        })
        .map_err(|e| format!("{}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("{}", e))?;
    Ok(StudyGraphPayload {
        subject,
        nodes,
        edges,
    })
}

#[tauri::command]
pub async fn list_study_subjects() -> Result<Vec<StudySubject>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT s.Id, s.Name, s.Description, s.CreateTime,
                    COUNT(n.Id), COALESCE(AVG(n.Mastery), 0)
             FROM StudySubjects s
             LEFT JOIN StudyGraphNodes n ON n.SubjectId = s.Id
             GROUP BY s.Id
             ORDER BY s.Id DESC",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([], map_study_subject_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        let mut item = row.map_err(|e| format!("{}", e))?;
        let memory = load_subject_memory(&conn, item.id)?;
        item.node_count = memory.len() as i64;
        item.progress = progress_from_memory(&memory);
        items.push(item);
    }
    Ok(items)
}

#[tauri::command]
pub async fn create_study_subject(name: String, description: Option<String>) -> Result<StudySubject, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("科目名称不能为空".to_string());
    }
    let description = description.unwrap_or_default();
    let conn = get_conn()?;
    conn.execute(
        "INSERT INTO StudySubjects (Name, Description, CreateTime) VALUES (?, ?, datetime('now'))",
        rusqlite::params![name, description],
    )
    .map_err(|e| format!("{}", e))?;
    let id = conn.last_insert_rowid();
    load_study_subject(&conn, id)
}

#[tauri::command]
pub async fn rename_study_subject(
    id: i64,
    name: Option<String>,
    description: Option<String>,
) -> Result<StudySubject, String> {
    let conn = get_conn()?;
    let current = load_study_subject(&conn, id)?;
    let next_name = name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(current.name);
    let next_description = description.unwrap_or(current.description);
    conn.execute(
        "UPDATE StudySubjects SET Name = ?, Description = ? WHERE Id = ?",
        rusqlite::params![next_name, next_description, id],
    )
    .map_err(|e| format!("{}", e))?;
    load_study_subject(&conn, id)
}

#[tauri::command]
pub async fn delete_study_subject(id: i64) -> Result<(), String> {
    let conn = get_conn()?;
    load_study_subject(&conn, id)?;
    conn.execute("DELETE FROM StudyGraphEdges WHERE SubjectId = ?", [id])
        .map_err(|e| format!("{}", e))?;
    delete_knowledge_links_for_subject(&conn, id)?;
    conn.execute("DELETE FROM StudyGraphNodes WHERE SubjectId = ?", [id])
        .map_err(|e| format!("{}", e))?;
    conn.execute("DELETE FROM StudyActivity WHERE SubjectId = ?", [id])
        .map_err(|e| format!("{}", e))?;
    conn.execute("DELETE FROM StudySubjects WHERE Id = ?", [id])
        .map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_study_graph(subject_id: i64) -> Result<StudyGraphPayload, String> {
    let conn = get_conn()?;
    load_study_graph(&conn, subject_id)
}

fn insert_study_nodes(
    conn: &Connection,
    subject_id: i64,
    nodes: &[StudyGraphNodeInput],
    start_order: i64,
    existing: &mut HashMap<String, i64>,
) -> Result<HashMap<String, i64>, String> {
    if nodes.len() > 60 {
        return Err("一次不要超过 60 个知识点".to_string());
    }
    let mut new_keys: HashMap<String, i64> = HashMap::new();
    let mut name_to_key: HashMap<String, String> = HashMap::new();
    let mut final_keys: Vec<String> = Vec::with_capacity(nodes.len());
    for (index, node) in nodes.iter().enumerate() {
        let name = node.name.trim().to_string();
        if name.is_empty() {
            final_keys.push(String::new());
            continue;
        }
        let base = node
            .key
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("n{}", start_order + index as i64 + 1));
        let mut key = base.clone();
        let mut suffix = 2;
        while existing.contains_key(&key) || new_keys.contains_key(&key) {
            key = format!("{}_{}", base, suffix);
            suffix += 1;
        }
        let mastery = clamp_mastery(node.mastery.unwrap_or(0));
        let summary = node.summary.clone().unwrap_or_default();
        conn.execute(
            "INSERT INTO StudyGraphNodes (SubjectId, NodeKey, Name, Summary, Mastery, ParentId, SortOrder, ForgettingStage, LastReviewedAt)
             VALUES (?, ?, ?, ?, ?, NULL, ?, 0, NULL)",
            rusqlite::params![subject_id, key, name, summary, mastery, start_order + index as i64],
        )
        .map_err(|e| format!("{}", e))?;
        let id = conn.last_insert_rowid();
        new_keys.insert(key.clone(), id);
        existing.insert(key.clone(), id);
        name_to_key.entry(name).or_insert_with(|| key.clone());
        final_keys.push(key);
    }
    for (index, node) in nodes.iter().enumerate() {
        let child_key = &final_keys[index];
        if child_key.is_empty() {
            continue;
        }
        let Some(parent_raw) = node
            .parent_key
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if parent_raw == *child_key {
            continue;
        }
        let parent_key = if existing.contains_key(&parent_raw) {
            parent_raw
        } else if let Some(mapped) = name_to_key.get(&parent_raw) {
            mapped.clone()
        } else {
            continue;
        };
        let Some(&child_id) = existing.get(child_key) else {
            continue;
        };
        let Some(&parent_id) = existing.get(&parent_key) else {
            continue;
        };
        conn.execute(
            "UPDATE StudyGraphNodes SET ParentId = ? WHERE Id = ?",
            rusqlite::params![parent_id, child_id],
        )
        .map_err(|e| format!("{}", e))?;
    }
    Ok(new_keys)
}

#[tauri::command]
pub async fn set_study_graph(
    subject_id: i64,
    nodes: Vec<StudyGraphNodeInput>,
    edges: Option<Vec<StudyGraphEdgeInput>>,
) -> Result<StudyGraphPayload, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    conn.execute("DELETE FROM StudyGraphEdges WHERE SubjectId = ?", [subject_id])
        .map_err(|e| format!("{}", e))?;
    delete_knowledge_links_for_subject(&conn, subject_id)?;
    conn.execute("DELETE FROM StudyGraphNodes WHERE SubjectId = ?", [subject_id])
        .map_err(|e| format!("{}", e))?;
    let key_to_id = insert_study_nodes(&conn, subject_id, &nodes, 0, &mut HashMap::new())?;
    if let Some(edges) = edges {
        for edge in edges {
            let from_id = *key_to_id
                .get(edge.from_key.trim())
                .ok_or_else(|| format!("边的起点「{}」不存在", edge.from_key))?;
            let to_id = *key_to_id
                .get(edge.to_key.trim())
                .ok_or_else(|| format!("边的终点「{}」不存在", edge.to_key))?;
            if from_id == to_id {
                continue;
            }
            let relation = edge.relation.unwrap_or_default();
            conn.execute(
                "INSERT INTO StudyGraphEdges (SubjectId, FromId, ToId, Relation) VALUES (?, ?, ?, ?)",
                rusqlite::params![subject_id, from_id, to_id, relation],
            )
            .map_err(|e| format!("{}", e))?;
        }
    }
    load_study_graph(&conn, subject_id)
}

#[tauri::command]
pub async fn patch_study_graph(
    subject_id: i64,
    add: Option<Vec<StudyGraphNodeInput>>,
    update: Option<Vec<StudyGraphNodePatch>>,
    remove_ids: Option<Vec<i64>>,
) -> Result<StudyGraphPayload, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    if let Some(ids) = remove_ids {
        for id in ids {
            conn.execute(
                "DELETE FROM StudyGraphEdges WHERE SubjectId = ? AND (FromId = ? OR ToId = ?)",
                rusqlite::params![subject_id, id, id],
            )
            .map_err(|e| format!("{}", e))?;
            conn.execute(
                "UPDATE StudyGraphNodes SET ParentId = NULL WHERE SubjectId = ? AND ParentId = ?",
                rusqlite::params![subject_id, id],
            )
            .map_err(|e| format!("{}", e))?;
            conn.execute(
                "DELETE FROM QuestionKnowledgeNodes WHERE NodeId = ?",
                [id],
            )
            .map_err(|e| format!("{}", e))?;
            conn.execute(
                "DELETE FROM StudyGraphNodes WHERE SubjectId = ? AND Id = ?",
                rusqlite::params![subject_id, id],
            )
            .map_err(|e| format!("{}", e))?;
        }
    }
    if let Some(items) = update {
        for item in items {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(1) FROM StudyGraphNodes WHERE Id = ? AND SubjectId = ?",
                    rusqlite::params![item.id, subject_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("{}", e))?;
            if exists == 0 {
                return Err(format!("知识点 {} 不在该科目中", item.id));
            }
            if let Some(name) = item.name {
                let name = name.trim().to_string();
                if name.is_empty() {
                    return Err("知识点名称不能为空".to_string());
                }
                conn.execute(
                    "UPDATE StudyGraphNodes SET Name = ? WHERE Id = ?",
                    rusqlite::params![name, item.id],
                )
                .map_err(|e| format!("{}", e))?;
            }
            if let Some(summary) = item.summary {
                conn.execute(
                    "UPDATE StudyGraphNodes SET Summary = ? WHERE Id = ?",
                    rusqlite::params![summary, item.id],
                )
                .map_err(|e| format!("{}", e))?;
            }
            if let Some(mastery) = item.mastery {
                conn.execute(
                    "UPDATE StudyGraphNodes SET Mastery = ? WHERE Id = ?",
                    rusqlite::params![clamp_mastery(mastery), item.id],
                )
                .map_err(|e| format!("{}", e))?;
            }
            if let Some(stage) = item.forgetting_stage {
                conn.execute(
                    "UPDATE StudyGraphNodes SET ForgettingStage = ? WHERE Id = ?",
                    rusqlite::params![clamp_forgetting_stage(stage), item.id],
                )
                .map_err(|e| format!("{}", e))?;
            }
            if let Some(reviewed) = item.last_reviewed_at {
                let reviewed = reviewed.trim().to_string();
                if reviewed.is_empty() {
                    conn.execute(
                        "UPDATE StudyGraphNodes SET LastReviewedAt = NULL WHERE Id = ?",
                        [item.id],
                    )
                    .map_err(|e| format!("{}", e))?;
                } else {
                    conn.execute(
                        "UPDATE StudyGraphNodes SET LastReviewedAt = ? WHERE Id = ?",
                        rusqlite::params![reviewed, item.id],
                    )
                    .map_err(|e| format!("{}", e))?;
                }
            }
            if let Some(parent_id) = item.parent_id {
                if parent_id == item.id {
                    return Err("知识点不能作为自己的父节点".to_string());
                }
                if parent_id > 0 {
                    let parent_ok: i64 = conn
                        .query_row(
                            "SELECT COUNT(1) FROM StudyGraphNodes WHERE Id = ? AND SubjectId = ?",
                            rusqlite::params![parent_id, subject_id],
                            |row| row.get(0),
                        )
                        .map_err(|e| format!("{}", e))?;
                    if parent_ok == 0 {
                        return Err(format!("父节点 {} 不在该科目中", parent_id));
                    }
                    conn.execute(
                        "UPDATE StudyGraphNodes SET ParentId = ? WHERE Id = ?",
                        rusqlite::params![parent_id, item.id],
                    )
                    .map_err(|e| format!("{}", e))?;
                } else {
                    conn.execute(
                        "UPDATE StudyGraphNodes SET ParentId = NULL WHERE Id = ?",
                        [item.id],
                    )
                    .map_err(|e| format!("{}", e))?;
                }
            }
        }
    }
    if let Some(items) = add {
        if !items.is_empty() {
            let max_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(SortOrder), -1) FROM StudyGraphNodes WHERE SubjectId = ?",
                    [subject_id],
                    |row| row.get(0),
                )
                .unwrap_or(-1);
            let mut existing: HashMap<String, i64> = HashMap::new();
            let mut key_stmt = conn
                .prepare("SELECT NodeKey, Name, Id FROM StudyGraphNodes WHERE SubjectId = ?")
                .map_err(|e| format!("{}", e))?;
            let rows = key_stmt
                .query_map([subject_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })
                .map_err(|e| format!("{}", e))?;
            for row in rows {
                let (key, name, id) = row.map_err(|e| format!("{}", e))?;
                existing.insert(key, id);
                let name = name.trim().to_string();
                if !name.is_empty() {
                    existing.entry(name).or_insert(id);
                }
            }
            insert_study_nodes(&conn, subject_id, &items, max_order + 1, &mut existing)?;
        }
    }
    load_study_graph(&conn, subject_id)
}

fn resolve_progress_node_id(
    conn: &Connection,
    subject_id: i64,
    update: &StudyProgressUpdate,
) -> Result<i64, String> {
    if let Some(id) = update.id.filter(|value| *value > 0) {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM StudyGraphNodes WHERE Id = ? AND SubjectId = ?",
                rusqlite::params![id, subject_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("{}", e))?;
        if exists == 0 {
            return Err(format!("知识点 {} 不在该科目中", id));
        }
        return Ok(id);
    }
    let name = update
        .name
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请提供 node_id 或 node_name".to_string())?;
    let mut stmt = conn
        .prepare("SELECT Id, Name FROM StudyGraphNodes WHERE SubjectId = ?")
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("{}", e))?;
    let mut exact = Vec::new();
    let mut fuzzy = Vec::new();
    for row in rows {
        let (id, node_name) = row.map_err(|e| format!("{}", e))?;
        if node_name == name {
            exact.push(id);
        } else if node_name.contains(&name) || name.contains(&node_name) {
            fuzzy.push(id);
        }
    }
    if exact.len() == 1 {
        return Ok(exact[0]);
    }
    if exact.len() > 1 {
        return Err(format!("有多个同名知识点「{}」", name));
    }
    if fuzzy.len() == 1 && name.chars().count() >= 4 {
        return Ok(fuzzy[0]);
    }
    if fuzzy.len() > 1 {
        return Err(format!("有多个知识点名称包含「{}」", name));
    }
    Err(format!("找不到知识点「{}」", name))
}

#[tauri::command]
pub async fn apply_study_progress(
    subject_id: i64,
    updates: Vec<StudyProgressUpdate>,
) -> Result<StudyGraphPayload, String> {
    if updates.is_empty() {
        return Err("没有要写入的掌握度".to_string());
    }
    if updates.len() > 24 {
        return Err("一次不要超过 24 个知识点".to_string());
    }
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let mut learned = Vec::new();
    let mut reviewed = Vec::new();
    for item in updates {
        let id = resolve_progress_node_id(&conn, subject_id, &item)?;
        let (prev_stage, prev_reviewed, name): (i64, Option<String>, String) = conn
            .query_row(
                "SELECT COALESCE(ForgettingStage, 0), LastReviewedAt, Name FROM StudyGraphNodes WHERE Id = ?",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or((0, None, String::new()));
        let now = Utc::now();
        let quality = parse_study_quality(item.quality.as_deref());
        let had_review = prev_reviewed
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some();
        let remembered = item.remembered.unwrap_or_else(|| {
            if item.quality.as_deref().map(str::trim).filter(|v| !v.is_empty()).is_some() {
                quality != "poor"
            } else {
                item.forgetting_stage
                    .map(|value| clamp_forgetting_stage(value) >= prev_stage)
                    .unwrap_or(true)
            }
        });
        let stage = next_forgetting_stage(
            prev_stage,
            prev_reviewed.as_deref(),
            remembered,
            &now.to_rfc3339(),
        );
        let historical = item.days_ago.filter(|days| *days > 0.05);
        let reviewed_at = item
            .last_reviewed_at
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                if item.quality.is_none() {
                    historical.map(|days| {
                        (now - Duration::milliseconds((days * 86_400_000.0).round() as i64))
                            .to_rfc3339()
                    })
                } else {
                    None
                }
            })
            .unwrap_or_else(|| reviewed_at_for_quality(stage, quality, now));
        let child_count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM StudyGraphNodes WHERE ParentId = ?",
                [id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if child_count > 0 {
            continue;
        }
        let mastery = item
            .mastery
            .map(clamp_mastery)
            .unwrap_or_else(|| mastery_for_stage(stage, Some(reviewed_at.as_str())));
        conn.execute(
            "UPDATE StudyGraphNodes
             SET Mastery = ?, ForgettingStage = ?, LastReviewedAt = ?
             WHERE Id = ?",
            rusqlite::params![mastery, stage, reviewed_at, id],
        )
        .map_err(|e| format!("{}", e))?;
        if name.is_empty() {
            continue;
        }
        let kind = item
            .kind
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .to_ascii_lowercase();
        if kind == "learn" || (!had_review && prev_stage <= 0) {
            learned.push(name);
        } else {
            reviewed.push(name);
        }
    }
    let learned = collapse_activity_names_to_parents(&conn, subject_id, &learned)?;
    let reviewed = collapse_activity_names_to_parents(&conn, subject_id, &reviewed)?;
    insert_study_activity(&conn, subject_id, "learn", &learned, 0, 0, None)?;
    insert_study_activity(&conn, subject_id, "review", &reviewed, 0, 0, None)?;
    load_study_graph(&conn, subject_id)
}

fn collapse_activity_names_to_parents(
    conn: &Connection,
    subject_id: i64,
    names: &[String],
) -> Result<Vec<String>, String> {
    if names.len() < 2 {
        return Ok(names.to_vec());
    }
    let mut stmt = conn
        .prepare("SELECT Id, Name, ParentId FROM StudyGraphNodes WHERE SubjectId = ?")
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    let mut name_of = HashMap::new();
    let mut children: HashMap<i64, Vec<String>> = HashMap::new();
    for row in rows {
        let (id, name, parent_id) = row.map_err(|e| format!("{}", e))?;
        let name = name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        name_of.insert(id, name.clone());
        if let Some(parent_id) = parent_id {
            children.entry(parent_id).or_default().push(name);
        }
    }
    let mut current: HashSet<String> = names
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    let mut changed = true;
    while changed {
        changed = false;
        for (parent_id, kids) in &children {
            let parent_name = match name_of.get(parent_id) {
                Some(name) if !name.is_empty() => name,
                _ => continue,
            };
            if kids.is_empty() || kids.iter().any(|kid| kid == parent_name) {
                continue;
            }
            if !kids.iter().all(|kid| current.contains(kid)) {
                continue;
            }
            for kid in kids {
                current.remove(kid);
            }
            current.insert(parent_name.clone());
            changed = true;
        }
    }
    let mut ordered = Vec::new();
    for item in names {
        let name = item.trim();
        if current.remove(name) {
            ordered.push(name.to_string());
        }
    }
    ordered.extend(current);
    Ok(ordered)
}

fn insert_study_activity(
    conn: &Connection,
    subject_id: i64,
    kind: &str,
    names: &[String],
    question_count: i64,
    correct_count: i64,
    create_time: Option<&str>,
) -> Result<(), String> {
    if kind != "practice" && names.is_empty() {
        return Ok(());
    }
    let payload = serde_json::to_string(names).unwrap_or_else(|_| "[]".to_string());
    let time = create_time
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    conn.execute(
        "INSERT INTO StudyActivity (SubjectId, Kind, Names, QuestionCount, CorrectCount, CreateTime)
         VALUES (?, ?, ?, ?, ?, ?)",
        rusqlite::params![subject_id, kind, payload, question_count, correct_count, time],
    )
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

fn record_practice_activity(conn: &Connection, question_id: i64, is_correct: bool) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT n.SubjectId, n.Name
             FROM QuestionKnowledgeNodes qkn
             JOIN StudyGraphNodes n ON n.Id = qkn.NodeId
             WHERE qkn.QuestionId = ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([question_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("{}", e))?;
    let mut by_subject: HashMap<i64, Vec<String>> = HashMap::new();
    for row in rows {
        let (subject_id, name) = row.map_err(|e| format!("{}", e))?;
        if !name.trim().is_empty() {
            by_subject.entry(subject_id).or_default().push(name);
        } else {
            by_subject.entry(subject_id).or_default();
        }
    }
    for (subject_id, names) in by_subject {
        insert_study_activity(
            conn,
            subject_id,
            "practice",
            &names,
            1,
            if is_correct { 1 } else { 0 },
            None,
        )?;
    }
    Ok(())
}

fn parse_activity_names(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_else(|_| {
        raw.split('、')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect()
    })
}

fn map_activity_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StudyActivity> {
    let raw: String = row.get(3)?;
    Ok(StudyActivity {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        kind: row.get(2)?,
        names: parse_activity_names(&raw),
        question_count: row.get(4)?,
        correct_count: row.get(5)?,
        create_time: row.get(6)?,
    })
}

fn backfill_study_activity(conn: &Connection, subject_id: i64) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM StudyActivity WHERE SubjectId = ?",
            [subject_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if count > 0 {
        return Ok(());
    }
    let mut nodes = conn
        .prepare(
            "SELECT Name, COALESCE(ForgettingStage, 0), LastReviewedAt
             FROM StudyGraphNodes
             WHERE SubjectId = ? AND LastReviewedAt IS NOT NULL AND TRIM(LastReviewedAt) != ''
             AND Id NOT IN (SELECT ParentId FROM StudyGraphNodes WHERE SubjectId = ? AND ParentId IS NOT NULL)",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = nodes
        .query_map(rusqlite::params![subject_id, subject_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    for row in rows {
        let (name, stage, reviewed) = row.map_err(|e| format!("{}", e))?;
        let kind = if stage <= 1 { "learn" } else { "review" };
        insert_study_activity(conn, subject_id, kind, &[name], 0, 0, Some(reviewed.as_str()))?;
    }
    let mut practice = conn
        .prepare(
            "SELECT p.IsCorrect, p.CreateTime, n.Name
             FROM QuestionPracticeHistory p
             JOIN QuestionKnowledgeNodes qkn ON qkn.QuestionId = p.QuestionId
             JOIN StudyGraphNodes n ON n.Id = qkn.NodeId
             WHERE n.SubjectId = ?
             ORDER BY p.Id",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = practice
        .query_map([subject_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    for row in rows {
        let (correct, time, name) = row.map_err(|e| format!("{}", e))?;
        insert_study_activity(
            conn,
            subject_id,
            "practice",
            &[name],
            1,
            if correct != 0 { 1 } else { 0 },
            Some(time.as_str()),
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_study_activity(subject_id: i64, limit: Option<i64>) -> Result<Vec<StudyActivity>, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    backfill_study_activity(&conn, subject_id)?;
    let cap = limit.unwrap_or(80).clamp(1, 5000);
    let mut stmt = conn
        .prepare(
            "SELECT Id, SubjectId, Kind, Names, QuestionCount, CorrectCount, CreateTime
             FROM StudyActivity
             WHERE SubjectId = ?
             ORDER BY datetime(CreateTime) DESC, Id DESC
             LIMIT ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![subject_id, cap], map_activity_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

fn activity_time_ms(raw: &str) -> Option<i64> {
    parse_reviewed_at(raw).map(|value| value.timestamp_millis())
}

#[tauri::command]
pub async fn list_study_activity_between(
    subject_id: i64,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<StudyActivity>, String> {
    if start_ms >= end_ms {
        return Ok(Vec::new());
    }
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let pad_start = start_ms.saturating_sub(86_400_000);
    let pad_end = end_ms.saturating_add(86_400_000);
    let from = DateTime::from_timestamp_millis(pad_start)
        .unwrap_or_else(Utc::now)
        .format("%Y-%m-%d")
        .to_string();
    let to = DateTime::from_timestamp_millis(pad_end)
        .unwrap_or_else(Utc::now)
        .format("%Y-%m-%d")
        .to_string();
    let mut stmt = conn
        .prepare(
            "SELECT Id, SubjectId, Kind, Names, QuestionCount, CorrectCount, CreateTime
             FROM StudyActivity
             WHERE SubjectId = ?
               AND substr(CreateTime, 1, 10) >= ?
               AND substr(CreateTime, 1, 10) <= ?
             ORDER BY datetime(CreateTime) DESC, Id DESC",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![subject_id, from, to], map_activity_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        let item = row.map_err(|e| format!("{}", e))?;
        let Some(ms) = activity_time_ms(&item.create_time) else {
            continue;
        };
        if ms >= start_ms && ms < end_ms {
            items.push(item);
        }
    }
    Ok(items)
}

#[tauri::command]
pub async fn list_study_heatmap(subject_id: i64) -> Result<Vec<StudyHeatmapPoint>, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    backfill_study_activity(&conn, subject_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT Names, CreateTime
             FROM StudyActivity
             WHERE SubjectId = ?
               AND Kind IN ('learn', 'review')
             ORDER BY datetime(CreateTime) DESC
             LIMIT 8000",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            let raw: String = row.get(0)?;
            Ok(StudyHeatmapPoint {
                names: parse_activity_names(&raw),
                create_time: row.get(1)?,
            })
        })
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

fn delete_knowledge_links_for_subject(conn: &Connection, subject_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM QuestionKnowledgeNodes WHERE NodeId IN (SELECT Id FROM StudyGraphNodes WHERE SubjectId = ?)",
        [subject_id],
    )
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

fn collect_node_subtree(conn: &Connection, subject_id: i64, roots: &[i64]) -> Result<HashSet<i64>, String> {
    let mut stmt = conn
        .prepare("SELECT Id, ParentId FROM StudyGraphNodes WHERE SubjectId = ?")
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?))
        })
        .map_err(|e| format!("{}", e))?;
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut ids = HashSet::new();
    for row in rows {
        let (id, parent) = row.map_err(|e| format!("{}", e))?;
        ids.insert(id);
        if let Some(parent_id) = parent {
            children.entry(parent_id).or_default().push(id);
        }
    }
    let mut set = HashSet::new();
    let mut stack: Vec<i64> = roots.iter().copied().filter(|id| ids.contains(id)).collect();
    while let Some(id) = stack.pop() {
        if set.insert(id) {
            if let Some(kids) = children.get(&id) {
                stack.extend(kids.iter().copied());
            }
        }
    }
    Ok(set)
}

fn unique_node_key(conn: &Connection, subject_id: i64, base: &str) -> Result<String, String> {
    let mut key = base.trim().to_string();
    if key.is_empty() {
        key = "n".to_string();
    }
    let mut suffix = 2;
    loop {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM StudyGraphNodes WHERE SubjectId = ? AND NodeKey = ?",
                rusqlite::params![subject_id, key],
                |row| row.get(0),
            )
            .map_err(|e| format!("{}", e))?;
        if exists == 0 {
            return Ok(key);
        }
        key = format!("{}_{}", base, suffix);
        suffix += 1;
    }
}

fn move_nodes_to_subject(
    conn: &Connection,
    from_subject: i64,
    to_subject: i64,
    node_ids: &HashSet<i64>,
) -> Result<i64, String> {
    if node_ids.is_empty() {
        return Ok(0);
    }
    let placeholders = node_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut params: Vec<i64> = vec![from_subject];
    params.extend(node_ids.iter().copied());
    let mut stmt = conn
        .prepare(&format!(
            "SELECT Id, NodeKey, ParentId FROM StudyGraphNodes WHERE SubjectId = ? AND Id IN ({placeholders})"
        ))
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    let mut moved = 0i64;
    for row in rows {
        let (id, key, parent) = row.map_err(|e| format!("{}", e))?;
        let next_key = unique_node_key(conn, to_subject, &key)?;
        let next_parent = parent.filter(|value| node_ids.contains(value));
        conn.execute(
            "UPDATE StudyGraphNodes SET SubjectId = ?, NodeKey = ?, ParentId = ? WHERE Id = ?",
            rusqlite::params![to_subject, next_key, next_parent, id],
        )
        .map_err(|e| format!("{}", e))?;
        moved += 1;
    }
    let mut edge_stmt = conn
        .prepare("SELECT Id, FromId, ToId FROM StudyGraphEdges WHERE SubjectId = ?")
        .map_err(|e| format!("{}", e))?;
    let edges = edge_stmt
        .query_map([from_subject], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })
        .map_err(|e| format!("{}", e))?;
    let mut drop_ids = Vec::new();
    let mut keep_ids = Vec::new();
    for row in edges {
        let (id, from, to) = row.map_err(|e| format!("{}", e))?;
        let from_moved = node_ids.contains(&from);
        let to_moved = node_ids.contains(&to);
        if from_moved && to_moved {
            keep_ids.push(id);
        } else if from_moved || to_moved {
            drop_ids.push(id);
        }
    }
    drop(edge_stmt);
    for id in drop_ids {
        conn.execute("DELETE FROM StudyGraphEdges WHERE Id = ?", [id])
            .map_err(|e| format!("{}", e))?;
    }
    for id in keep_ids {
        conn.execute(
            "UPDATE StudyGraphEdges SET SubjectId = ? WHERE Id = ?",
            rusqlite::params![to_subject, id],
        )
        .map_err(|e| format!("{}", e))?;
    }
    Ok(moved)
}

#[tauri::command]
pub async fn link_questions_to_node(question_ids: Vec<i64>, node_id: i64) -> Result<i64, String> {
    let conn = get_conn()?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM StudyGraphNodes WHERE Id = ?",
            [node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("{}", e))?;
    if exists == 0 {
        return Err("知识点不存在".to_string());
    }
    let mut linked = 0i64;
    for question_id in question_ids {
        if question_id <= 0 {
            continue;
        }
        conn.execute(
            "INSERT OR IGNORE INTO QuestionKnowledgeNodes (QuestionId, NodeId) VALUES (?, ?)",
            rusqlite::params![question_id, node_id],
        )
        .map_err(|e| format!("{}", e))?;
        linked += 1;
    }
    Ok(linked)
}

#[tauri::command]
pub async fn unlink_question_knowledge(question_id: i64, node_id: Option<i64>) -> Result<(), String> {
    let conn = get_conn()?;
    if let Some(node_id) = node_id {
        conn.execute(
            "DELETE FROM QuestionKnowledgeNodes WHERE QuestionId = ? AND NodeId = ?",
            rusqlite::params![question_id, node_id],
        )
        .map_err(|e| format!("{}", e))?;
    } else {
        conn.execute(
            "DELETE FROM QuestionKnowledgeNodes WHERE QuestionId = ?",
            [question_id],
        )
        .map_err(|e| format!("{}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_question_knowledge(question_ids: Vec<i64>) -> Result<Vec<QuestionKnowledgeLink>, String> {
    if question_ids.is_empty() {
        return Ok(vec![]);
    }
    let conn = get_conn()?;
    let placeholders = question_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut stmt = conn
        .prepare(&format!(
            "SELECT q.QuestionId, q.NodeId, n.Name, n.SubjectId, s.Name
             FROM QuestionKnowledgeNodes q
             JOIN StudyGraphNodes n ON n.Id = q.NodeId
             JOIN StudySubjects s ON s.Id = n.SubjectId
             WHERE q.QuestionId IN ({placeholders})"
        ))
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(question_ids.iter()), |row| {
            Ok(QuestionKnowledgeLink {
                question_id: row.get(0)?,
                node_id: row.get(1)?,
                node_name: row.get(2)?,
                subject_id: row.get(3)?,
                subject_name: row.get(4)?,
            })
        })
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

#[tauri::command]
pub async fn list_node_questions(node_id: i64) -> Result<Vec<i64>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE subtree(Id) AS (
                SELECT Id FROM StudyGraphNodes WHERE Id = ?
                UNION ALL
                SELECT n.Id
                FROM StudyGraphNodes n
                JOIN subtree s ON n.ParentId = s.Id
                WHERE n.Id != s.Id
            )
            SELECT DISTINCT q.QuestionId
            FROM QuestionKnowledgeNodes q
            JOIN subtree s ON s.Id = q.NodeId
            ORDER BY q.QuestionId",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([node_id], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("{}", e))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(ids)
}

#[tauri::command]
pub async fn list_subject_questions(subject_id: i64) -> Result<Vec<i64>, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT q.QuestionId
             FROM QuestionKnowledgeNodes q
             JOIN StudyGraphNodes n ON n.Id = q.NodeId
             WHERE n.SubjectId = ?
             ORDER BY q.QuestionId DESC",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("{}", e))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(ids)
}

#[tauri::command]
pub async fn merge_study_subjects(target_id: i64, source_ids: Vec<i64>) -> Result<StudySubject, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, target_id)?;
    let mut sources = Vec::new();
    for id in source_ids {
        if id == target_id {
            continue;
        }
        load_study_subject(&conn, id)?;
        sources.push(id);
    }
    if sources.is_empty() {
        return Err("请提供要合并进来的其他科目".to_string());
    }
    for source_id in sources {
        let source = load_study_subject(&conn, source_id)?;
        let mut stmt = conn
            .prepare("SELECT Id FROM StudyGraphNodes WHERE SubjectId = ?")
            .map_err(|e| format!("{}", e))?;
        let ids = stmt
            .query_map([source_id], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("{}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("{}", e))?;
        let set: HashSet<i64> = ids.into_iter().collect();
        if !set.is_empty() {
            move_nodes_to_subject(&conn, source_id, target_id, &set)?;
            let wrapper_key = unique_node_key(&conn, target_id, &format!("merged_{}", source_id))?;
            let max_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(SortOrder), 0) FROM StudyGraphNodes WHERE SubjectId = ?",
                    [target_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO StudyGraphNodes (SubjectId, NodeKey, Name, Summary, Mastery, ParentId, SortOrder, ForgettingStage, LastReviewedAt)
                 VALUES (?, ?, ?, ?, 0, NULL, ?, 0, NULL)",
                rusqlite::params![target_id, wrapper_key, source.name, source.description, max_order + 1],
            )
            .map_err(|e| format!("{}", e))?;
            let wrapper_id = conn.last_insert_rowid();
            for id in &set {
                conn.execute(
                    "UPDATE StudyGraphNodes SET ParentId = ? WHERE Id = ? AND ParentId IS NULL",
                    rusqlite::params![wrapper_id, id],
                )
                .map_err(|e| format!("{}", e))?;
            }
        }
        conn.execute("DELETE FROM StudyGraphEdges WHERE SubjectId = ?", [source_id])
            .map_err(|e| format!("{}", e))?;
        conn.execute("DELETE FROM StudySubjects WHERE Id = ?", [source_id])
            .map_err(|e| format!("{}", e))?;
    }
    load_study_subject(&conn, target_id)
}

#[tauri::command]
pub async fn split_study_subject(
    subject_id: i64,
    parts: Vec<SplitSubjectPart>,
) -> Result<SplitSubjectResult, String> {
    if parts.is_empty() {
        return Err("请至少指定一个拆出的科目".to_string());
    }
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let mut created = Vec::new();
    for part in parts {
        let name = part.name.trim().to_string();
        if name.is_empty() || part.node_ids.is_empty() {
            continue;
        }
        let moved = collect_node_subtree(&conn, subject_id, &part.node_ids)?;
        if moved.is_empty() {
            continue;
        }
        let next = create_study_subject_inner(
            &conn,
            &name,
            part.description.as_deref().unwrap_or(""),
        )?;
        move_nodes_to_subject(&conn, subject_id, next.id, &moved)?;
        created.push(load_study_subject(&conn, next.id)?);
    }
    if created.is_empty() {
        return Err("没有可拆出的知识点".to_string());
    }
    Ok(SplitSubjectResult {
        original: load_study_subject(&conn, subject_id)?,
        created,
    })
}

fn create_study_subject_inner(
    conn: &Connection,
    name: &str,
    description: &str,
) -> Result<StudySubject, String> {
    conn.execute(
        "INSERT INTO StudySubjects (Name, Description, CreateTime) VALUES (?, ?, datetime('now'))",
        rusqlite::params![name, description],
    )
    .map_err(|e| format!("{}", e))?;
    load_study_subject(conn, conn.last_insert_rowid())
}

#[tauri::command]
pub async fn delete_question(id: i64) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM QuestionKnowledgeNodes WHERE QuestionId = ?", [id])
        .map_err(|e| format!("{}", e))?;
    conn.execute("DELETE FROM QuestionPracticeHistory WHERE QuestionId = ?", [id])
        .map_err(|e| format!("{}", e))?;
    conn.execute("DELETE FROM AIResponses WHERE Id = ?", [id])
        .map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_questions(ids: Vec<i64>) -> Result<(), String> {
    let conn = get_conn()?;
    for id in ids {
        conn.execute("DELETE FROM QuestionKnowledgeNodes WHERE QuestionId = ?", [id])
            .map_err(|e| format!("{}", e))?;
        conn.execute("DELETE FROM QuestionPracticeHistory WHERE QuestionId = ?", [id])
            .map_err(|e| format!("{}", e))?;
        conn.execute("DELETE FROM AIResponses WHERE Id = ?", [id])
            .map_err(|e| format!("{}", e))?;
    }
    Ok(())
}

/// 收集某文件夹及其真实子树（排除 ParentId=自身 的自环，避免默认文件夹 Id=ParentId=0 死循环）
fn collect_folder_subtree_ids(conn: &Connection, id: i64) -> Result<Vec<i64>, String> {
    // 默认文件夹：ParentId=0 表示根，不是「自己的子文件夹」；只清自身
    if id == 0 {
        return Ok(vec![0]);
    }

    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE folder_tree AS (
          SELECT Id FROM Folders WHERE Id = ?
          UNION ALL
          SELECT f.Id FROM Folders f
          INNER JOIN folder_tree ft ON f.ParentId = ft.Id
          WHERE f.Id != ft.Id AND f.Id != 0
        )
        SELECT Id FROM folder_tree",
        )
        .map_err(|e| format!("{}", e))?;

    let folder_ids_iter = stmt
        .query_map([id], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("{}", e))?;

    let mut folder_ids = Vec::new();
    for fid in folder_ids_iter {
        folder_ids.push(fid.map_err(|e| format!("{}", e))?);
    }

    if folder_ids.is_empty() {
        folder_ids.push(id);
    }
    Ok(folder_ids)
}

#[tauri::command]
pub async fn clear_folder_questions(id: i64) -> Result<(), String> {
    let conn = get_conn()?;
    let folder_ids = collect_folder_subtree_ids(&conn, id)?;

    for fid in &folder_ids {
        conn.execute(
            "DELETE FROM QuestionKnowledgeNodes WHERE QuestionId IN (SELECT Id FROM AIResponses WHERE FolderId = ?)",
            [fid],
        )
        .map_err(|e| format!("{}", e))?;
        conn.execute("DELETE FROM AIResponses WHERE FolderId = ?", [fid])
            .map_err(|e| format!("{}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_folder(id: i64, delete_questions: bool) -> Result<(), String> {
    let conn = get_conn()?;

    if id == 0 {
        return Err("默认文件夹不能被删除".to_string());
    }

    let folder_ids = collect_folder_subtree_ids(&conn, id)?;

    if delete_questions {
        // 删除所有这些文件夹中的题目
        for fid in &folder_ids {
            conn.execute(
                "DELETE FROM QuestionKnowledgeNodes WHERE QuestionId IN (SELECT Id FROM AIResponses WHERE FolderId = ?)",
                [fid],
            )
            .map_err(|e| format!("{}", e))?;
            conn.execute("DELETE FROM AIResponses WHERE FolderId = ?", [fid])
                .map_err(|e| format!("{}", e))?;
        }
    } else {
        // 将题目移到父文件夹或默认文件夹 (0)
        let parent_id: i64 = conn
            .query_row("SELECT ParentId FROM Folders WHERE Id = ?", [id], |row| {
                row.get(0)
            })
            .unwrap_or(0);

        for fid in &folder_ids {
            conn.execute(
                "UPDATE AIResponses SET FolderId = ? WHERE FolderId = ?",
                [parent_id, *fid],
            )
            .map_err(|e| format!("{}", e))?;
        }
    }

    // 删除所有文件夹
    for fid in &folder_ids {
        conn.execute("DELETE FROM Folders WHERE Id = ?", [fid])
            .map_err(|e| format!("{}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn rename_folder(id: i64, new_name: String) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute(
        "UPDATE Folders SET Name = ? WHERE Id = ?",
        rusqlite::params![new_name, id],
    )
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn move_folder(id: i64, parent_id: i64) -> Result<(), String> {
    let conn = get_conn()?;
    if id == 0 {
        return Err("默认文件夹不能移动".to_string());
    }
    if id == parent_id {
        return Err("Cannot move folder to itself".to_string());
    }

    // 禁止把目标挂到自己的子孙下面，避免 ParentId 成环
    if parent_id != 0 {
        let would_cycle: bool = conn
            .query_row(
                "WITH RECURSIVE ancestors AS (
                   SELECT Id, ParentId, 0 as level FROM Folders WHERE Id = ?
                   UNION ALL
                   SELECT f.Id, f.ParentId, a.level + 1
                   FROM Folders f
                   INNER JOIN ancestors a ON f.Id = a.ParentId
                   WHERE f.Id != a.Id AND a.Id != 0 AND a.level < 32
                 )
                 SELECT EXISTS(SELECT 1 FROM ancestors WHERE Id = ?)",
                rusqlite::params![parent_id, id],
                |row| row.get(0),
            )
            .map_err(|e| format!("{}", e))?;
        if would_cycle {
            return Err("不能将文件夹移动到自己的子文件夹中".to_string());
        }
    }

    conn.execute(
        "UPDATE Folders SET ParentId = ? WHERE Id = ?",
        [parent_id, id],
    )
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn add_folder(name: String, parent_id: i64) -> Result<i64, String> {
    let conn = get_conn()?;
    conn.execute(
        "INSERT INTO Folders (Name, ParentId, CreateTime) VALUES (?, ?, datetime('now'))",
        rusqlite::params![name, parent_id],
    )
    .map_err(|e| format!("{}", e))?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn search_questions_fuzzy(
    keyword: String,
    folder_id: Option<i64>,
) -> Result<Vec<AIResponse>, String> {
    let db_path = get_db_path();
    let keyword_clone = keyword.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<Vec<AIResponse>, String> {
        let conn = Connection::open(&db_path).map_err(|e| format!("{}", e))?;

        // 1. 获取候选题目（根据文件夹过滤）
        let query = if let Some(fid) = folder_id {
            if fid == 0 {
                // 默认文件夹仅显示自身题目
                "SELECT
                  ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType,
                  ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
                FROM AIResponses ar
                INNER JOIN Folders f ON ar.FolderId = f.Id
                WHERE ar.FolderId = 0"
            } else {
                // 指定文件夹及其子文件夹
                "WITH RECURSIVE folder_tree AS (
                  SELECT Id, Name, ParentId FROM Folders WHERE Id = ?
                  UNION ALL
                  SELECT f.Id, f.Name, f.ParentId FROM Folders f
                  INNER JOIN folder_tree ft ON f.ParentId = ft.Id
                )
                SELECT
                  ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType,
                  ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
                FROM AIResponses ar
                INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
                INNER JOIN Folders f ON ar.FolderId = f.Id"
            }
        } else {
            // 所有文件夹
            "SELECT
              ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType,
              ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0), COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
            FROM AIResponses ar
            LEFT JOIN Folders f ON ar.FolderId = f.Id"
        };

        let mut stmt = conn.prepare(query).map_err(|e| format!("{}", e))?;

        let params_vec: Vec<&dyn rusqlite::ToSql> = if let Some(ref fid) = folder_id {
            if *fid == 0 {
                vec![]
            } else {
                vec![fid]
            }
        } else {
            vec![]
        };
        let params = params_vec.as_slice();

        let rows = stmt
            .query_map(params, map_ai_response_row)
            .map_err(|e| format!("{}", e))?;

        let mut results = Vec::new();
        let keyword_lower = keyword_clone.to_lowercase();
        let keywords: Vec<&str> = keyword_lower.split_whitespace().collect();

        if keywords.is_empty() {
            // 如果关键词为空，返回所有结果
            for row in rows {
                if let Ok(item) = row {
                    results.push((item, 1.0));
                }
            }
        } else {
            for row in rows {
                if let Ok(item) = row {
                    let q_lower = item.question.to_lowercase();
                    let a_lower = item.answer.clone().unwrap_or_default().to_lowercase();
                    let o_lower = item.options.clone().unwrap_or_default().to_lowercase();

                    let mut all_terms_matched = true;

                    for term in &keywords {
                        let mut term_matched = false;
                        if q_lower.contains(term)
                            || a_lower.contains(term)
                            || o_lower.contains(term)
                        {
                            term_matched = true;
                        }
                        if !term_matched {
                            all_terms_matched = false;
                            break;
                        }
                    }

                    if all_terms_matched {
                        results.push((item, 1.0));
                    }
                }
            }
        }

        // 按分数降序排序，分数相同按时间倒序
        results.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.0.create_time.cmp(&a.0.create_time))
        });

        Ok(results.into_iter().map(|(item, _)| item).collect())
    })
    .await
    .map_err(|e| format!("{}", e))??;

    Ok(result)
}

#[derive(Debug, Clone)]
pub struct QuestionMatch {
    pub id: i64,
    pub question: String,
    pub options: Option<String>,
    pub answer: String,
    pub is_ai: bool,
    pub is_pending_correction: bool,
    pub score: f64,
}

fn score_question_row(
    title: &str,
    query_options: &Option<String>,
    require_option_match: bool,
    id: i64,
    question: String,
    db_options: Option<String>,
    answer: String,
    is_ai: bool,
    is_pending_correction: bool,
) -> Option<QuestionMatch> {
    let query_urls = extract_urls(title);
    if !query_urls.is_empty() {
        let db_urls = extract_urls(&question);
        if query_urls != db_urls {
            return None;
        }
    }

    let title_similarity = compute_query_match_score(title, &question)?;

    let has_query_options = query_options.is_some();
    let option_similarity = match (
        query_options.as_deref(),
        normalize_optional_query_text(db_options.as_deref()),
    ) {
        (Some(query_options), Some(db_options)) => {
            compute_query_match_score(query_options, &db_options)
        }
        _ => None,
    };

    let is_exact_title_match = is_exact_match_score(title_similarity);
    if !is_exact_title_match
        && (require_option_match || has_query_options)
        && option_similarity.is_none()
    {
        return None;
    }

    let final_similarity = match option_similarity {
        Some(option_similarity) => title_similarity * 0.7 + option_similarity * 0.3,
        None => title_similarity,
    };

    Some(QuestionMatch {
        id,
        question,
        options: db_options,
        answer,
        is_ai,
        is_pending_correction,
        score: final_similarity,
    })
}

fn is_exact_question_match(
    title: &str,
    query_options: Option<&str>,
    matched: &QuestionMatch,
) -> bool {
    let Some(title_score) = compute_query_match_score(title, &matched.question) else {
        return false;
    };
    if !is_exact_match_score(title_score) {
        return false;
    }

    match normalize_optional_query_text(query_options) {
        None => true,
        Some(query_opts) => match normalize_optional_query_text(matched.options.as_deref()) {
            Some(db_opts) => compute_query_match_score(&query_opts, &db_opts)
                .map(is_exact_match_score)
                .unwrap_or(false),
            None => false,
        },
    }
}

fn scan_question_matches(
    title: &str,
    options: Option<&str>,
) -> Result<Vec<QuestionMatch>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = get_db_path();
    let title_clone = title.to_string();
    let query_options = normalize_optional_query_text(options);
    let require_option_match = should_require_option_match(&title_clone);

    let conn = Connection::open(&db_path)?;
    let mut stmt = conn.prepare(
        "SELECT Id, Question, Options, Answer, IsAi, COALESCE(IsPendingCorrection, 0) FROM AIResponses",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, bool>(4)?,
            row.get::<_, bool>(5)?,
        ))
    })?;

    let mut results = Vec::new();
    for row in rows {
        let (id, question, db_options, answer, is_ai, is_pending_correction) = row?;
        if let Some(matched) = score_question_row(
            &title_clone,
            &query_options,
            require_option_match,
            id,
            question,
            db_options,
            answer,
            is_ai,
            is_pending_correction,
        ) {
            results.push(matched);
        }
    }

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    Ok(results)
}

/// 仅返回题干（及有选项时的选项）规范化后 100% 相同的记录
pub async fn query_database_exact(
    title: &str,
    options: Option<&str>,
) -> Result<Vec<QuestionMatch>, Box<dyn std::error::Error + Send + Sync>> {
    let title = title.to_string();
    let options = options.map(|s| s.to_string());

    let result = tokio::task::spawn_blocking(
        move || -> Result<Vec<QuestionMatch>, Box<dyn std::error::Error + Send + Sync>> {
            let matches = scan_question_matches(&title, options.as_deref())?;
            Ok(matches
                .into_iter()
                .filter(|m| is_exact_question_match(&title, options.as_deref(), m))
                .collect())
        },
    )
    .await?;

    result
}

/// 模糊候选，供 AI 同题判断（排除精确命中，最多 Top N）
pub async fn query_database_candidates(
    title: &str,
    options: Option<&str>,
    limit: usize,
) -> Result<Vec<QuestionMatch>, Box<dyn std::error::Error + Send + Sync>> {
    let title = title.to_string();
    let options = options.map(|s| s.to_string());

    let result = tokio::task::spawn_blocking(
        move || -> Result<Vec<QuestionMatch>, Box<dyn std::error::Error + Send + Sync>> {
            let matches = scan_question_matches(&title, options.as_deref())?;
            Ok(matches
                .into_iter()
                .filter(|m| !is_exact_question_match(&title, options.as_deref(), m))
                .take(limit)
                .collect())
        },
    )
    .await?;

    result
}

/// 兼容旧调用：返回模糊匹配（含精确），最多 50 条
pub async fn query_database(
    title: &str,
    options: Option<&str>,
) -> Result<Vec<(i64, String, String, bool, bool)>, Box<dyn std::error::Error + Send + Sync>> {
    let title = title.to_string();
    let options = options.map(|s| s.to_string());

    let result = tokio::task::spawn_blocking(
        move || -> Result<Vec<(i64, String, String, bool, bool)>, Box<dyn std::error::Error + Send + Sync>> {
            let matches = scan_question_matches(&title, options.as_deref())?;
            Ok(matches
                .into_iter()
                .take(50)
                .map(|m| (m.id, m.question, m.answer, m.is_ai, m.is_pending_correction))
                .collect())
        },
    )
    .await?;

    result
}

pub fn get_ai_response_by_id(
    id: i64,
) -> Result<QuestionMatch, Box<dyn std::error::Error + Send + Sync>> {
    let conn = get_conn().map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
        Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))
    })?;
    let row = conn.query_row(
        "SELECT Id, Question, Options, Answer, IsAi, COALESCE(IsPendingCorrection, 0) FROM AIResponses WHERE Id = ?",
        [id],
        |row| {
            Ok(QuestionMatch {
                id: row.get(0)?,
                question: row.get(1)?,
                options: row.get(2)?,
                answer: row.get(3)?,
                is_ai: row.get(4)?,
                is_pending_correction: row.get(5)?,
                score: 1.0,
            })
        },
    )?;
    Ok(row)
}

pub fn insert_ai_response(
    question: &str,
    answer: &str,
    options: Option<String>,
    question_type: Option<String>,
    is_ai: bool,
) -> Result<i64, String> {
    if answer.trim().is_empty() {
        return Err("AI处理结果答案为空，不保存题目".to_string());
    }

    let conn = get_conn()?;
    let folder_id = get_configured_save_folder_id(&conn);
    let folder_name: String = conn
        .query_row(
            "SELECT Name FROM Folders WHERE Id = ?",
            [folder_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "默认文件夹".to_string());

    conn.execute(
        "INSERT INTO AIResponses (Question, Answer, Options, QuestionType, IsAi, IsPendingCorrection, CreateTime, FolderId, FolderName) VALUES (?, ?, ?, ?, ?, 0, datetime('now'), ?, ?)",
        rusqlite::params![question, answer, options, question_type, is_ai, folder_id, folder_name],
    ).map_err(|e| format!("{}", e))?;

    Ok(conn.last_insert_rowid())
}

pub fn get_username() -> Result<String, String> {
    if let Ok(userprofile) = env::var("USERPROFILE") {
        if !userprofile.is_empty() {
            let path = std::path::Path::new(&userprofile);
            if let Some(name_os) = path.file_name() {
                let name = name_os.to_string_lossy().into_owned();
                if !name.is_empty() {
                    return Ok(name);
                }
            }
            // 回退：按分隔符截取最后一段
            let extracted = userprofile
                .rsplit(|c| c == '\\' || c == '/')
                .next()
                .unwrap_or(&userprofile);
            if !extracted.is_empty() {
                return Ok(extracted.to_string());
            }
        }
    }
    env::var("USERNAME")
        .or_else(|_| env::var("USER"))
        .map_err(|_| "Unable to get username".to_string())
}

pub fn file_exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

fn get_table_columns(conn: &Connection, table_name: &str) -> Result<HashSet<String>, String> {
    let pragma = format!("PRAGMA table_info('{table_name}')");
    let mut stmt = conn.prepare(&pragma).map_err(|e| format!("{}", e))?;
    let cols = stmt
        .query_map([], |row| Ok(row.get::<_, String>(1)?))
        .map_err(|e| format!("{}", e))?;

    let mut names = HashSet::new();
    for col in cols {
        names.insert(col.map_err(|e| format!("{}", e))?);
    }

    Ok(names)
}

fn ensure_column(
    conn: &Connection,
    table_columns: &mut HashSet<String>,
    column_name: &str,
    alter_sql: &str,
    backfill_sqls: &[&str],
) -> Result<(), String> {
    if table_columns.contains(column_name) {
        return Ok(());
    }

    conn.execute(alter_sql, []).map_err(|e| format!("{}", e))?;
    for sql in backfill_sqls {
        conn.execute(sql, []).map_err(|e| format!("{}", e))?;
    }

    table_columns.insert(column_name.to_string());
    Ok(())
}

pub fn init_database_schema(db_path: &str) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS Folders (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          Name TEXT NOT NULL,
          ParentId INTEGER DEFAULT 0,
          CreateTime DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;

    let mut folder_columns = get_table_columns(&conn, "Folders")?;
    ensure_column(
        &conn,
        &mut folder_columns,
        "ParentId",
        "ALTER TABLE Folders ADD COLUMN ParentId INTEGER DEFAULT 0",
        &["UPDATE Folders SET ParentId = 0 WHERE ParentId IS NULL"],
    )?;
    ensure_column(
        &conn,
        &mut folder_columns,
        "CreateTime",
        "ALTER TABLE Folders ADD COLUMN CreateTime DATETIME",
        &["UPDATE Folders SET CreateTime = datetime('now') WHERE CreateTime IS NULL"],
    )?;

    let exists_default: i64 = conn
        .query_row("SELECT COUNT(1) FROM Folders WHERE Id = 0", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);
    if exists_default == 0 {
        let _ = conn.execute(
            "INSERT INTO Folders (Id, Name, ParentId) VALUES (0, '默认文件夹', 0)",
            [],
        );
    } else {
        // 默认文件夹必须在根上；历史拖拽可能把它挂到其他文件夹下并形成环
        let _ = conn.execute("UPDATE Folders SET ParentId = 0 WHERE Id = 0 AND ParentId != 0", []);
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS AIResponses (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          Question TEXT NOT NULL,
          Options TEXT,
          QuestionType TEXT,
          Answer TEXT NOT NULL,
          CreateTime DATETIME DEFAULT CURRENT_TIMESTAMP,
          FolderId INTEGER DEFAULT 0,
          FolderName TEXT DEFAULT '默认文件夹',
          IsAi BOOLEAN DEFAULT 1,
          IsPendingCorrection BOOLEAN DEFAULT 0
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;

    let mut ai_response_columns = get_table_columns(&conn, "AIResponses")?;
    let had_folder_name = ai_response_columns.contains("FolderName");

    ensure_column(
        &conn,
        &mut ai_response_columns,
        "QuestionType",
        "ALTER TABLE AIResponses ADD COLUMN QuestionType TEXT",
        &[],
    )?;
    ensure_column(
        &conn,
        &mut ai_response_columns,
        "CreateTime",
        "ALTER TABLE AIResponses ADD COLUMN CreateTime DATETIME",
        &["UPDATE AIResponses SET CreateTime = datetime('now') WHERE CreateTime IS NULL"],
    )?;
    ensure_column(
        &conn,
        &mut ai_response_columns,
        "FolderId",
        "ALTER TABLE AIResponses ADD COLUMN FolderId INTEGER DEFAULT 0",
        &["UPDATE AIResponses SET FolderId = 0 WHERE FolderId IS NULL"],
    )?;
    if had_folder_name {
        conn.execute(
            "UPDATE AIResponses
             SET FolderId = COALESCE(
               (
                 SELECT Id
                 FROM Folders
                 WHERE Folders.Name = AIResponses.FolderName
                 ORDER BY CASE WHEN Id = 0 THEN 0 ELSE 1 END, Id
                 LIMIT 1
               ),
               0
             )
             WHERE FolderId IS NULL OR FolderId = 0",
            [],
        )
        .map_err(|e| format!("{}", e))?;
    }
    ensure_column(
        &conn,
        &mut ai_response_columns,
        "FolderName",
        "ALTER TABLE AIResponses ADD COLUMN FolderName TEXT DEFAULT '默认文件夹'",
        &["UPDATE AIResponses SET FolderName = '默认文件夹' WHERE FolderName IS NULL OR trim(FolderName) = ''"],
    )?;
    conn.execute(
        "UPDATE AIResponses
         SET FolderName = COALESCE(
           (SELECT Name FROM Folders WHERE Folders.Id = AIResponses.FolderId),
           '默认文件夹'
         )
         WHERE FolderName IS NULL OR trim(FolderName) = ''",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    ensure_column(
        &conn,
        &mut ai_response_columns,
        "IsAi",
        "ALTER TABLE AIResponses ADD COLUMN IsAi BOOLEAN DEFAULT 1",
        &["UPDATE AIResponses SET IsAi = 1 WHERE IsAi IS NULL"],
    )?;
    ensure_column(
        &conn,
        &mut ai_response_columns,
        "IsPendingCorrection",
        "ALTER TABLE AIResponses ADD COLUMN IsPendingCorrection BOOLEAN DEFAULT 0",
        &["UPDATE AIResponses SET IsPendingCorrection = 0 WHERE IsPendingCorrection IS NULL"],
    )?;
    ensure_column(
        &conn,
        &mut ai_response_columns,
        "Importance",
        "ALTER TABLE AIResponses ADD COLUMN Importance INTEGER DEFAULT 0",
        &["UPDATE AIResponses SET Importance = 0 WHERE Importance IS NULL"],
    )?;
    ensure_column(
        &conn,
        &mut ai_response_columns,
        "Mastery",
        "ALTER TABLE AIResponses ADD COLUMN Mastery INTEGER DEFAULT 0",
        &["UPDATE AIResponses SET Mastery = 0 WHERE Mastery IS NULL"],
    )?;
    ensure_column(
        &conn,
        &mut ai_response_columns,
        "Difficulty",
        "ALTER TABLE AIResponses ADD COLUMN Difficulty INTEGER DEFAULT 0",
        &["UPDATE AIResponses SET Difficulty = 0 WHERE Difficulty IS NULL"],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS QuestionPracticeHistory (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          QuestionId INTEGER NOT NULL,
          UserAnswer TEXT NOT NULL DEFAULT '',
          IsCorrect INTEGER DEFAULT 0,
          Note TEXT DEFAULT '',
          Source TEXT DEFAULT 'agent',
          CreateTime DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_practice_question
         ON QuestionPracticeHistory (QuestionId, Id DESC)",
        [],
    )
    .map_err(|e| format!("{}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS StudySubjects (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          Name TEXT NOT NULL,
          Description TEXT DEFAULT '',
          CreateTime DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS StudyGraphNodes (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          SubjectId INTEGER NOT NULL,
          NodeKey TEXT NOT NULL,
          Name TEXT NOT NULL,
          Summary TEXT DEFAULT '',
          Mastery INTEGER DEFAULT 0,
          ParentId INTEGER,
          SortOrder INTEGER DEFAULT 0,
          ForgettingStage INTEGER DEFAULT 0,
          LastReviewedAt TEXT
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_study_nodes_subject ON StudyGraphNodes (SubjectId, SortOrder, Id)",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    let mut study_node_columns = get_table_columns(&conn, "StudyGraphNodes")?;
    ensure_column(
        &conn,
        &mut study_node_columns,
        "ForgettingStage",
        "ALTER TABLE StudyGraphNodes ADD COLUMN ForgettingStage INTEGER DEFAULT 0",
        &["UPDATE StudyGraphNodes SET ForgettingStage = 0 WHERE ForgettingStage IS NULL"],
    )?;
    ensure_column(
        &conn,
        &mut study_node_columns,
        "LastReviewedAt",
        "ALTER TABLE StudyGraphNodes ADD COLUMN LastReviewedAt TEXT",
        &[],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS StudyGraphEdges (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          SubjectId INTEGER NOT NULL,
          FromId INTEGER NOT NULL,
          ToId INTEGER NOT NULL,
          Relation TEXT DEFAULT ''
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_study_edges_subject ON StudyGraphEdges (SubjectId)",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS QuestionKnowledgeNodes (
          QuestionId INTEGER NOT NULL,
          NodeId INTEGER NOT NULL,
          PRIMARY KEY (QuestionId, NodeId)
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_qkn_node ON QuestionKnowledgeNodes (NodeId)",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS StudyActivity (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          SubjectId INTEGER NOT NULL,
          Kind TEXT NOT NULL,
          Names TEXT DEFAULT '[]',
          QuestionCount INTEGER DEFAULT 0,
          CorrectCount INTEGER DEFAULT 0,
          CreateTime TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_study_activity_subject
         ON StudyActivity (SubjectId, CreateTime DESC, Id DESC)",
        [],
    )
    .map_err(|e| format!("{}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS RequestLogs (
          LogId INTEGER PRIMARY KEY AUTOINCREMENT,
          RequestId TEXT NOT NULL,
          Timestamp TEXT NOT NULL,
          Method TEXT NOT NULL,
          Path TEXT NOT NULL,
          Status INTEGER,
          ResponseTime INTEGER,
          RequestBody TEXT,
          ResponseBody TEXT,
          Headers TEXT,
          Ip TEXT,
          UserAgent TEXT,
          Stage TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_request_logs_request_id ON RequestLogs(RequestId)",
        [],
    )
    .map_err(|e| format!("{}", e))?;

    // 每天请求计数表：仅展存 date + 计数，不保存请求详情
    conn.execute(
        "CREATE TABLE IF NOT EXISTS DailyRequestCounts (
          Day TEXT PRIMARY KEY,
          Count INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        compute_query_match_score, get_table_columns, init_database_schema, is_exact_match_score,
        is_exact_question_match, QuestionMatch,
    };
    use rusqlite::Connection;
    use uuid::Uuid;

    #[test]
    fn rejects_same_template_with_different_entity() {
        assert!(compute_query_match_score("韩国的首都在哪里", "美国的首都在哪里").is_none());
    }

    #[test]
    fn keeps_same_question_with_small_wording_changes() {
        assert!(compute_query_match_score("韩国的首都在哪里", "韩国首都是哪里").is_some());
    }

    #[test]
    fn keeps_exact_match() {
        assert_eq!(
            compute_query_match_score("韩国的首都在哪里", "韩国的首都在哪里"),
            Some(1.0)
        );
    }

    #[test]
    fn exact_match_score_is_detected() {
        assert!(is_exact_match_score(1.0));
        assert!(!is_exact_match_score(0.999));
    }

    #[test]
    fn exact_question_match_requires_identical_options_when_present() {
        let matched = QuestionMatch {
            id: 1,
            question: "下列哪项正确".to_string(),
            options: Some("A.1\nB.2".to_string()),
            answer: "A.1".to_string(),
            is_ai: true,
            is_pending_correction: false,
            score: 1.0,
        };
        assert!(is_exact_question_match(
            "下列哪项正确",
            Some("A.1\nB.2"),
            &matched
        ));
        assert!(!is_exact_question_match(
            "下列哪项正确",
            Some("A.1\nB.3"),
            &matched
        ));
        assert!(is_exact_question_match("下列哪项正确", None, &matched));
    }

    #[test]
    fn migrates_legacy_database_schema() {
        let db_path = std::env::temp_dir().join(format!("zerror-migration-{}.db", Uuid::new_v4()));
        let db_path_str = db_path.to_string_lossy().to_string();

        {
            let conn = Connection::open(&db_path_str).expect("create legacy database");
            conn.execute(
                "CREATE TABLE Folders (
                  Id INTEGER PRIMARY KEY AUTOINCREMENT,
                  Name TEXT NOT NULL
                )",
                [],
            )
            .expect("create legacy folders");
            conn.execute(
                "CREATE TABLE AIResponses (
                  Id INTEGER PRIMARY KEY AUTOINCREMENT,
                  Question TEXT NOT NULL,
                  Options TEXT,
                  Answer TEXT NOT NULL,
                  FolderName TEXT DEFAULT '默认文件夹'
                )",
                [],
            )
            .expect("create legacy ai responses");
            conn.execute("INSERT INTO Folders (Id, Name) VALUES (0, '默认文件夹')", [])
                .expect("insert default folder");
            conn.execute(
                "INSERT INTO AIResponses (Question, Options, Answer, FolderName) VALUES ('题目', NULL, '答案', '默认文件夹')",
                [],
            )
            .expect("insert legacy response");
        }

        init_database_schema(&db_path_str).expect("migrate legacy database");

        let conn = Connection::open(&db_path_str).expect("reopen migrated database");
        let folder_columns = get_table_columns(&conn, "Folders").expect("read folder columns");
        assert!(folder_columns.contains("ParentId"));
        assert!(folder_columns.contains("CreateTime"));

        let response_columns = get_table_columns(&conn, "AIResponses").expect("read ai response columns");
        assert!(response_columns.contains("QuestionType"));
        assert!(response_columns.contains("CreateTime"));
        assert!(response_columns.contains("FolderId"));
        assert!(response_columns.contains("FolderName"));
        assert!(response_columns.contains("IsAi"));
        assert!(response_columns.contains("IsPendingCorrection"));

        let (folder_id, folder_name, is_ai, is_pending): (i64, String, i64, i64) = conn
            .query_row(
                "SELECT FolderId, FolderName, IsAi, IsPendingCorrection FROM AIResponses LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("query migrated values");
        assert_eq!(folder_id, 0);
        assert_eq!(folder_name, "默认文件夹");
        assert_eq!(is_ai, 1);
        assert_eq!(is_pending, 0);

        let _ = std::fs::remove_file(&db_path_str);
    }
}
