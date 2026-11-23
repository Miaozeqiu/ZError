//! migration implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn legacy_paths(name: &str) -> Vec<PathBuf> {
    let exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(std::path::Path::to_path_buf));
    match name {
        "site_accounts" => vec![root().join("site-accounts.json")],
        "auth" => {
            let stable = root().join("auth.json");
            let mut paths = vec![stable.clone()];
            if let Some(path) = exe.map(|p| p.join("auth.json")) {
                if path != stable {
                    paths.push(path);
                }
            }
            paths
        }
        "model_settings" | "app_settings" => exe
            .map(|p| {
                p.join(if name == "model_settings" {
                    "model_config.json"
                } else {
                    "config.json"
                })
            })
            .into_iter()
            .collect(),
        _ => vec![],
    }
}

pub(super) fn retire_legacy(name: &str) -> Result<(), String> {
    for path in legacy_paths(name) {
        if path.exists() {
            let bytes = Zeroizing::new(std::fs::read(&path).map_err(|_| "无法读取旧配置")?);
            let backup = root().join("secure/migration").join(format!(
                "{}-{}.enc",
                name,
                uuid::Uuid::new_v4()
            ));
            let cipher = with_key(|key| seal(key, name, &bytes))?;
            atomic_write(&backup, cipher.as_bytes())?;
            with_key(|key| {
                if open(
                    key,
                    name,
                    &std::fs::read_to_string(&backup).map_err(|_| "迁移备份无法读取")?,
                )?
                .as_slice()
                    != bytes.as_slice()
                {
                    return Err("加密迁移备份校验失败".into());
                }
                Ok(())
            })?;
            std::fs::remove_file(path).map_err(|_| "旧明文配置清理失败")?;
        }
    }
    Ok(())
}

pub(super) fn scrub_stored_chats(v: &mut Vault) {
    if let Some(mut chats) = v.documents.remove("agent_chats") {
        redact_value(v, &mut chats);
        v.documents.insert("agent_chats".into(), chats);
    }
}

#[tauri::command]
pub async fn secure_archive_legacy(
    webview: tauri::Webview,
    values: BTreeMap<String, Value>,
) -> Result<(), String> {
    trusted_webview(&webview)?;
    storage_task(move || archive_legacy_inner(values)).await
}

pub(super) fn archive_legacy_inner(values: BTreeMap<String, Value>) -> Result<(), String> {
    with_vault(true, |v| {
        for (name, value) in values {
            if !name.starts_with("zerror-site-accounts-") {
                return Err("不支持的旧存储名称".into());
            }
            v.documents
                .entry("legacy_archives".into())
                .or_insert(json!({}))[name] = value;
        }
        Ok(())
    })
}

pub(super) fn archive_file(path: &std::path::Path) -> Result<(), String> {
    let bytes = Zeroizing::new(std::fs::read(path).map_err(|_| "旧敏感文件无法读取")?);
    let archive = root()
        .join("secure/migration")
        .join(format!("archive-{}.enc", uuid::Uuid::new_v4()));
    let encrypted = with_key(|key| seal(key, "legacy-archive", &bytes))?;
    atomic_write(&archive, encrypted.as_bytes())?;
    with_key(|key| {
        let check = std::fs::read_to_string(&archive).map_err(|_| "迁移归档无法读取")?;
        if open(key, "legacy-archive", &check)?.as_slice() != bytes.as_slice() {
            return Err("加密归档校验失败".into());
        }
        Ok(())
    })?;
    std::fs::remove_file(path).map_err(|_| "旧敏感文件清理失败".to_string())
}

pub(super) fn clean_tree(dir: &std::path::Path, mode: &str, depth: usize) -> Result<usize, String> {
    if depth > 12 || !dir.exists() {
        return Ok(0);
    }
    let mut count = 0;
    for entry in std::fs::read_dir(dir).map_err(|_| "无法扫描旧敏感文件")? {
        let entry = entry.map_err(|_| "无法扫描旧敏感文件")?;
        let kind = entry.file_type().map_err(|_| "无法识别旧文件")?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            count += clean_tree(&entry.path(), mode, depth + 1)?;
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if mode == "logs"
            || (mode == "accounts" && name.starts_with("site-accounts") && name.ends_with(".json"))
        {
            archive_file(&entry.path())?;
            count += 1;
        } else if mode == "skills"
            && ["md", "json"].contains(
                &entry
                    .path()
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or(""),
            )
        {
            let raw = std::fs::read_to_string(entry.path()).map_err(|_| "旧经验文件无法读取")?;
            let safe = with_vault(false, |v| Ok(redact_text(v, &raw)))?;
            if safe != raw {
                // Encrypted recovery copy must exist before replacing an old experience file.
                let encrypted = with_key(|key| seal(key, "legacy-archive", raw.as_bytes()))?;
                atomic_write(
                    &root()
                        .join("secure/migration")
                        .join(format!("experience-{}.enc", uuid::Uuid::new_v4())),
                    encrypted.as_bytes(),
                )?;
                atomic_write(&entry.path(), safe.as_bytes())?;
                count += 1;
            }
        }
    }
    Ok(count)
}

#[tauri::command]
pub async fn secure_cleanup_legacy(webview: tauri::Webview) -> Result<Value, String> {
    trusted_webview(&webview)?;
    tauri::async_runtime::spawn_blocking(cleanup_legacy)
        .await
        .map_err(|_| "敏感数据迁移任务失败".to_string())?
}

pub(super) fn cleanup_legacy() -> Result<Value, String> {
    let mut count = clean_tree(&root().join("backups"), "accounts", 0)?;
    for directory in ["skills", "skill-overrides"] {
        count += clean_tree(&root().join(directory), "skills", 0)?;
    }
    #[cfg(debug_assertions)]
    {
        let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("开发目录无效")?;
        count += clean_tree(&project.join("logs/agent-chat"), "logs", 0)?;
    }
    Ok(json!({"ok":true,"files":count}))
}

#[tauri::command]
pub async fn secure_bind_pending(
    webview: tauri::Webview,
    pending: String,
    site: String,
) -> Result<Value, String> {
    trusted_webview(&webview)?;
    storage_task(move || bind_pending_inner(pending, site)).await
}

pub(super) fn bind_pending_inner(pending: String, site: String) -> Result<Value, String> {
    if !pending.starts_with("pending-")
        || site.starts_with("pending-")
        || site.is_empty()
        || site.len() > 253
        || !site
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
    {
        return Err("待关联凭据或网站无效".into());
    }
    with_vault(true, |v| {
        let mut row = v
            .documents
            .get("site_accounts")
            .and_then(|d| d.get(&site))
            .cloned()
            .unwrap_or(json!({"note":""}));
        let clear_password = !v
            .secrets
            .contains_key(&format!("site/{}/password", pending))
            && v.secrets
                .get(&format!("site/{}/account", pending))
                .is_some_and(|secret| account_changed(v, &site, &secret.value));
        let mut count = 0;
        for field in ["account", "password"] {
            let old_id = format!("site/{}/{}", pending, field);
            if let Some(secret) = v.secrets.get(&old_id).cloned() {
                let reference = put_secret(
                    v,
                    &format!("site/{}/{}", site, field),
                    &secret.value,
                    "site",
                    site_origins(&site),
                )?;
                v.aliases.insert(token(&old_id), reference.clone());
                for (_, retired) in &mut v.retired {
                    if *retired == token(&old_id) {
                        *retired = reference.clone();
                    }
                }
                row[field] = json!(reference);
                v.secrets.remove(&old_id);
                count += 1;
            }
        }
        if count == 0 {
            return Err("待关联凭据不存在".into());
        }
        if clear_password {
            row["password"] = json!("");
            v.secrets.remove(&format!("site/{}/password", site));
        }
        row["accountLabel"] = json!("已保存账号");
        row["updatedAt"] = json!(chrono::Utc::now().timestamp_millis());
        v.documents
            .get_mut("site_accounts")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove(&pending);
        v.documents.get_mut("site_accounts").unwrap()[&site] = row;
        scrub_stored_chats(v);
        Ok(json!({"ok":true}))
    })
}
