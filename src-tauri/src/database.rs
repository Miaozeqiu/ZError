use jieba_rs::Jieba;
use regex::Regex;
use rusqlite::{Connection, OptionalExtension};
use crate::logger::RequestLog;
use chrono::{DateTime, Utc};
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

    let mut compact_keywords: Vec<String> = Vec::new();
    for token in keywords {
        if compact_keywords
            .iter()
            .any(|existing| existing == &token || existing.contains(&token))
        {
            continue;
        }
        compact_keywords.push(token);
    }

    compact_keywords.into_iter().collect()
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
    let min_coverage = if query_keywords.len() <= 2 { 1.0 } else { 0.75 };
    if coverage + f64::EPSILON < min_coverage {
        return None;
    }

    Some(char_similarity * 0.7 + coverage * 0.3)
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
pub struct FolderPathItem {
    pub id: i64,
    pub name: String,
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
        "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
         FROM AIResponses ar
         LEFT JOIN Folders f ON ar.FolderId = f.Id
         WHERE ar.FolderId = ?
         ORDER BY ar.CreateTime DESC"
    } else {
        "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
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
pub async fn get_questions_recursive(folder_id: i64) -> Result<Vec<AIResponse>, String> {
    let conn = get_conn()?;

    let query = if folder_id == 0 {
        "SELECT
          ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType,
          ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
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
          ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
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
            "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
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
) -> Result<AIResponse, String> {
    let conn = get_conn()?;
    let is_ai = is_ai.unwrap_or(false);

    if is_ai && answer.trim().is_empty() {
        return Err("AI处理结果答案为空，不保存题目".to_string());
    }

    let target_folder_id = get_target_folder_id(&conn, folder_id).map_err(|e| format!("{}", e))?;

    conn.execute(
        "INSERT INTO AIResponses (Question, Options, Answer, QuestionType, FolderId, IsAi, CreateTime)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        rusqlite::params![content, options, answer, question_type, target_folder_id, is_ai],
    ).map_err(|e| format!("{}", e))?;

    let id = conn.last_insert_rowid();

    // 获取完整的插入数据返回
    let response = conn.query_row(
        "SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
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
) -> Result<(), String> {
    let conn = get_conn()?;
    let mut has_updates = false;

    if let Some(q) = question {
        conn.execute(
            "UPDATE AIResponses SET Question = ? WHERE Id = ?",
            rusqlite::params![q, id],
        )
        .map_err(|e| format!("{}", e))?;
        has_updates = true;
    }
    if let Some(o) = options {
        conn.execute(
            "UPDATE AIResponses SET Options = ? WHERE Id = ?",
            rusqlite::params![o, id],
        )
        .map_err(|e| format!("{}", e))?;
        has_updates = true;
    }
    if let Some(a) = answer {
        conn.execute(
            "UPDATE AIResponses SET Answer = ? WHERE Id = ?",
            rusqlite::params![a, id],
        )
        .map_err(|e| format!("{}", e))?;
        has_updates = true;
    }
    if let Some(t) = question_type {
        conn.execute(
            "UPDATE AIResponses SET QuestionType = ? WHERE Id = ?",
            rusqlite::params![t, id],
        )
        .map_err(|e| format!("{}", e))?;
        has_updates = true;
    }

    if has_updates {
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
    let (q, o, a, qt, ia, ipc): (String, Option<String>, String, Option<String>, bool, bool) = conn
        .query_row(
            "SELECT Question, Options, Answer, QuestionType, IsAi, COALESCE(IsPendingCorrection, 0) FROM AIResponses WHERE Id = ?",
            [question_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|e| format!("{}", e))?;

    conn.execute(
        "INSERT INTO AIResponses (Question, Options, Answer, QuestionType, FolderId, IsAi, IsPendingCorrection, CreateTime)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        rusqlite::params![q, o, a, qt, actual_target_id, ia, ipc],
    ).map_err(|e| format!("{}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_question(id: i64) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM AIResponses WHERE Id = ?", [id])
        .map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_questions(ids: Vec<i64>) -> Result<(), String> {
    let conn = get_conn()?;
    // 由于 rusqlite 批量删除比较麻烦，这里采用循环方式
    for id in ids {
        conn.execute("DELETE FROM AIResponses WHERE Id = ?", [id])
            .map_err(|e| format!("{}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_folder(id: i64, delete_questions: bool) -> Result<(), String> {
    let conn = get_conn()?;

    // 递归获取所有子文件夹 ID
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE folder_tree AS (
          SELECT Id FROM Folders WHERE Id = ?
          UNION ALL
          SELECT f.Id FROM Folders f
          INNER JOIN folder_tree ft ON f.ParentId = ft.Id
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

    if delete_questions {
        // 删除所有这些文件夹中的题目
        for fid in &folder_ids {
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
    // 检查防止循环嵌套（虽然前端会有检查，但后端建议也做简单保护）
    if id == parent_id {
        return Err("Cannot move folder to itself".to_string());
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
                  ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
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
                  ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
                FROM AIResponses ar
                INNER JOIN folder_tree ft ON ar.FolderId = ft.Id
                INNER JOIN Folders f ON ar.FolderId = f.Id"
            }
        } else {
            // 所有文件夹
            "SELECT
              ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType,
              ar.FolderId, f.Name as FolderName, ar.CreateTime, ar.IsAi, COALESCE(ar.IsPendingCorrection, 0)
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

pub async fn query_database(
    title: &str,
    options: Option<&str>,
) -> Result<Vec<(i64, String, String, bool, bool)>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = get_db_path();
    let title_clone = title.to_string();
    let query_options = normalize_optional_query_text(options);
    let require_option_match = should_require_option_match(&title_clone);

    let result = tokio::task::spawn_blocking(
        move || -> Result<Vec<(i64, String, String, bool, bool)>, Box<dyn std::error::Error + Send + Sync>> {
            let conn = match Connection::open(&db_path) {
                Ok(c) => c,
                Err(e) => {
                    return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
                }
            };

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
                match row {
                    Ok((id, question, db_options, answer, is_ai, is_pending_correction)) => {
                        // 如果查询题目包含 URL，要求数据库记录的 URL 集合完全一致
                        // 避免"设A图那么B图"误匹配"设C图那么B图"
                        let query_urls = extract_urls(&title_clone);
                        if !query_urls.is_empty() {
                            let db_urls = extract_urls(&question);
                            if query_urls != db_urls {
                                continue;
                            }
                        }

                        let Some(title_similarity) =
                            compute_query_match_score(&title_clone, &question)
                        else {
                            continue;
                        };

                        if require_option_match {
                            let Some(query_options) = query_options.as_deref() else {
                                continue;
                            };
                            let Some(db_options) =
                                normalize_optional_query_text(db_options.as_deref())
                            else {
                                continue;
                            };
                            let Some(option_similarity) =
                                compute_query_match_score(query_options, &db_options)
                            else {
                                continue;
                            };

                            let combined_similarity = title_similarity * 0.7 + option_similarity * 0.3;
                            results.push(((id, question, answer, is_ai, is_pending_correction), combined_similarity));
                        } else {
                            results.push(((id, question, answer, is_ai, is_pending_correction), title_similarity));
                        }
                    }
                    Err(e) => return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>),
                }
            }

            results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

            let final_results: Vec<(i64, String, String, bool, bool)> =
                results.into_iter().take(50).map(|(data, _)| data).collect();

            Ok(final_results)
        },
    )
    .await?;

    result
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

    let mut stmt = conn
        .prepare("PRAGMA table_info('AIResponses')")
        .map_err(|e| format!("{}", e))?;
    let mut has_is_ai = false;
    let mut has_is_pending_correction = false;
    let cols = stmt
        .query_map([], |row| Ok(row.get::<_, String>(1)?))
        .map_err(|e| format!("{}", e))?;
    for c in cols {
        if let Ok(name) = c {
            if name == "IsAi" {
                has_is_ai = true;
            }
            if name == "IsPendingCorrection" {
                has_is_pending_correction = true;
            }
        }
    }
    if !has_is_ai {
        let _ = conn.execute(
            "ALTER TABLE AIResponses ADD COLUMN IsAi BOOLEAN DEFAULT 1",
            [],
        );
        let _ = conn.execute("UPDATE AIResponses SET IsAi = 1 WHERE IsAi IS NULL", []);
    }
    if !has_is_pending_correction {
        let _ = conn.execute(
            "ALTER TABLE AIResponses ADD COLUMN IsPendingCorrection BOOLEAN DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "UPDATE AIResponses SET IsPendingCorrection = 0 WHERE IsPendingCorrection IS NULL",
            [],
        );
    }

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
    use super::compute_query_match_score;

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
}
