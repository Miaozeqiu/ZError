use crate::database::conn::{get_conn, get_db_path, open_db_at};
use crate::database::query_match::*;
use crate::database::types::{map_ai_response_row, *};
use rusqlite::{Connection, OptionalExtension};

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
pub fn get_target_folder_id(conn: &Connection, parent_folder_id: i64) -> Result<i64, rusqlite::Error> {
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

pub fn get_configured_save_folder_id(conn: &Connection) -> i64 {
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
pub fn collect_folder_subtree_ids(conn: &Connection, id: i64) -> Result<Vec<i64>, String> {
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
        let conn = open_db_at(&db_path)?;

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

pub fn score_question_row(
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

pub fn is_exact_question_match(
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

pub fn scan_question_matches(
    title: &str,
    options: Option<&str>,
) -> Result<Vec<QuestionMatch>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = get_db_path();
    let title_clone = title.to_string();
    let query_options = normalize_optional_query_text(options);
    let require_option_match = should_require_option_match(&title_clone);

    let conn = open_db_at(&db_path).map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
        Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))
    })?;
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
