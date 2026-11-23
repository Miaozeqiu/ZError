//! documents implementation; the parent module preserves the public facade.
use super::*;

/// 读取文本文件内容（用于算法运行时提供原始文本输入）
#[tauri::command]
pub async fn read_file_text(path: String) -> Result<String, String> {
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) => Err(format!("读取文件失败: {}", e)),
    }
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<String, String> {
    match fs::read(&path) {
        Ok(bytes) => Ok(general_purpose::STANDARD.encode(&bytes)),
        Err(e) => Err(format!("读取二进制失败: {}", e)),
    }
}

#[tauri::command]
pub async fn stat_local_file(path: String) -> Result<serde_json::Value, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {}", e))?;
    let modified = meta.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis());
    Ok(serde_json::json!({ "size": meta.len(), "modified": modified, "isFile": meta.is_file() }))
}

#[tauri::command]
pub async fn read_excel_headers(path: String) -> Result<Vec<String>, String> {
    let mut workbook = open_workbook_auto(&path).map_err(|e| format!("打开Excel失败: {}", e))?;
    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err("Excel文件没有工作表".to_string());
    }
    let range = workbook
        .worksheet_range(&sheet_names[0])
        .ok_or_else(|| "读取工作表失败".to_string())
        .and_then(|r| r.map_err(|e| format!("读取工作表失败: {}", e)))?;
    let mut headers: Vec<String> = Vec::new();
    for row in range.rows() {
        let mut any_non_empty = false;
        let mut row_vals: Vec<String> = Vec::new();
        for cell in row {
            let s = match cell {
                DataType::Empty => String::new(),
                DataType::String(s) => s.clone(),
                DataType::Float(n) => {
                    let mut s = format!("{}", n);
                    if s.ends_with(".0") {
                        s = s.trim_end_matches(".0").to_string();
                    }
                    s
                }
                DataType::Int(i) => i.to_string(),
                DataType::Bool(b) => {
                    if *b {
                        "TRUE".to_string()
                    } else {
                        "FALSE".to_string()
                    }
                }
                DataType::Error(_) => String::new(),
                _ => format!("{:?}", cell),
            };
            if !s.trim().is_empty() {
                any_non_empty = true;
            }
            row_vals.push(s);
        }
        if any_non_empty {
            headers = row_vals;
            break;
        }
    }
    if headers.is_empty() {
        return Err("未找到非空表头行".to_string());
    }
    Ok(headers)
}

#[tauri::command]
pub async fn read_excel_range(
    path: String,
    start: i32,
    end: i32,
) -> Result<Vec<Vec<String>>, String> {
    let mut workbook = open_workbook_auto(&path).map_err(|e| format!("打开Excel失败: {}", e))?;
    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err("Excel文件没有工作表".to_string());
    }
    let range = workbook
        .worksheet_range(&sheet_names[0])
        .ok_or_else(|| "读取工作表失败".to_string())
        .and_then(|r| r.map_err(|e| format!("读取工作表失败: {}", e)))?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        let mut vals: Vec<String> = Vec::new();
        for cell in row {
            let s = match cell {
                DataType::Empty => String::new(),
                DataType::String(s) => s.clone(),
                DataType::Float(n) => {
                    let mut s = format!("{}", n);
                    if s.ends_with(".0") {
                        s = s.trim_end_matches(".0").to_string();
                    }
                    s
                }
                DataType::Int(i) => i.to_string(),
                DataType::Bool(b) => {
                    if *b {
                        "TRUE".to_string()
                    } else {
                        "FALSE".to_string()
                    }
                }
                DataType::Error(_) => String::new(),
                _ => format!("{:?}", cell),
            };
            vals.push(s);
        }
        rows.push(vals);
    }
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let total = rows.len() as i32;
    let s = start.max(0);
    if s >= total || end < s { return Ok(vec![]); }
    let e = end.max(s).min(total - 1);
    Ok(rows[(s as usize)..=(e as usize)].to_vec())
}

pub(super) fn read_docx_paragraphs(path: &str) -> Result<Vec<String>, String> {
    let f = File::open(path).map_err(|e| format!("打开docx失败: {}", e))?;
    let mut zip = ZipArchive::new(f).map_err(|e| format!("读取docx压缩失败: {}", e))?;
    let mut file = zip
        .by_name("word/document.xml")
        .map_err(|e| format!("docx缺少document.xml: {}", e))?;
    let mut xml = String::new();
    use std::io::Read as _;
    file.read_to_string(&mut xml)
        .map_err(|e| format!("读取document.xml失败: {}", e))?;
    parse_docx_xml(&xml)
}

fn parse_docx_xml(xml: &str) -> Result<Vec<String>, String> {
    let mut reader = XmlReader::from_str(xml);
    reader.trim_text(false);
    let mut buf = Vec::new();
    let mut paragraphs: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_p = false;
    let mut in_text = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.local_name().as_ref().to_vec();
                if name == b"p" {
                    in_p = true;
                    current.clear();
                }
                if name == b"t" {
                    in_text = true;
                }
            }
            Ok(Event::Text(t)) => {
                if in_p && in_text {
                    current.push_str(&t.unescape().unwrap_or_default().to_string());
                }
            }
            Ok(Event::End(e)) => {
                let name = e.local_name().as_ref().to_vec();
                if name == b"t" {
                    in_text = false;
                }
                if name == b"p" {
                    in_p = false;
                    paragraphs.push(current.clone());
                    current.clear();
                }
            }
            Ok(Event::Empty(e)) if in_p => {
                match e.local_name().as_ref() {
                    b"br" | b"cr" => current.push('\n'),
                    b"tab" => current.push('\t'),
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("解析docx失败: {}", e)),
            _ => {}
        }
        buf.clear();
    }
    Ok(paragraphs)
}

#[tauri::command]
pub async fn read_docx_range(path: String, start: i32, end: i32) -> Result<Vec<String>, String> {
    let pars = read_docx_paragraphs(&path)?;
    if pars.is_empty() {
        return Ok(vec![]);
    }
    let total = pars.len() as i32;
    let s = start.max(0);
    if s >= total || end < s { return Ok(vec![]); }
    let e = end.max(s).min(total - 1);
    Ok(pars[(s as usize)..=(e as usize)].to_vec())
}

pub(super) fn read_doc_paragraphs(path: &str) -> Result<Vec<String>, String> {
    let data = fs::read(path).map_err(|e| format!("读取doc失败: {}", e))?;
    let mut paras: Vec<String> = Vec::new();
    let sample_len = data.len().min(512);
    let sample = String::from_utf8_lossy(&data[..sample_len]).to_string();
    let is_rtf = sample.trim_start().starts_with("{\\rtf");
    if is_rtf {
        let full = String::from_utf8_lossy(&data).to_string();
        fn rtf_to_text(src: &str) -> String {
            let bytes = src.as_bytes();
            let mut out = String::new();
            let mut i = 0usize;
            while i < bytes.len() {
                let c = bytes[i] as char;
                if c == '{' || c == '}' {
                    i += 1;
                    continue;
                }
                if c == '\\' {
                    i += 1;
                    if i >= bytes.len() {
                        break;
                    }
                    let c2 = bytes[i] as char;
                    if c2 == '\'' {
                        if i + 2 < bytes.len() {
                            let h1 = bytes[i + 1] as char;
                            let h2 = bytes[i + 2] as char;
                            fn hex(c: char) -> u8 {
                                match c {
                                    '0'..='9' => c as u8 - b'0',
                                    'a'..='f' => c as u8 - b'a' + 10,
                                    'A'..='F' => c as u8 - b'A' + 10,
                                    _ => 0,
                                }
                            }
                            let v: u8 = (hex(h1) << 4) | hex(h2);
                            out.push(v as char);
                            i += 3;
                            continue;
                        } else {
                            i += 1;
                            continue;
                        }
                    } else if c2 == 'u' {
                        i += 1;
                        let mut sign = 1i32;
                        if i < bytes.len() && bytes[i] as char == '-' {
                            sign = -1;
                            i += 1;
                        }
                        let mut n: i32 = 0;
                        while i < bytes.len() {
                            let ch = bytes[i] as char;
                            if ch.is_ascii_digit() {
                                n = n * 10 + (ch as i32 - '0' as i32);
                                i += 1;
                            } else {
                                break;
                            }
                        }
                        let code = (n * sign) as u32;
                        if let Some(ch) = std::char::from_u32(code) {
                            out.push(ch);
                        }
                        if i < bytes.len() && (bytes[i] as char) == '?' {
                            i += 1;
                        }
                        continue;
                    } else {
                        let mut j = i;
                        while j < bytes.len() {
                            let ch = bytes[j] as char;
                            if ch.is_ascii_alphabetic() {
                                j += 1;
                                continue;
                            }
                            if ch.is_ascii_digit() {
                                j += 1;
                                continue;
                            }
                            break;
                        }
                        let word = &src[i..j];
                        if word == "par" || word == "line" {
                            out.push('\n');
                        }
                        i = j;
                        if i < bytes.len() && (bytes[i] as char).is_ascii_whitespace() {
                            i += 1;
                        }
                        continue;
                    }
                }
                out.push(c);
                i += 1;
            }
            out
        }
        let text = rtf_to_text(&full);
        paras = text
            .split('\n')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>();
    } else {
        if data.len() >= 2 {
            let mut u16s: Vec<u16> = Vec::with_capacity(data.len() / 2);
            let mut i = 0usize;
            while i + 1 < data.len() {
                let val = u16::from_le_bytes([data[i], data[i + 1]]);
                u16s.push(val);
                i += 2;
            }
            let s = String::from_utf16_lossy(&u16s);
            let normalized = s.replace('\u{0000}', "").replace('\r', "\n");
            paras = normalized
                .split('\n')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>();
        }
        if paras.is_empty() {
            let mut buf = String::new();
            for &b in &data {
                if b == b'\n' || b == b'\r' {
                    buf.push('\n');
                } else if b == 0 {
                    continue;
                } else if (32..=126).contains(&b) {
                    buf.push(b as char);
                } else {
                    buf.push(' ');
                }
            }
            paras = buf
                .split('\n')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>();
        }
    }
    Ok(paras)
}

#[tauri::command]
pub async fn read_doc_range(path: String, start: i32, end: i32) -> Result<Vec<String>, String> {
    let pars = read_doc_paragraphs(&path)?;
    if pars.is_empty() {
        return Ok(vec![]);
    }
    let total = pars.len() as i32;
    let s = start.max(0);
    if s >= total || end < s { return Ok(vec![]); }
    let e = end.max(s).min(total - 1);
    Ok(pars[(s as usize)..=(e as usize)].to_vec())
}

#[tauri::command]
pub async fn read_file_range(
    path: String,
    start: i32,
    end: i32,
) -> Result<serde_json::Value, String> {
    let lower = path.to_lowercase();
    if lower.ends_with(".xlsx") || lower.ends_with(".xls") {
        let rows = read_excel_range(path, start, end).await?;
        Ok(serde_json::json!({"type":"excel","rows": rows}))
    } else if lower.ends_with(".docx") {
        let pars = read_docx_range(path, start, end).await?;
        Ok(serde_json::json!({"type":"docx","paragraphs": pars}))
    } else if lower.ends_with(".doc") {
        let pars = read_doc_range(path, start, end).await?;
        Ok(serde_json::json!({"type":"doc","paragraphs": pars}))
    } else {
        Err("暂不支持该文件类型".to_string())
    }
}

#[tauri::command]
pub async fn convert_doc_to_docx(path: String) -> Result<String, String> {
    let lower = path.to_lowercase();
    if !lower.ends_with(".doc") || lower.ends_with(".docx") {
        return Err("invalid_input".to_string());
    }
    let src = std::path::PathBuf::from(&path);
    if !src.exists() {
        return Err("not_found".to_string());
    }
    let data = std::fs::read(&src).map_err(|e| format!("{}", e))?;
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    let hash_hex = format!("{:016x}", hasher.finish());
    let parent = src.parent().unwrap_or_else(|| std::path::Path::new("."));
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("converted");
    let dst = parent.join(format!("{}+{}.docx", hash_hex, stem));
    if dst.exists() {
        return Ok(dst.to_string_lossy().to_string());
    }
    let script = r#"import sys
from win32com.client import Dispatch
import os

def convert(src, dst):
    word = Dispatch('Word.Application')
    word.Visible = False
    try:
        if os.path.exists(dst):
            try:
                os.remove(dst)
            except Exception:
                pass
        doc = word.Documents.Open(src)
        doc.SaveAs(dst, FileFormat=16)
        doc.Close(False)
    finally:
        try:
            word.Quit()
        except Exception:
            pass

if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(2)
    convert(sys.argv[1], sys.argv[2])
"#;
    let mut tmp = std::env::temp_dir();
    tmp.push("zerror_doc_to_docx.py");
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("{}", e))?;
        f.write_all(script.as_bytes())
            .map_err(|e| format!("{}", e))?;
    }

    let interpreters = ["py", "python", "python3"];
    let mut last_err: Option<String> = None;
    for bin in interpreters.iter() {
        let mut cmd = if *bin == "py" {
            Command::new("py")
        } else {
            Command::new(bin)
        };
        let args = if *bin == "py" {
            vec![
                tmp.to_string_lossy().to_string(),
                path.clone(),
                dst.to_string_lossy().to_string(),
            ]
        } else {
            vec![
                tmp.to_string_lossy().to_string(),
                path.clone(),
                dst.to_string_lossy().to_string(),
            ]
        };
        let out = cmd.args(args).output();
        match out {
            Ok(o) => {
                if o.status.success() {
                    if dst.exists() {
                        let _ = std::fs::remove_file(&tmp);
                        return Ok(dst.to_string_lossy().to_string());
                    } else {
                        last_err = Some(String::from_utf8_lossy(&o.stderr).to_string());
                    }
                } else {
                    last_err = Some(String::from_utf8_lossy(&o.stderr).to_string());
                }
            }
            Err(e) => {
                last_err = Some(format!("{}", e));
            }
        }
    }
    let _ = std::fs::remove_file(&tmp);
    Err(last_err.unwrap_or_else(|| "convert_failed".to_string()))
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<String, String> {
    match fs::create_dir_all(&path) {
        Ok(_) => Ok(format!("Directory created: {}", path)),
        Err(e) => Err(format!("Failed to create directory: {}", e)),
    }
}

#[tauri::command]
pub fn get_username() -> Result<String, String> {
    db_get_username()
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    db_file_exists(&path)
}

#[tauri::command]
pub async fn open_cache_dir(app: tauri::AppHandle) -> Result<(), String> {
    let cache_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(cache_dir.to_str().unwrap_or(""))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(cache_dir.to_str().unwrap_or(""))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(cache_dir.to_str().unwrap_or(""))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 在访达 / 资源管理器中显示文件或文件夹。
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("path 为空".into());
    }
    if !std::path::Path::new(path).exists() {
        return Err("文件不存在".into());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(path);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod document_import_tests {
    use super::*;

    #[test]
    fn preserves_runs_spaces_breaks_tables_and_ignores_similar_element_names() {
        let xml = r#"<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t xml:space="preserve">A. first </w:t><w:tab/><w:t>option</w:t><w:br/><w:t>next &amp; line</w:t></w:r><w:customWrap><w:r><w:t> tail</w:t></w:r></w:customWrap></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>table question</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
        assert_eq!(parse_docx_xml(xml).unwrap(), vec!["A. first \toption\nnext & line tail", "table question"]);
        assert!(parse_docx_xml("<w:p><w:t>broken</w:p>").is_err());
    }

    #[tokio::test]
    async fn docx_range_reaches_eof_without_repeating_the_last_paragraph() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("zerror-document-test-{}.docx", uuid::Uuid::new_v4()));
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("word/document.xml", zip::write::FileOptions::default()).unwrap();
        zip.write_all(b"<w:document xmlns:w=\"urn:word\"><w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>last</w:t></w:r></w:p></w:document>").unwrap();
        zip.finish().unwrap();
        let name = path.to_string_lossy().to_string();
        assert_eq!(read_docx_range(name.clone(), 0, 1).await.unwrap(), vec!["first", "last"]);
        assert!(read_docx_range(name.clone(), 2, 50).await.unwrap().is_empty());
        assert!(read_docx_range(name, 1, 0).await.unwrap().is_empty());
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn attachment_metadata_distinguishes_files_from_folders() {
        let directory = std::env::temp_dir().join(format!("zerror-attachment-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let file = directory.join("questions.txt");
        std::fs::write(&file, b"test").unwrap();
        let meta = stat_local_file(file.to_string_lossy().to_string()).await.unwrap();
        assert_eq!(meta["isFile"], true);
        assert_eq!(meta["size"], 4);
        assert_eq!(stat_local_file(directory.to_string_lossy().to_string()).await.unwrap()["isFile"], false);
        std::fs::remove_dir_all(directory).unwrap();
    }

}
