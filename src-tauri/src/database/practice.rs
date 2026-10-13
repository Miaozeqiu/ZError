use crate::database::conn::get_conn;
use crate::database::study_graph::record_practice_activity;
use crate::database::types::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

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
pub struct QuestionPracticeStats {
    pub question_id: i64,
    pub attempted: i64,
    pub last_correct: bool,
    pub ever_wrong: bool,
}

#[tauri::command]
pub async fn get_question_practice_stats(ids: Vec<i64>) -> Result<Vec<QuestionPracticeStats>, String> {
    let conn = get_conn()?;
    let unique: Vec<i64> = ids
        .into_iter()
        .filter(|id| *id > 0)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if unique.is_empty() {
        return Ok(vec![]);
    }
    let mut by_id: HashMap<i64, QuestionPracticeStats> = HashMap::new();
    for chunk in unique.chunks(400) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let agg_sql = format!(
            "SELECT QuestionId,
                    SUM(CASE WHEN length(trim(UserAnswer)) > 0 THEN 1 ELSE 0 END) AS attempted,
                    MAX(CASE WHEN IsCorrect = 0 AND length(trim(UserAnswer)) > 0 THEN 1 ELSE 0 END) AS ever_wrong
             FROM QuestionPracticeHistory
             WHERE QuestionId IN ({placeholders})
             GROUP BY QuestionId"
        );
        let mut stmt = conn.prepare(&agg_sql).map_err(|e| format!("{}", e))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)? != 0,
                ))
            })
            .map_err(|e| format!("{}", e))?;
        for row in rows {
            let (question_id, attempted, ever_wrong) = row.map_err(|e| format!("{}", e))?;
            by_id.insert(
                question_id,
                QuestionPracticeStats {
                    question_id,
                    attempted,
                    last_correct: false,
                    ever_wrong,
                },
            );
        }
        let last_sql = format!(
            "SELECT h.QuestionId, h.IsCorrect
             FROM QuestionPracticeHistory h
             INNER JOIN (
                SELECT QuestionId, MAX(Id) AS MaxId
                FROM QuestionPracticeHistory
                WHERE QuestionId IN ({placeholders})
                  AND length(trim(UserAnswer)) > 0
                GROUP BY QuestionId
             ) t ON t.MaxId = h.Id"
        );
        let mut last_stmt = conn.prepare(&last_sql).map_err(|e| format!("{}", e))?;
        let last_rows = last_stmt
            .query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)? != 0))
            })
            .map_err(|e| format!("{}", e))?;
        for row in last_rows {
            let (question_id, last_correct) = row.map_err(|e| format!("{}", e))?;
            if let Some(item) = by_id.get_mut(&question_id) {
                item.last_correct = last_correct;
            }
        }
    }
    Ok(by_id.into_values().collect())
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
