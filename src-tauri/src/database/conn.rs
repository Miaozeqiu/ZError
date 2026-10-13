use rusqlite::Connection;
use std::env;

pub(crate) fn get_db_path() -> String {
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

pub(crate) fn configure_conn(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.busy_timeout(std::time::Duration::from_millis(8_000))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    Ok(())
}

pub(crate) fn open_db_at(db_path: &str) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("{}", e))?;
    configure_conn(&conn).map_err(|e| format!("{}", e))?;
    Ok(conn)
}

pub(crate) fn get_conn() -> Result<Connection, String> {
    open_db_at(&get_db_path())
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
