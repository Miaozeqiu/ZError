use crate::database::conn::open_db_at;
use rusqlite::Connection;
use std::collections::HashSet;

pub(crate) fn get_table_columns(conn: &Connection, table_name: &str) -> Result<HashSet<String>, String> {
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

pub(crate) fn ensure_column(
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
    let conn = open_db_at(db_path)?;
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
        "CREATE TABLE IF NOT EXISTS StudyTimelineSummary (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          SubjectId INTEGER NOT NULL,
          Text TEXT NOT NULL,
          StartTime TEXT NOT NULL,
          EndTime TEXT NOT NULL,
          CoveredThroughId INTEGER NOT NULL,
          ActivityCount INTEGER DEFAULT 0,
          CreateTime TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_study_timeline_summary_subject
         ON StudyTimelineSummary (SubjectId, EndTime DESC, Id DESC)",
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
    use super::{get_table_columns, init_database_schema};
    use rusqlite::Connection;
    use uuid::Uuid;

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
