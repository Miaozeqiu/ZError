use crate::database::conn::get_conn;
use crate::logger::RequestLog;
use chrono::{DateTime, Utc};
use std::collections::HashMap;

pub(crate) fn map_request_log_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RequestLog> {
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

