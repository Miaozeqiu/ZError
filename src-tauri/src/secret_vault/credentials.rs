//! credentials implementation; the parent module preserves the public facade.
use super::*;

#[tauri::command]
pub async fn secure_register(
    webview: tauri::Webview,
    site: String,
    fields: BTreeMap<String, String>,
) -> Result<Value, String> {
    trusted_webview(&webview)?;
    storage_task(move || register_inner(site, fields)).await
}

pub(super) fn register_inner(site: String, fields: BTreeMap<String, String>) -> Result<Value, String> {
    register_site_fields(site, fields, None)
}

// Called by the desktop credential form, separate from registration of secrets found in messages.
#[tauri::command]
pub async fn secure_save_chat_login(
    webview: tauri::Webview,
    site: String,
    login_origin: String,
    account: String,
    password: String,
) -> Result<(), String> {
    trusted_webview(&webview)?;
    let fields = BTreeMap::from([("account".into(), account), ("password".into(), password)]);
    storage_task(move || register_site_fields(site, fields, Some(&login_origin)).map(|_| ())).await
}

pub(super) fn register_site_fields(site: String, fields: BTreeMap<String, String>, login_origin: Option<&str>) -> Result<Value, String> {
    if site.is_empty()
        || site.len() > 253
        || !site
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
    {
        return Err("网站标识无效".into());
    }
    with_vault(true, |v| {
        if let Some(target) = login_origin {
            if !site_origins(&site).iter().any(|allowed| allowed == target) {
                return Err("此登录域名未获准使用该网站的凭据".into());
            }
        }
        let pending = login_origin.is_none() && !approved_site(v, &site);
        let site = if pending && !site.starts_with("pending-") {
            format!("pending-{}", uuid::Uuid::new_v4())
        } else {
            site.clone()
        };
        let clear_password = !fields.contains_key("password")
            && fields
                .get("account")
                .is_some_and(|value| account_changed(v, &site, value));
        let mut references = serde_json::Map::new();
        for (field, value) in fields {
            if !["account", "password"].contains(&field.as_str())
                || value.is_empty()
                || value.len() > 8192
            {
                return Err("凭据字段无效".into());
            }
            references.insert(
                field.clone(),
                Value::String(put_secret(
                    v,
                    &format!("site/{}/{}", site, field),
                    &value,
                    "site",
                    site_origins(&site),
                )?),
            );
        }
        let mut row = v
            .documents
            .get("site_accounts")
            .and_then(|d| d.get(&site))
            .cloned()
            .unwrap_or(json!({"note":""}));
        for (key, value) in &references {
            row[key] = value.clone();
        }
        if clear_password {
            row["password"] = json!("");
            v.secrets.remove(&format!("site/{}/password", site));
        }
        row["accountLabel"] = json!("已保存账号");
        row["updatedAt"] = json!(chrono::Utc::now().timestamp_millis());
        if !v.documents.contains_key("site_accounts") {
            v.documents.insert("site_accounts".into(), json!({}));
        }
        v.documents.get_mut("site_accounts").unwrap()[&site] = row;
        scrub_stored_chats(v);
        Ok(json!({"ok":true,"site":site,"pending":pending,"references":references}))
    })
}

pub fn resolve(reference: &str, kind: &str, target: &str) -> Result<Zeroizing<String>, String> {
    with_vault(false, |v| resolve_in_vault(v, reference, kind, target))
}

#[cfg(any(windows, target_os = "macos"))]
pub(crate) fn resolve_site_input(
    reference: &str,
    target: &str,
    password_input: bool,
) -> Result<Zeroizing<String>, String> {
    with_vault(false, |vault| {
        let canonical = vault.aliases.get(reference).map(String::as_str).unwrap_or(reference);
        let id = token_id(canonical).ok_or("无效的凭据变量")?;
        let field = if password_input { "/password" } else { "/account" };
        if !id.starts_with("site/") || !id.ends_with(field) {
            return Err("凭据类型与输入框不匹配，已阻止填写".into());
        }
        resolve_in_vault(vault, reference, "site", target)
    })
}

// Username display is a separate UI projection: no secret-reference argument and
// no password/API entries can be selected through this command.
pub(super) fn site_account_names_in_vault(vault: &Vault) -> BTreeMap<String, String> {
    let mut names = BTreeMap::new();
    if let Some(rows) = vault.documents.get("site_accounts").and_then(Value::as_object) {
        for (site, row) in rows {
            let Some(reference) = row.get("account").and_then(Value::as_str) else { continue; };
            let reference = vault.aliases.get(reference).map(String::as_str).unwrap_or(reference);
            let Some(id) = token_id(reference) else { continue; };
            if id != format!("site/{}/account", site) { continue; }
            if let Some(secret) = vault.secrets.get(id).filter(|secret| secret.kind == "site") {
                names.insert(site.clone(), secret.value.clone());
            }
        }
    }
    names
}

// Mutate only these website records under the vault lock. Other windows may
// have saved new credentials since the settings page loaded its account list.
#[tauri::command]
pub async fn secure_remove_site_accounts(webview: tauri::Webview, ids: Vec<String>) -> Result<(), String> {
    trusted_webview(&webview)?;
    if ids.is_empty() || ids.iter().any(|id| id.is_empty() || id.len() > 253 ||
        !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')) {
        return Err("无效的网站标识".into());
    }
    storage_task(move || with_vault(true, |vault| {
        if let Some(rows) = vault.documents.get_mut("site_accounts").and_then(Value::as_object_mut) {
            for id in &ids { rows.remove(id); }
        }
        for id in &ids {
            for field in ["account", "password"] {
                let key = format!("site/{id}/{field}");
                let reference = token(&key);
                vault.secrets.remove(&key);
                vault.retired.retain(|(_, target)| target != &reference);
                vault.aliases.retain(|alias, target| alias != &reference && target != &reference);
            }
        }
        Ok(())
    })).await
}

#[tauri::command]
pub async fn secure_site_account_names(webview: tauri::Webview) -> Result<BTreeMap<String, String>, String> {
    trusted_webview(&webview)?;
    storage_task(|| with_vault(false, |vault| Ok(site_account_names_in_vault(vault)))).await
}

pub(super) fn site_password_length(vault: &Vault, reference: &str) -> Result<usize, String> {
    let reference = vault.aliases.get(reference).map(String::as_str).unwrap_or(reference);
    let id = token_id(reference).ok_or("无效的凭据变量")?;
    let password = vault.secrets.get(id)
        .filter(|secret| secret.kind == "site" && id.starts_with("site/") && id.ends_with("/password"))
        .ok_or("网站密码已删除或尚未配置")?;
    Ok(password.value.chars().count())
}

#[tauri::command]
pub async fn secure_site_password_length(webview: tauri::Webview, reference: String) -> Result<usize, String> {
    trusted_webview(&webview)?;
    storage_task(move || with_vault(false, |vault| site_password_length(vault, &reference))).await
}

#[tauri::command]
pub async fn secure_api_key_length(
    webview: tauri::Webview,
    reference: String,
) -> Result<usize, String> {
    trusted_webview(&webview)?;
    storage_task(move || {
        with_vault(false, |vault| {
            let id = token_id(&reference).ok_or("无效的凭据变量")?;
            let key = vault
                .secrets
                .get(id)
                .filter(|secret| secret.kind == "api")
                .ok_or("API Key 已删除或尚未配置")?;
            Ok(key.value.chars().count())
        })
    })
    .await
}

// User-only retrieval. Never expose this as an IPC command or call from Agent tools.
// The native verification boundary in secret_access must authorize every use.
pub(crate) fn value_for_verified_user(reference: &str) -> Result<Zeroizing<String>, String> {
    with_vault(false, |v| {
        let reference = v
            .aliases
            .get(reference)
            .map(String::as_str)
            .unwrap_or(reference);
        let id = token_id(reference).ok_or("无效的凭据变量")?;
        let secret = v.secrets.get(id).ok_or("凭据已删除或尚未配置")?;
        if !["site", "api"].contains(&secret.kind.as_str()) {
            return Err("不支持查看此凭据".into());
        }
        Ok(Zeroizing::new(secret.value.clone()))
    })
}

pub(super) fn resolve_in_vault(
    v: &Vault,
    reference: &str,
    kind: &str,
    target: &str,
) -> Result<Zeroizing<String>, String> {
    let reference = v
        .aliases
        .get(reference)
        .map(String::as_str)
        .unwrap_or(reference);
    let id = token_id(reference).ok_or("无效的凭据变量")?;
    let secret = v.secrets.get(id).ok_or("凭据已删除或尚未配置")?;
    let origin = origin(target).ok_or("目标地址无效")?;
    if secret.kind != kind || !secret.origins.contains(&origin) {
        return Err("凭据与当前网站或服务不匹配，已阻止填写或发送".into());
    }
    // Stored credentials may predate a domain removal.
    if kind == "site" && !id.split('/').nth(1).is_some_and(|site| site_origins(site).contains(&origin)) {
        return Err("凭据与当前网站或服务不匹配，已阻止填写或发送".into());
    }
    Ok(Zeroizing::new(secret.value.clone()))
}

#[tauri::command]
pub async fn secure_register_api(
    webview: tauri::Webview,
    provider: String,
    value: String,
) -> Result<Value, String> {
    trusted_webview(&webview)?;
    storage_task(move || register_api_inner(provider, value)).await
}

pub(super) fn register_api_inner(provider: String, value: String) -> Result<Value, String> {
    if value.is_empty() || value.len() > 8192 {
        return Err("API Key 无效".into());
    }
    with_vault(true, |v| {
        let search_provider = SEARCH_API_KEYS
            .iter()
            .find(|(id, _, _)| provider.strip_prefix("search/") == Some(*id))
            .copied();
        let (id, origins) = if let Some((_, field, endpoint)) = search_provider {
            (format!("search/{}", field), vec![endpoint.into()])
        } else {
            let platform = v
                .documents
                .get("model_settings")
                .and_then(|d| d["platforms"].as_array())
                .and_then(|rows| rows.iter().find(|p| p["id"].as_str() == Some(&provider)));
            let endpoint = platform
                .and_then(|p| p["baseUrl"].as_str())
                .and_then(origin)
                .ok_or("请先在设置中配置对应模型平台，再登记 API Key")?;
            if platform.is_some_and(is_official_deepseek) {
                (DEEPSEEK_KEY_ID.into(), vec![endpoint])
            } else {
                (format!("model/{}/apiKey", provider), vec![endpoint])
            }
        };
        let reference = put_secret(v, &id, &value, "api", origins)?;
        if id == DEEPSEEK_KEY_ID {
            let settings = v.documents.entry("model_settings".into())
                .or_insert_with(|| json!({"platforms": []}));
            settings[DEEPSEEK_KEY_FIELD] = json!(reference);
        } else if let Some((_, field, _)) = search_provider {
            if let Some(settings) = v.documents.get_mut("app_settings") {
                settings["search"][field] = json!(reference);
            }
        } else if let Some(rows) = v
            .documents
            .get_mut("model_settings")
            .and_then(|d| d["platforms"].as_array_mut())
        {
            if let Some(platform) = rows
                .iter_mut()
                .find(|p| p["id"].as_str() == Some(&provider))
            {
                platform["apiKey"] = json!(reference);
            }
        }
        scrub_stored_chats(v);
        Ok(json!({"ok":true,"references":{"api_key":reference}}))
    })
}
