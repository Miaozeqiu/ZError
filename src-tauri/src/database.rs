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
        // 使用rusqlite连接数据库
        let conn = Connection::open(&db_path_clone)?;
        
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