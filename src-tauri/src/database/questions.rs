use crate::database::conn::get_conn;
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
    let configured_folder_id = crate::secret_vault::document_read("app_settings",None).ok()
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

#[derive(Debug, Clone)]
pub struct QuestionMatch {
    pub id: i64,
    pub question: String,
    pub options: Option<String>,
    pub answer: String,
    pub is_ai: bool,
    pub is_pending_correction: bool,
    pub question_type: Option<String>,
    pub score: f64,
    pub title_similarity: f64,
}

fn score_question_row(
    title_score: f64,
    title_similarity: f64,
    query_options: &Option<String>,
    require_option_match: bool,
    id: i64,
    question: String,
    db_options: Option<String>,
    answer: String,
    is_ai: bool,
    is_pending_correction: bool,
    question_type: Option<String>,
) -> Option<QuestionMatch> {
    let has_query_options = query_options.is_some();
    let option_similarity = match (
        query_options.as_deref(),
        normalize_optional_query_text(db_options.as_deref()),
    ) {
        (Some(query_options), Some(db_options)) => {
            if same_query_options_unordered(query_options, &db_options) {
                Some(1.0)
            } else {
                compute_query_match_score(query_options, &db_options)
            }
        }
        _ => None,
    };

    let is_exact_title_match = is_exact_match_score(title_score);
    if !is_exact_title_match
        && (require_option_match || has_query_options)
        && option_similarity.is_none()
    {
        return None;
    }

    let final_similarity = match option_similarity {
        Some(option_similarity) => title_score * 0.7 + option_similarity * 0.3,
        None => title_score,
    };

    Some(QuestionMatch {
        id,
        question,
        options: db_options,
        answer,
        is_ai,
        is_pending_correction,
        question_type,
        score: final_similarity,
        title_similarity,
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
        None => normalize_optional_query_text(matched.options.as_deref()).is_none(),
        Some(query_opts) => matched.options.as_deref()
            .is_some_and(|db_opts| exact_query_options_match(&query_opts, db_opts)),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LocalQuestionMatch {
    pub id: i64,
    pub question: String,
    pub similarity: f64,
    #[serde(default)]
    pub status: LocalMatchStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejection_reason: Option<String>,
}

pub(crate) fn record_exact_match_rejection(
    similar: &mut [LocalQuestionMatch],
    id: i64,
    reason: &str,
) {
    if let Some(row) = similar.iter_mut().find(|row| row.id == id && is_exact_match_score(row.similarity)) {
        row.rejection_reason = Some(reason.to_owned());
    }
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalMatchStatus {
    #[default]
    Similar,
    Candidate,
    Used,
}

fn read_match_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<QuestionMatch> {
    Ok(QuestionMatch {
        id: row.get(0)?,
        question: row.get(1)?,
        options: row.get(2)?,
        answer: row.get(3)?,
        is_ai: row.get(4)?,
        is_pending_correction: row.get(5)?,
        question_type: row.get(6)?,
        score: 0.0,
        title_similarity: 0.0,
    })
}

const MATCH_COLUMNS: &str = "Id, Question, Options, Answer, IsAi, COALESCE(IsPendingCorrection, 0), QuestionType";

pub fn question_match_is_current(matched: &QuestionMatch) -> bool {
    let Ok(conn) = get_conn() else { return false };
    conn.query_row(
        &format!("SELECT {MATCH_COLUMNS} FROM AIResponses WHERE Id = ?"),
        [matched.id],
        read_match_row,
    ).is_ok_and(|current| {
        !current.is_pending_correction
            && current.question == matched.question
            && current.options == matched.options
            && current.answer == matched.answer
            && current.question_type == matched.question_type
            && current.is_ai == matched.is_ai
    })
}

fn scan_question_matches(
    conn: &Connection,
    title: &str,
    options: Option<&str>,
    display_limit: usize,
    indexed: bool,
) -> Result<(Vec<QuestionMatch>, Vec<LocalQuestionMatch>), Box<dyn std::error::Error + Send + Sync>> {
    let normalized_title = QueryMatchText::new(title);
    let query_urls = extract_urls(title);
    let title_with_urls = compact_query_spacing(title);
    let query_options = normalize_optional_query_text(options);
    let require_option_match = is_generic_choice_title(&normalized_title.compact);

    let query = if indexed {
        super::question_search::candidate_query(conn, &normalized_title.compact)?
    } else {
        super::question_search::CandidateQuery::default()
    };
    let sql = format!("SELECT {MATCH_COLUMNS} FROM AIResponses {}", query.filter);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(query.params), read_match_row)?;

    let mut results = Vec::new();
    let mut similar: Vec<LocalQuestionMatch> = Vec::new();
    for row in rows {
        let QuestionMatch { id, question, options: db_options, answer, is_ai, is_pending_correction, question_type, .. } = row?;
        let different_urls = query_urls != extract_urls(&question);
        if different_urls && display_limit == 0 {
            continue;
        }
        let normalized_question = QueryMatchText::new(&question);
        let omitted_blank = !different_urls && normalized_title.matches_omitted_blank(&normalized_question);
        let similarity = if different_urls {
            // Different images should not appear identical because of a shared URL placeholder.
            query_text_similarity(&title_with_urls, &compact_query_spacing(&question))
        } else {
            query_text_similarity(&normalized_title.compact, &normalized_question.compact)
        };
        if display_limit > 0 && similarity > 0.0 {
            let index = similar.partition_point(|item| item.similarity >= similarity);
            if index < display_limit {
                similar.insert(index, LocalQuestionMatch {
                    id,
                    question: question.clone(),
                    similarity,
                    status: LocalMatchStatus::Similar,
                    rejection_reason: None,
                });
                similar.truncate(display_limit);
            }
        }
        if different_urls {
            continue;
        }
        let title_score = if omitted_blank {
            Some(similarity)
        } else {
            filter_query_match_score(&normalized_title, &normalized_question, similarity)
        };
        let Some(title_score) = title_score else {
            continue;
        };
        if let Some(matched) = score_question_row(
            title_score,
            similarity,
            &query_options,
            require_option_match,
            id,
            question,
            db_options,
            answer,
            is_ai,
            is_pending_correction,
            question_type,
        ) {
            results.push(matched);
        }
    }

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    Ok((results, similar))
}

#[cfg(test)]
mod local_question_matches_tests {
    use super::{is_exact_question_match, scan_question_matches, Connection};

    #[test]
    fn display_includes_weak_matches_without_admitting_them_as_answers() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE AIResponses (
                Id INTEGER, Question TEXT, Options TEXT, Answer TEXT,
                IsAi INTEGER, IsPendingCorrection INTEGER, QuestionType TEXT
             );
             INSERT INTO AIResponses VALUES
                (1, 'abcdef', NULL, 'exact answer', 0, 0, NULL),
                (2, 'axxxxx', NULL, 'unrelated answer', 0, 0, NULL),
                (3, 'zzzzzz', NULL, 'unrelated answer', 0, 0, NULL);",
        ).unwrap();

        let (answers, similar) = scan_question_matches(&conn, "abcdef", None, 5, false).unwrap();
        assert_eq!(answers.iter().map(|row| row.id).collect::<Vec<_>>(), [1]);
        assert_eq!(similar.iter().map(|row| row.id).collect::<Vec<_>>(), [1, 2]);
        assert_eq!(similar[0].similarity, 1.0);
        assert!((0.0..0.72).contains(&similar[1].similarity));
        assert!(similar[1].similarity > 0.0);
    }

    #[test]
    fn title_only_lookup_reuses_exact_self_contained_choice_questions() {
        use super::classify_request_matches;

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE AIResponses (
                Id INTEGER, Question TEXT, Options TEXT, Answer TEXT,
                IsAi INTEGER, IsPendingCorrection INTEGER, QuestionType TEXT
             );",
        ).unwrap();
        let title = "虫媒病的季节性主要取决于：";
        let options = "A. 湿度\nB. 雨量\nC. 温度\nD. 光照\nE. 食性";
        let mosquito_title = "下列哪种媒介的雄虫不传播疾病？";
        let mosquito_options = "A. 蚊\nB. 蝇\nC. 蚤\nD. 虱\nE. 蜚蠊";
        conn.execute(
            "INSERT INTO AIResponses VALUES (1, ?, ?, 'C', 1, 0, '单选'),
                 (2, ?, ?, 'B', 0, 1, '单选'),
                 (3, '下列哪项正确？', ?, 'A', 0, 0, '单选'),
                 (4, ?, ?, 'A', 1, 0, '单选'),
                 (5, '1. 下列说法中，不正确的是（ ）', ?, 'A', 0, 0, '单选')",
            [title, options, title, options, options, mosquito_title, mosquito_options, options],
        ).unwrap();

        let classify = |title, options, kind| {
            let (matches, similar) = scan_question_matches(&conn, title, options, 5, false).unwrap();
            classify_request_matches(title, options, kind, 5, matches, similar)
        };
        for (options, kind) in [
            (None, None),
            (Some(""), Some("")),
            (Some("\u{200b}\n\u{feff}"), Some("\u{feff}\u{200b}")),
        ] {
            let title_only = classify(title, options, kind);
            assert_eq!(title_only.exact.iter().map(|row| row.id).collect::<Vec<_>>(), [1]);
            assert!(title_only.candidates.is_empty());
            assert_eq!(title_only.similar[1].rejection_reason.as_deref(), Some("本地题目已标记待修正"));
        }
        assert!(classify(title, None, Some("single")).exact.is_empty());
        let different_options = classify(title, Some("A. 湿度\nB. 雨量\nC. 温度\nD. 光照\nE. 种群密度"), None);
        assert!(different_options.exact.is_empty());
        assert_eq!(different_options.similar[0].rejection_reason.as_deref(), Some("请求选项与本地选项不一致"));
        assert!(classify("下列哪项正确？", None, None).exact.is_empty());
        assert!(classify("1. 下列说法中，不正确的是（ ）", None, None).exact.is_empty());
        let mosquito = classify(mosquito_title, None, None);
        assert_eq!(mosquito.exact.iter().map(|row| row.id).collect::<Vec<_>>(), [4]);
        assert!(mosquito.candidates.is_empty());
    }

    #[test]
    fn homework_bank_only_admits_reviewable_exact_text_and_current_options() {
        use super::exact_homework_bank_rows;
        use crate::server::QuestionKind;

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE AIResponses (
                Id INTEGER, Question TEXT, Options TEXT, Answer TEXT,
                IsAi INTEGER, IsPendingCorrection INTEGER, QuestionType TEXT
             );
             INSERT INTO AIResponses VALUES
                (1, '正确的是（ ）', 'A. 甲' || char(10) || 'B. 乙', 'A', 0, 0, '单选'),
                (2, '正确的是（ ）', 'A. 甲' || char(10) || 'B. 乙', 'B', 1, 0, '单选'),
                (3, '正确的是（ ）', 'A. 甲' || char(10) || 'B. 乙', 'B', 0, 1, '单选'),
                (4, '不正确的是（ ）', 'A. 甲' || char(10) || 'B. 乙', 'A', 0, 0, '单选'),
                (5, '正确的是（ ）', 'A. 甲' || char(10) || 'B. 丙', 'A', 0, 0, '单选'),
                (6, '正确的是（ ）', 'A. 甲' || char(10) || 'B. 乙', 'B', 0, 0, '单选'),
                (7, '选出一项', 'A. 甲' || char(10) || 'B. 以上都对', 'B', 0, 0, '单选');",
        ).unwrap();
        let rows = exact_homework_bank_rows(&conn, "正确的是 ( )", Some("A. 乙\nB. 甲"), QuestionKind::Single, false).unwrap();
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), [1, 6]);
        assert!(exact_homework_bank_rows(&conn, "正确的是", Some("A. 乙\nB. 甲"), QuestionKind::Single, false).unwrap().is_empty());
        assert!(exact_homework_bank_rows(&conn, "选出一项", Some("A. 以上都对\nB. 甲"), QuestionKind::Single, false).unwrap().is_empty());
    }

    #[test]
    fn spacing_variants_hit_the_bank_but_omitted_blank_needs_confirmation() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE AIResponses (
                Id INTEGER, Question TEXT, Options TEXT, Answer TEXT,
                IsAi INTEGER, IsPendingCorrection INTEGER, QuestionType TEXT
             );",
        ).unwrap();
        conn.execute(
            "INSERT INTO AIResponses VALUES (1, ?, ?, '甲', 0, 0, NULL)",
            ["请选择（ ）", "A. 甲（注）\nB. 乙"],
        ).unwrap();

        let options = Some("A. 甲\n ( 注 )\n\nB.乙");
        let title = "请\n选择 (\t)";
        let (matches, similar) = scan_question_matches(&conn, title, options, 5, false).unwrap();
        assert_eq!(similar[0].similarity, 1.0);
        assert!(is_exact_question_match(title, options, &matches[0]));

        let title = "请选择 ";
        let (matches, _) = scan_question_matches(&conn, title, options, 5, false).unwrap();
        assert_eq!(matches.len(), 1);
        assert!(!is_exact_question_match(title, options, &matches[0]));
    }
}

pub struct RequestQuestionMatches {
    pub exact: Vec<QuestionMatch>,
    pub candidates: Vec<QuestionMatch>,
    pub similar: Vec<LocalQuestionMatch>,
}

/// Scan once for both answer matching and the request details display.
pub async fn query_database_for_request(
    title: &str,
    options: Option<&str>,
    query_type: Option<&str>,
    limit: usize,
) -> Result<RequestQuestionMatches, Box<dyn std::error::Error + Send + Sync>> {
    let title = title.to_string();
    let options = options.map(|s| s.to_string());

    let query_type = query_type.map(str::to_owned);

    tokio::task::spawn_blocking(move || {
        let conn = get_conn()?;
        let (matches, similar) = scan_question_matches(&conn, &title, options.as_deref(), limit, true)?;
        Ok(classify_request_matches(&title, options.as_deref(), query_type.as_deref(), limit, matches, similar))
    })
    .await?
}

/// The homework worker never promotes a fuzzy candidate to an answer.
pub(crate) async fn exact_homework_bank_matches(
    title: String,
    options: Option<String>,
    kind: crate::server::QuestionKind,
) -> Result<Vec<QuestionMatch>, Box<dyn std::error::Error + Send + Sync>> {
    tokio::task::spawn_blocking(move || {
        let conn = get_conn()?;
        exact_homework_bank_rows(&conn, &title, options.as_deref(), kind, true)
    }).await?
}

fn exact_homework_bank_rows(
    conn: &Connection,
    title: &str,
    options: Option<&str>,
    kind: crate::server::QuestionKind,
    indexed: bool,
) -> Result<Vec<QuestionMatch>, Box<dyn std::error::Error + Send + Sync>> {
    use crate::server::{detect_question_kind, QuestionKind};
    let normalized = QueryMatchText::new(title).compact;
    if normalized.is_empty() || title.contains("[图片") || !extract_urls(title).is_empty() {
        return Ok(Vec::new());
    }
    let query = if indexed {
        super::question_search::candidate_query(conn, &normalized)?
    } else {
        super::question_search::CandidateQuery::default()
    };
    let sql = format!("SELECT {MATCH_COLUMNS} FROM AIResponses {}", query.filter);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(query.params), read_match_row)?;
    let mut matches = Vec::new();
    for row in rows {
        let matched = row?;
        if matched.is_pending_correction || matched.is_ai || matched.answer.trim().is_empty()
            || matched.question_type.as_deref().and_then(detect_question_kind) != Some(kind)
            || matched.question.contains("[图片") || !extract_urls(&matched.question).is_empty()
            || QueryMatchText::new(&matched.question).compact != normalized {
            continue;
        }
        let provided = options.filter(|s| !s.trim().is_empty());
        let stored = matched.options.as_deref().filter(|s| !s.trim().is_empty());
        let same = match (provided, stored) {
            (Some(a), Some(b)) if ![a,b].iter().any(|text| text.contains("[图片") || !extract_urls(text).is_empty()) => {
                exact_query_options_match(a, b) || (same_query_options_unordered(a, b)
                    && !["以上", "上述", "以下", "前两项", "后两项", "全部选项", "其他选项", "A和B", "A与B", "A、B", "A项", "B项"]
                        .iter().any(|part| title.contains(part) || b.contains(part)))
            }
            (_, None) if kind == QuestionKind::Judgement => true,
            (None, None) => kind == QuestionKind::Completion,
            _ => false,
        };
        if same {
            matches.push(matched);
            // Too many duplicates are not safely resolvable within the script budget.
            if matches.len() > 24 { break; }
        }
    }
    Ok(matches)
}

fn classify_request_matches(
    title: &str,
    options: Option<&str>,
    query_type: Option<&str>,
    limit: usize,
    matches: Vec<QuestionMatch>,
    mut similar: Vec<LocalQuestionMatch>,
) -> RequestQuestionMatches {
    let query_kind = query_type.and_then(crate::server::detect_question_kind);
    let title_only = normalize_optional_query_text(query_type).is_none();
    let needs_options = query_kind.is_some_and(|kind| kind.requires_options())
        || is_generic_choice_title(&QueryMatchText::new(title).compact);
    let query_options = normalize_optional_query_text(options);
    let supplied_options = query_options.as_deref().unwrap_or_default();
    let mut exact = Vec::new();
    let mut candidates = Vec::new();

    for matched in matches {
        if matched.is_pending_correction {
            record_exact_match_rejection(&mut similar, matched.id, "本地题目已标记待修正");
            continue;
        }
        if matched.answer.trim().is_empty()
            || (matched.is_ai && crate::model_response::validate_answer(&matched.answer).is_err())
        {
            record_exact_match_rejection(&mut similar, matched.id, "本地答案为空或不可用");
            continue;
        }

        let stored_kind = matched.question_type.as_deref().and_then(crate::server::detect_question_kind);
        if matches!((query_kind, stored_kind), (Some(a), Some(b)) if a != b) {
            record_exact_match_rejection(&mut similar, matched.id, "请求题型与本地题型不一致");
            continue;
        }

        let stored_options = matched.options.as_deref().unwrap_or_default();
        if [title, supplied_options, &matched.question, stored_options].iter().any(|text| text.contains("[图片")) {
            record_exact_match_rejection(&mut similar, matched.id, "题目包含需要核对的图片");
            continue;
        }
        let stored_has_options = normalize_optional_query_text(matched.options.as_deref()).is_some();

        if query_options.is_none() && needs_options {
            record_exact_match_rejection(&mut similar, matched.id, "作答需要选项，本次请求未提供");
            continue;
        }
        if query_options.is_none() && stored_has_options {
            // A title-only lookup can use a self-contained question, but only on an
            // exact title match. The caller checks for conflicting answers.
            if title_only && is_exact_match_score(matched.title_similarity) {
                exact.push(matched);
            } else {
                record_exact_match_rejection(&mut similar, matched.id, "请求未提供选项，无法核对作答条件");
            }
            continue;
        }
        if !stored_has_options && (query_options.is_some() || stored_kind.is_some_and(|kind| kind.requires_options())) {
            record_exact_match_rejection(&mut similar, matched.id, "本地题目缺少可核对的选项");
            continue;
        }
        if is_exact_question_match(title, options, &matched) {
            exact.push(matched);
        } else if same_query_options_unordered(supplied_options, stored_options) {
            if candidates.len() < limit {
                candidates.push(matched);
            }
        } else {
            record_exact_match_rejection(&mut similar, matched.id, "请求选项与本地选项不一致");
        }
    }

    RequestQuestionMatches { exact, candidates, similar }
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
            let conn = get_conn()?;
            let (matches, _) = scan_question_matches(&conn, &title, options.as_deref(), 0, false)?;
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

    if is_ai {
        crate::model_response::validate_answer(answer)?;
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
