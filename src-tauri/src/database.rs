use std::env;
use rusqlite::Connection;

pub async fn query_database(title: &str) -> Result<Option<(String, String, bool)>, Box<dyn std::error::Error + Send + Sync>> {
    // 获取用户名
    let username = get_username().unwrap_or_else(|_| "Administrator".to_string());
    
    // 构建数据库路径
    let db_path = format!("C:\\Users\\{}\\AppData\\Local\\ZError\\airesponses.db", username);
    
    let title_clone = title.to_string();
    let db_path_clone = db_path.clone();
    
    let result = tokio::task::spawn_blocking(move || -> Result<Option<(String, String, bool)>, Box<dyn std::error::Error + Send + Sync>> {
        let conn = match Connection::open(&db_path_clone) {
            Ok(c) => c,
            Err(e) => {
                return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
            }
        };
        
        // 准备查询语句
        let mut stmt = conn.prepare("SELECT Question, Answer, IsAi FROM AIResponses WHERE Question LIKE ?1 LIMIT 1")?;
        
        // 执行查询
        let search_pattern = format!("%{}%", title_clone);
        let mut rows = stmt.query_map([&search_pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?
            ))
        })?;
        
        // 获取第一行结果
        if let Some(row) = rows.next() {
            match row {
                Ok(data) => Ok(Some(data)),
                Err(e) => Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
            }
        } else {
            Ok(None)
        }
    }).await?;
    
    result
}

pub fn get_username() -> Result<String, String> {
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
        .query_row("SELECT COUNT(1) FROM Folders WHERE Id = 0", [], |row| row.get(0))
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
          IsAi BOOLEAN DEFAULT 1
        )",
        [],
    )
    .map_err(|e| format!("{}", e))?;

    let mut stmt = conn
        .prepare("PRAGMA table_info('AIResponses')")
        .map_err(|e| format!("{}", e))?;
    let mut has_is_ai = false;
    let cols = stmt
        .query_map([], |row| Ok((row.get::<_, String>(1)?)))
        .map_err(|e| format!("{}", e))?;
    for c in cols {
        if let Ok(name) = c {
            if name == "IsAi" {
                has_is_ai = true;
                break;
            }
        }
    }
    if !has_is_ai {
        let _ = conn.execute("ALTER TABLE AIResponses ADD COLUMN IsAi BOOLEAN DEFAULT 1", []);
        let _ = conn.execute("UPDATE AIResponses SET IsAi = 1 WHERE IsAi IS NULL", []);
    }

    Ok(())
}
