//! fonts implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn read_u16(data: &[u8], offset: usize) -> Result<u16, String> {
    data.get(offset..offset + 2)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u16::from_be_bytes)
        .ok_or_else(|| "字体数据不完整".into())
}

pub(super) fn read_u32(data: &[u8], offset: usize) -> Result<u32, String> {
    data.get(offset..offset + 4)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u32::from_be_bytes)
        .ok_or_else(|| "字体数据不完整".into())
}

pub(super) fn is_truetype_sfnt(tag: &[u8]) -> bool {
    tag == [0x00, 0x01, 0x00, 0x00] || tag == b"true"
}

pub(super) fn extract_ttf_face(data: &[u8], index: usize) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("字体文件过小".into());
    }

    if &data[0..4] != b"ttcf" {
        if is_truetype_sfnt(&data[0..4]) {
            return Ok(data.to_vec());
        }
        return Err("不是可用的 TrueType 字体".into());
    }

    let num_fonts = read_u32(data, 8)? as usize;
    if index >= num_fonts {
        return Err("字体索引超出范围".into());
    }

    let sfnt_offset = read_u32(data, 12 + index * 4)? as usize;
    if sfnt_offset + 12 > data.len() {
        return Err("无效的字体集合偏移".into());
    }
    if !is_truetype_sfnt(&data[sfnt_offset..sfnt_offset + 4]) {
        return Err("该字重不是 TrueType".into());
    }

    let num_tables = read_u16(data, sfnt_offset + 4)? as usize;
    let table_dir_start = sfnt_offset + 12;
    let header_size = 12 + num_tables * 16;
    if table_dir_start + num_tables * 16 > data.len() {
        return Err("无效的表目录".into());
    }

    let mut out = Vec::new();
    out.extend_from_slice(&data[sfnt_offset..sfnt_offset + header_size]);

    let mut has_glyf = false;
    for i in 0..num_tables {
        let rec = table_dir_start + i * 16;
        let tag = &data[rec..rec + 4];
        if tag == b"glyf" {
            has_glyf = true;
        }
        let table_offset = read_u32(data, rec + 8)? as usize;
        let table_length = read_u32(data, rec + 12)? as usize;
        if table_offset.checked_add(table_length).map(|end| end > data.len()).unwrap_or(true) {
            return Err(format!("字体表 {} 越界", String::from_utf8_lossy(tag)));
        }

        let out_rec = 12 + i * 16;
        let current = out.len() as u32;
        out[out_rec + 8..out_rec + 12].copy_from_slice(&current.to_be_bytes());
        out.extend_from_slice(&data[table_offset..table_offset + table_length]);
        let pad = (4 - (table_length % 4)) % 4;
        out.extend(std::iter::repeat(0u8).take(pad));
    }

    if !has_glyf {
        return Err("字体没有 glyf 表".into());
    }
    Ok(out)
}

pub(super) fn first_usable_ttf(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 4 {
        return Err("字体文件过小".into());
    }
    if &data[0..4] != b"ttcf" {
        return extract_ttf_face(data, 0);
    }

    let num_fonts = read_u32(data, 8)? as usize;
    let mut last_err = "字体集合中没有可用的 TrueType 字重".to_string();
    for index in 0..num_fonts {
        match extract_ttf_face(data, index) {
            Ok(ttf) => return Ok(ttf),
            Err(err) => last_err = err,
        }
    }
    Err(last_err)
}

pub(super) fn cjk_font_candidates() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return vec![
            PathBuf::from("/System/Library/Fonts/Supplemental/Songti.ttc"),
            PathBuf::from("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
            PathBuf::from("/Library/Fonts/Arial Unicode.ttf"),
            PathBuf::from("/System/Library/Fonts/STHeiti Light.ttc"),
        ];
    }

    #[cfg(target_os = "windows")]
    {
        let fonts = std::env::var_os("WINDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("Fonts");
        return ["simhei.ttf", "simkai.ttf", "simfang.ttf", "simsun.ttc", "msyh.ttf", "msyh.ttc"]
            .into_iter()
            .map(|name| fonts.join(name))
            .collect();
    }

    #[cfg(target_os = "linux")]
    {
        return [
            "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
            "/usr/share/fonts/truetype/droid/DroidSansFallback.ttf",
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/truetype/arphic/uming.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        ]
        .into_iter()
        .map(PathBuf::from)
        .collect();
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Vec::new()
    }
}

pub(super) fn load_cjk_system_font_inner() -> Result<SystemCjkFont, String> {
    let mut last_err = "未找到系统中文字体".to_string();
    for path in cjk_font_candidates() {
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) => {
                last_err = format!("读取 {} 失败: {err}", path.display());
                continue;
            }
        };
        match first_usable_ttf(&bytes) {
            Ok(ttf) => {
                println!(
                    "[zerror] PDF 使用系统字体: {} ({} bytes)",
                    path.display(),
                    ttf.len()
                );
                return Ok(SystemCjkFont {
                    family: "SystemCJK".into(),
                    data: general_purpose::STANDARD.encode(ttf),
                });
            }
            Err(err) => {
                last_err = format!("{}: {err}", path.display());
            }
        }
    }
    Err(last_err)
}

/// 读取系统自带的中文 TrueType 字体，供 PDF 导出嵌入。集合字体（.ttc）会抽出第一个可用字重。
#[tauri::command]
pub fn load_cjk_system_font() -> Result<SystemCjkFont, String> {
    if let Some(font) = CJK_SYSTEM_FONT.get() {
        return Ok(font.clone());
    }
    let font = load_cjk_system_font_inner()?;
    Ok(CJK_SYSTEM_FONT.get_or_init(|| font.clone()).clone())
}
