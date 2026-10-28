//! Sensitive data never goes to ordinary configuration files. The encryption key is
//! owned by the OS credential store; only ciphertext is written to the app directory.
use base64::{engine::general_purpose::STANDARD, Engine};
use parking_lot::Mutex;
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::OnceLock,
};
use zeroize::Zeroizing;

const SERVICE: &str = "cc.zerror.credentials";
const KEY_ACCOUNT: &str = "vault-master-v1";
const PREFIX: &str = "zerror-secure-v1:";
#[derive(Default, Serialize, Deserialize)]
struct Vault {
    #[serde(default)]
    legacy_imported: BTreeSet<String>,
    #[serde(default)]
    documents: BTreeMap<String, Value>,
    #[serde(default)]
    secrets: BTreeMap<String, Secret>,
    #[serde(default)]
    retired: Vec<(String, String)>,
    #[serde(default)]
    aliases: BTreeMap<String, String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Secret {
    value: String,
    kind: String,
    origins: Vec<String>,
}
static CACHE: OnceLock<Mutex<Option<Vault>>> = OnceLock::new();
#[derive(Default)]
struct MasterState {
    key: Option<Zeroizing<Vec<u8>>>,
    error: Option<String>,
}
impl MasterState {
    fn obtain(&mut self, load: impl FnOnce() -> Result<Vec<u8>, String>) -> Result<&[u8], String> {
        if self.key.is_none() {
            if let Some(error) = &self.error {
                return Err(error.clone());
            }
            match load() {
                Ok(key) => self.key = Some(Zeroizing::new(key)),
                Err(error) => {
                    self.error = Some(error.clone());
                    return Err(error);
                }
            }
        }
        Ok(self.key.as_ref().unwrap())
    }
}
static MASTER: OnceLock<Mutex<MasterState>> = OnceLock::new();
fn root() -> PathBuf {
    #[cfg(test)]
    {
        return std::env::temp_dir().join(format!("zerror-vault-tests-{}", std::process::id()));
    }
    #[cfg(windows)]
    let home = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("ZError");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join(".local/share/zerror");
    home
}
fn vault_path() -> PathBuf {
    root().join("secure/vault.enc")
}
fn random_key() -> Result<Vec<u8>, String> {
    let mut key = vec![0; 32];
    SystemRandom::new()
        .fill(&mut key)
        .map_err(|_| "无法生成安全密钥")?;
    Ok(key)
}
#[cfg(all(target_os = "macos", not(test)))]
fn os_key(create: bool) -> Result<Vec<u8>, String> {
    crate::secret_keychain::load(
        SERVICE,
        create,
        crate::secret_keychain::Access::Background,
        random_key,
        validate_master,
    )
}
fn validate_master(key: &[u8]) -> Result<(), String> {
    if key.len() != 32 {
        return Err("系统加密密钥无效，原数据已保留".into());
    }
    if vault_path().exists() {
        let data = std::fs::read_to_string(vault_path()).map_err(|_| "无法读取安全存储")?;
        open(key, "vault", &data)?;
    }
    Ok(())
}
#[cfg(all(windows, not(test)))]
fn os_key(create: bool) -> Result<Vec<u8>, String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::LocalFree,
            Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB},
        },
    };
    let path = root().join("secure/master.dpapi");
    let encrypted = if path.exists() {
        std::fs::read(&path).map_err(|_| "无法读取受保护密钥")?
    } else {
        if !create {
            return Err("系统加密密钥缺失".into());
        }
        let key = Zeroizing::new(random_key()?);
        let input = CRYPT_INTEGER_BLOB {
            cbData: key.len() as u32,
            pbData: key.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe { CryptProtectData(&input, PCWSTR::null(), None, None, None, 0, &mut output) }
            .map_err(|_| "Windows 数据保护服务不可用")?;
        let bytes =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            let _ = LocalFree(windows::Win32::Foundation::HLOCAL(output.pbData as *mut _));
        }
        atomic_write(&path, &bytes)?;
        bytes
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptUnprotectData(&input, None, None, None, None, 0, &mut output) }
        .map_err(|_| "Windows 无法解锁凭据")?;
    let key = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(output.pbData as *mut _));
    }
    Ok(key)
}
#[cfg(all(target_os = "linux", not(test)))]
fn os_key(create: bool) -> Result<Vec<u8>, String> {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let found = Command::new("secret-tool")
        .args(["lookup", "application", SERVICE, "key", KEY_ACCOUNT])
        .output()
        .map_err(|_| "需要可用的系统 Secret Service 和 secret-tool")?;
    if found.status.success() && !found.stdout.is_empty() {
        return STANDARD
            .decode(String::from_utf8_lossy(&found.stdout).trim())
            .map_err(|_| "系统密钥格式错误".into());
    }
    if !create {
        return Err("系统密钥不存在或尚未解锁".into());
    }
    let key = random_key()?;
    let mut child = Command::new("secret-tool")
        .args([
            "store",
            "--label=ZError secure storage",
            "application",
            SERVICE,
            "key",
            KEY_ACCOUNT,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法访问系统 Secret Service")?;
    child
        .stdin
        .take()
        .ok_or("无法写入系统凭据")?
        .write_all(STANDARD.encode(&key).as_bytes())
        .map_err(|_| "无法保存系统凭据")?;
    if !child.wait().map_err(|_| "系统凭据保存失败")?.success() {
        return Err("系统凭据保存失败；不会退回明文存储".into());
    }
    Ok(key)
}
#[cfg(all(not(test), not(any(target_os = "macos", target_os = "linux", windows))))]
fn os_key(_: bool) -> Result<Vec<u8>, String> {
    Err("当前平台不支持安全存储".into())
}
#[cfg(test)]
fn os_key(_: bool) -> Result<Vec<u8>, String> {
    static TEST_KEY: OnceLock<Vec<u8>> = OnceLock::new();
    Ok(TEST_KEY.get_or_init(|| random_key().unwrap()).clone())
}
fn with_key<T>(f: impl FnOnce(&[u8]) -> Result<T, String>) -> Result<T, String> {
    let mut state = MASTER
        .get_or_init(|| Mutex::new(MasterState::default()))
        .lock();
    f(state.obtain(|| os_key(!vault_path().exists()))?)
}
#[tauri::command]
pub async fn secure_storage_authorize(window: tauri::WebviewWindow) -> Result<(), String> {
    trusted_window(&window)?;
    if !window.is_focused().unwrap_or(false) {
        return Err("请在软件前台主动恢复安全存储授权".into());
    }
    storage_task(|| {
        let mut state = MASTER
            .get_or_init(|| Mutex::new(MasterState::default()))
            .lock();
        if state.key.is_some() {
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        let key = crate::secret_keychain::load(
            SERVICE,
            !vault_path().exists(),
            crate::secret_keychain::Access::UserRecovery,
            random_key,
            validate_master,
        )?;
        #[cfg(not(target_os = "macos"))]
        let key = os_key(!vault_path().exists())?;
        state.key = Some(Zeroizing::new(key));
        state.error = None;
        Ok(())
    })
    .await
}
fn seal(key: &[u8], name: &str, value: &[u8]) -> Result<String, String> {
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| "加密密钥无效")?,
    );
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "安全随机源不可用")?;
    let mut bytes = value.to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(name.as_bytes()),
        &mut bytes,
    )
    .map_err(|_| "加密失败")?;
    let mut output = nonce.to_vec();
    output.extend(bytes);
    Ok(format!("{}{}", PREFIX, STANDARD.encode(output)))
}
fn open(key: &[u8], name: &str, value: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let mut bytes = Zeroizing::new(
        STANDARD
            .decode(value.strip_prefix(PREFIX).ok_or("不是安全存储格式")?)
            .map_err(|_| "密文格式错误")?,
    );
    if bytes.len() < 28 {
        return Err("密文已损坏".into());
    }
    let nonce = aead::Nonce::try_assume_unique_for_key(&bytes[..12]).map_err(|_| "密文已损坏")?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| "加密密钥无效")?,
    );
    let plain = key
        .open_in_place(nonce, aead::Aad::from(name.as_bytes()), &mut bytes[12..])
        .map_err(|_| "解密校验失败，原数据已保留")?;
    Ok(Zeroizing::new(plain.to_vec()))
}
fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("存储路径无效")?;
    std::fs::create_dir_all(parent).map_err(|_| "无法创建安全存储目录")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护存储目录")?;
    }
    let tmp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&tmp).map_err(|_| "无法写入安全存储")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "安全存储写入失败")?;
        std::fs::rename(&tmp, path).map_err(|_| "无法替换安全存储文件")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result
}
fn with_vault<T>(
    write: bool,
    f: impl FnOnce(&mut Vault) -> Result<T, String>,
) -> Result<T, String> {
    let mut cache = CACHE.get_or_init(|| Mutex::new(None)).lock();
    if cache.is_none() {
        *cache = Some(if vault_path().exists() {
            let data = std::fs::read_to_string(vault_path()).map_err(|_| "无法读取安全存储")?;
            with_key(|key| {
                serde_json::from_slice(&open(key, "vault", &data)?)
                    .map_err(|_| "安全存储内容损坏".into())
            })?
        } else {
            with_key(|_| Ok(Vault::default()))?
        });
    }
    // Roll back in-memory changes too when the durable write fails.
    let before = if write {
        Some(Zeroizing::new(
            serde_json::to_vec(cache.as_ref().unwrap()).map_err(|_| "凭据序列化失败")?,
        ))
    } else {
        None
    };
    let result = f(cache.as_mut().unwrap());
    if write {
        let saved = result
            .as_ref()
            .map(|_| ())
            .map_err(Clone::clone)
            .and_then(|_| {
                let plain = Zeroizing::new(
                    serde_json::to_vec(cache.as_ref().unwrap()).map_err(|_| "凭据序列化失败")?,
                );
                let encrypted = with_key(|key| seal(key, "vault", &plain))?;
                atomic_write(&vault_path(), encrypted.as_bytes())
            });
        if let Err(error) = saved {
            *cache = Some(serde_json::from_slice(&before.unwrap()).unwrap());
            return Err(error);
        }
    }
    result
}
fn token(id: &str) -> String {
    format!("{{{{secret:{}}}}}", id)
}
fn token_id(value: &str) -> Option<&str> {
    value.strip_prefix("{{secret:")?.strip_suffix("}}")
}
fn origin(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    if !["https", "http"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url.origin().ascii_serialization())
}
fn put_secret(
    v: &mut Vault,
    id: &str,
    value: &str,
    kind: &str,
    origins: Vec<String>,
) -> Result<String, String> {
    if value.is_empty() {
        v.secrets.remove(id);
        return Ok(String::new());
    }
    if let Some(previous) = token_id(value) {
        if previous != id || !v.secrets.contains_key(id) {
            return Err("凭据引用无效或已被删除".into());
        }
        v.secrets.get_mut(id).unwrap().origins = origins;
        return Ok(value.into());
    }
    if let Some(old) = v.secrets.get(id) {
        if old.value != value {
            v.retired.push((old.value.clone(), token(id)));
        }
    }
    v.secrets.insert(
        id.into(),
        Secret {
            value: value.into(),
            kind: kind.into(),
            origins,
        },
    );
    Ok(token(id))
}
fn account_changed(v: &Vault, site: &str, value: &str) -> bool {
    let id = format!("site/{}/account", site);
    v.secrets
        .get(&id)
        .is_some_and(|old| old.value != value && token(&id) != value)
}
fn redact_text(v: &Vault, text: &str) -> String {
    static TOKENS: OnceLock<regex::Regex> = OnceLock::new();
    let re = TOKENS.get_or_init(|| regex::Regex::new(r"\{\{secret:[^{}]+\}\}").unwrap());
    let mut entries: Vec<(String, String)> = v
        .secrets
        .iter()
        .map(|(id, s)| (s.value.clone(), token(id)))
        .chain(v.retired.iter().cloned())
        .filter(|(s, _)| !s.is_empty())
        .collect();
    entries.sort_by_key(|(s, _)| std::cmp::Reverse(s.len()));
    let matcher = regex::Regex::new(
        &entries
            .iter()
            .map(|(value, _)| regex::escape(value))
            .collect::<Vec<_>>()
            .join("|"),
    );
    let replace = |part: &str| {
        if entries.is_empty() {
            return part.to_owned();
        }
        matcher
            .as_ref()
            .unwrap()
            .replace_all(part, |caps: &regex::Captures| {
                let matched = caps.get(0).unwrap();
                let value = matched.as_str();
                if value.len() <= 3
                    && (part[..matched.start()]
                        .chars()
                        .next_back()
                        .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
                        || part[matched.end()..]
                            .chars()
                            .next()
                            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_'))
                {
                    return value.to_string();
                }
                entries
                    .iter()
                    .find(|(source, _)| source == value)
                    .unwrap()
                    .1
                    .clone()
            })
            .into_owned()
    };
    let mut out = String::new();
    let mut start = 0;
    for m in re.find_iter(text) {
        out.push_str(&replace(&text[start..m.start()]));
        out.push_str(
            v.aliases
                .get(m.as_str())
                .map(String::as_str)
                .unwrap_or(m.as_str()),
        );
        start = m.end();
    }
    out.push_str(&replace(&text[start..]));
    out
}
fn redact_value(v: &Vault, data: &mut Value) {
    match data {
        Value::String(s) => {
            if let Ok(mut nested) = serde_json::from_str::<Value>(s) {
                if nested.is_object() || nested.is_array() {
                    redact_value(v, &mut nested);
                    *s = nested.to_string();
                    return;
                }
            }
            *s = redact_text(v, s);
        }
        Value::Array(rows) => rows.iter_mut().for_each(|row| redact_value(v, row)),
        Value::Object(rows) => rows
            .iter_mut()
            .filter(|(key, _)| {
                !["id", "name", "role", "tool_call_id", "source_message_id"].contains(&key.as_str())
            })
            .for_each(|(_, row)| redact_value(v, row)),
        _ => {}
    }
}
fn site_origins(site: &str) -> Vec<String> {
    if site.starts_with("pending-") {
        return vec![];
    }
    let primary = match site {
        "chaoxing" => "chaoxing.com",
        "zhihuishu" => "zhihuishu.com",
        "zjooc" => "zjooc.cn",
        other => other,
    };
    let mut hosts = vec![primary.to_string(), format!("www.{}", primary)];
    match site {
        "chaoxing" => hosts.push("passport2.chaoxing.com".into()),
        "zhihuishu" => hosts.extend(["passport.zhihuishu.com".into(), "cas.zhihuishu.com".into()]),
        "zjooc" => hosts.push("background.zjooc.cn".into()),
        "menhu.haou.edu.cn" => hosts.push("authserver.open.ha.cn".into()),
        _ => {}
    }
    // This file is user configuration, never the learned site graph.
    if let Ok(raw) = std::fs::read_to_string(root().join("website-identities.json")) {
        if let Ok(data) = serde_json::from_str::<Value>(&raw) {
            if let Some(rows) = data["profiles"].as_array() {
                for row in rows {
                    if row["host"].as_str() == Some(primary)
                        && (row["credentialsApproved"] == true
                            || row.get("credentialsApproved").is_none())
                    {
                        if let Some(aliases) = row["loginHosts"].as_array() {
                            hosts.extend(
                                aliases.iter().filter_map(Value::as_str).map(str::to_string),
                            );
                        }
                    }
                }
            }
        }
    }
    hosts
        .iter()
        .filter_map(|host| origin(&format!("https://{}", host)))
        .collect()
}
fn approved_site(v: &Vault, site: &str) -> bool {
    if ["chaoxing", "zhihuishu", "zjooc", "menhu.haou.edu.cn"].contains(&site) {
        return true;
    }
    if v.secrets.iter().any(|(id, secret)| {
        id.starts_with(&format!("site/{}/", site)) && !secret.origins.is_empty()
    }) {
        return true;
    }
    let profiles = std::fs::read_to_string(root().join("website-identities.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    profiles
        .and_then(|data| data["profiles"].as_array().cloned())
        .is_some_and(|rows| {
            rows.iter()
                .any(|row| row["host"].as_str() == Some(site) && row["credentialsApproved"] == true)
        })
}
fn canonical_site(site: &str) -> String {
    if site == "authserver.open.ha.cn" {
        return "menhu.haou.edu.cn".into();
    }
    if let Ok(raw) = std::fs::read_to_string(root().join("website-identities.json")) {
        if let Ok(data) = serde_json::from_str::<Value>(&raw) {
            if let Some(rows) = data["profiles"].as_array() {
                for row in rows {
                    if row["loginHosts"]
                        .as_array()
                        .is_some_and(|hosts| hosts.iter().any(|h| h.as_str() == Some(site)))
                    {
                        if let Some(host) = row["host"].as_str() {
                            return host.into();
                        }
                    }
                }
            }
        }
    }
    site.into()
}
fn merge_accounts(left: Value, right: Value) -> Value {
    let mut rows: BTreeMap<String, Value> = BTreeMap::new();
    for source in [left, right] {
        if let Some(source) = source.as_object() {
            for (site, next) in source {
                let id = canonical_site(site);
                let Some(previous) = rows.get(&id) else {
                    rows.insert(id, next.clone());
                    continue;
                };
                let different = previous["account"].as_str().is_some_and(|p| !p.is_empty())
                    && next["account"].as_str().is_some_and(|n| !n.is_empty())
                    && previous["account"] != next["account"];
                let newer = next["updatedAt"].as_i64().unwrap_or(0)
                    >= previous["updatedAt"].as_i64().unwrap_or(0);
                let complete =
                    |row: &Value| row["password"].as_str().is_some_and(|s| !s.is_empty());
                let mut chosen = if different && complete(previous) != complete(next) {
                    if complete(next) {
                        next.clone()
                    } else {
                        previous.clone()
                    }
                } else if newer {
                    next.clone()
                } else {
                    previous.clone()
                };
                if !different {
                    for field in ["account", "password"] {
                        if chosen[field].as_str().unwrap_or("").is_empty() {
                            chosen[field] = if newer {
                                previous[field].clone()
                            } else {
                                next[field].clone()
                            };
                        }
                    }
                }
                rows.insert(id, chosen);
            }
        }
    }
    serde_json::to_value(rows).unwrap()
}
fn protect_document(v: &mut Vault, name: &str, data: &mut Value) -> Result<(), String> {
    if name == "model_settings" {
        if let Some(platforms) = data["platforms"].as_array_mut() {
            for platform in platforms {
                let id = platform["id"]
                    .as_str()
                    .ok_or("模型平台缺少 id")?
                    .to_string();
                let origins: Vec<String> = origin(platform["baseUrl"].as_str().unwrap_or(""))
                    .into_iter()
                    .collect();
                if let Some(key) = platform["apiKey"].as_str() {
                    platform["apiKey"] = Value::String(put_secret(
                        v,
                        &format!("model/{}/apiKey", id),
                        key,
                        "api",
                        origins.clone(),
                    )?);
                }
                if let Some(headers) = platform["customHeaders"].as_object_mut() {
                    for (name, value) in headers {
                        if [
                            "authorization",
                            "x-api-key",
                            "api-key",
                            "api_key",
                            "x-auth-token",
                            "cookie",
                        ]
                        .contains(&name.to_ascii_lowercase().as_str())
                        {
                            if let Some(raw) = value.as_str() {
                                *value = json!(put_secret(
                                    v,
                                    &format!("model/{}/header/{}", id, name),
                                    raw,
                                    "api",
                                    origins.clone()
                                )?);
                            }
                        }
                    }
                }
            }
        }
    }
    if name == "app_settings" {
        for (field, endpoint) in [
            ("apiKey", "https://mcp.exa.ai"),
            ("deepseekApiKey", "https://api.deepseek.com"),
        ] {
            if let Some(key) = data["search"][field].as_str() {
                data["search"][field] = Value::String(put_secret(
                    v,
                    &format!("search/{}", field),
                    key,
                    "api",
                    vec![endpoint.into()],
                )?);
            }
        }
    }
    if name == "site_accounts" {
        *data = merge_accounts(data.clone(), Value::Null);
        if let Some(rows) = data.as_object_mut() {
            for (site, row) in rows {
                // An old password reference must not silently follow a different account.
                if row["account"]
                    .as_str()
                    .is_some_and(|value| account_changed(v, site, value))
                    && row["password"]
                        .as_str()
                        .is_some_and(|value| token_id(value).is_some())
                {
                    row["password"] = json!("");
                }
                for field in ["account", "password"] {
                    if let Some(value) = row[field].as_str() {
                        row[field] = Value::String(put_secret(
                            v,
                            &format!("site/{}/{}", site, field),
                            value,
                            "site",
                            site_origins(site),
                        )?);
                    }
                }
                row["accountLabel"] = Value::String(
                    if row["account"].as_str().unwrap_or("").is_empty() {
                        "未配置"
                    } else {
                        "已保存账号"
                    }
                    .into(),
                );
            }
        }
    }
    let live_ids: Option<Vec<String>> = if name == "site_accounts" {
        Some(
            data.as_object()
                .into_iter()
                .flat_map(|rows| rows.keys())
                .flat_map(|site| {
                    [
                        format!("site/{}/account", site),
                        format!("site/{}/password", site),
                    ]
                })
                .collect(),
        )
    } else if name == "model_settings" {
        Some(
            data["platforms"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|platform| {
                    let id = platform["id"].as_str().unwrap_or("");
                    let mut ids = vec![format!("model/{}/apiKey", id)];
                    if let Some(headers) = platform["customHeaders"].as_object() {
                        ids.extend(
                            headers
                                .keys()
                                .map(|key| format!("model/{}/header/{}", id, key)),
                        );
                    }
                    ids
                })
                .collect(),
        )
    } else {
        None
    };
    if let Some(live) = live_ids {
        let prefix = if name == "site_accounts" {
            "site/"
        } else {
            "model/"
        };
        v.secrets
            .retain(|id, _| !id.starts_with(prefix) || live.contains(id));
        v.retired.retain(|(_, reference)| {
            !reference.starts_with(&format!("{{{{secret:{}", prefix))
                || live.iter().any(|id| token(id) == *reference)
        });
    }
    if name == "agent_chats" {
        redact_value(v, data);
    }
    Ok(())
}
fn valid_document(name: &str) -> bool {
    [
        "model_settings",
        "app_settings",
        "site_accounts",
        "agent_chats",
        "auth",
    ]
    .contains(&name)
}
fn legacy_paths(name: &str) -> Vec<PathBuf> {
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
fn retire_legacy(name: &str) -> Result<(), String> {
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
fn scrub_stored_chats(v: &mut Vault) {
    if let Some(mut chats) = v.documents.remove("agent_chats") {
        redact_value(v, &mut chats);
        v.documents.insert("agent_chats".into(), chats);
    }
}
pub fn document_read(name: &str, legacy: Option<Value>) -> Result<Value, String> {
    if !valid_document(name) {
        return Err("无效的存储名称".into());
    }
    let value = with_vault(true, |v| {
        let importing = legacy.as_ref().is_some_and(|data| !data.is_null())
            && !v.legacy_imported.contains(name);
        if let Some(stored) = v.documents.get(name) {
            if !importing {
                return Ok(stored.clone());
            }
        }
        let mut file = v.documents.get(name).cloned();
        if file.is_none() {
            for path in legacy_paths(name) {
                if path.try_exists().map_err(|_| "无法检查旧配置文件")? {
                    file = Some(
                        serde_json::from_str::<Value>(
                            &std::fs::read_to_string(path)
                                .map_err(|_| "旧配置不可读取，原文件已保留")?,
                        )
                        .map_err(|_| "旧配置格式错误，原文件已保留")?,
                    );
                    break;
                }
            }
        }
        let legacy = if importing { legacy } else { None };
        let mut data = if name == "site_accounts" {
            merge_accounts(file.unwrap_or(Value::Null), legacy.unwrap_or(Value::Null))
        } else {
            legacy
                .filter(|v| !v.is_null())
                .or(file)
                .unwrap_or(Value::Null)
        };
        if !data.is_null() {
            protect_document(v, name, &mut data)?;
            if importing {
                v.legacy_imported.insert(name.into());
            }
            v.documents.insert(name.into(), data.clone());
            scrub_stored_chats(v);
        }
        Ok(data)
    })?;
    if !value.is_null() {
        retire_legacy(name)?;
    }
    Ok(value)
}
pub fn document_write(name: &str, mut value: Value) -> Result<Value, String> {
    if !valid_document(name) {
        return Err("无效的存储名称".into());
    }
    let data = with_vault(true, |v| {
        protect_document(v, name, &mut value)?;
        scrub_stored_chats(v);
        v.documents.insert(name.into(), value.clone());
        Ok(value)
    })?;
    retire_legacy(name)?;
    Ok(data)
}
async fn storage_task<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| "安全存储任务中断".to_string())?
}
#[tauri::command]
pub async fn secure_document_read(
    window: tauri::WebviewWindow,
    name: String,
    legacy: Option<Value>,
) -> Result<Value, String> {
    trusted_window(&window)?;
    storage_task(move || document_read(&name, legacy)).await
}
#[tauri::command]
pub async fn secure_document_write(
    window: tauri::WebviewWindow,
    name: String,
    value: Value,
) -> Result<Value, String> {
    trusted_window(&window)?;
    storage_task(move || document_write(&name, value)).await
}
#[tauri::command]
pub async fn secure_redact(window: tauri::WebviewWindow, value: Value) -> Result<Value, String> {
    trusted_window(&window)?;
    storage_task(move || redact(value)).await
}
#[tauri::command]
pub async fn secure_register(
    window: tauri::WebviewWindow,
    site: String,
    fields: BTreeMap<String, String>,
) -> Result<Value, String> {
    trusted_window(&window)?;
    storage_task(move || register_inner(site, fields)).await
}
fn register_inner(site: String, fields: BTreeMap<String, String>) -> Result<Value, String> {
    if site.is_empty()
        || site.len() > 253
        || !site
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
    {
        return Err("网站标识无效".into());
    }
    with_vault(true, |v| {
        let pending = !approved_site(v, &site);
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
// Username display is a separate UI projection: no secret-reference argument and
// no password/API entries can be selected through this command.
fn site_account_names_in_vault(vault: &Vault) -> BTreeMap<String, String> {
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
#[tauri::command]
pub async fn secure_site_account_names(window: tauri::WebviewWindow) -> Result<BTreeMap<String, String>, String> {
    trusted_window(&window)?;
    storage_task(|| with_vault(false, |vault| Ok(site_account_names_in_vault(vault)))).await
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
fn resolve_in_vault(
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
    Ok(Zeroizing::new(secret.value.clone()))
}
pub fn redact(mut value: Value) -> Result<Value, String> {
    with_vault(false, |v| {
        redact_value(v, &mut value);
        Ok(value)
    })
}
pub fn redact_best_effort(value: Value) -> Value {
    redact(value).unwrap_or(json!({"error":"敏感结果暂不可读取，请解锁安全存储后重试"}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encryption_is_authenticated_and_bound_to_document() {
        let key = [7; 32];
        let plain = b"synthetic-secret-not-a-real-password";
        let first = seal(&key, "a", plain).unwrap();
        let second = seal(&key, "a", plain).unwrap();
        assert_ne!(first, second);
        assert!(!first.contains("synthetic-secret"));
        assert_eq!(&*open(&key, "a", &first).unwrap(), plain);
        assert!(open(&key, "b", &first).is_err());
        assert!(open(&[8; 32], "a", &first).is_err());
        let mut bytes = STANDARD
            .decode(first.strip_prefix(PREFIX).unwrap())
            .unwrap();
        bytes[16] ^= 1;
        assert!(open(&key, "a", &format!("{}{}", PREFIX, STANDARD.encode(bytes))).is_err());
    }
    #[test]
    fn placeholders_and_escaped_tool_json_are_safe() {
        let mut v = Vault::default();
        let id = "site/example.test/password";
        let reference = put_secret(&mut v, id, "demo\"\\secret", "site", vec![]).unwrap();
        let mut message = json!({"content":"demo\"\\secret","arguments":json!({"text":"demo\"\\secret"}).to_string()});
        redact_value(&v, &mut message);
        assert_eq!(message["content"], reference);
        assert_eq!(
            serde_json::from_str::<Value>(message["arguments"].as_str().unwrap()).unwrap()["text"],
            reference
        );
        assert_eq!(redact_text(&v, &reference), reference);
    }
}

#[tauri::command]
pub async fn secure_register_api(
    window: tauri::WebviewWindow,
    provider: String,
    value: String,
) -> Result<Value, String> {
    trusted_window(&window)?;
    storage_task(move || register_api_inner(provider, value)).await
}
fn register_api_inner(provider: String, value: String) -> Result<Value, String> {
    if value.is_empty() || value.len() > 8192 {
        return Err("API Key 无效".into());
    }
    with_vault(true, |v| {
        let (id, origins) = match provider.as_str() {
            "search/exa" => (
                "search/apiKey".to_string(),
                vec!["https://mcp.exa.ai".into()],
            ),
            "search/deepseek" => (
                "search/deepseekApiKey".to_string(),
                vec!["https://api.deepseek.com".into()],
            ),
            _ => {
                let platform = v
                    .documents
                    .get("model_settings")
                    .and_then(|d| d["platforms"].as_array())
                    .and_then(|rows| rows.iter().find(|p| p["id"].as_str() == Some(&provider)));
                let endpoint = platform
                    .and_then(|p| p["baseUrl"].as_str())
                    .and_then(origin)
                    .ok_or("请先在设置中配置对应模型平台，再登记 API Key")?;
                (format!("model/{}/apiKey", provider), vec![endpoint])
            }
        };
        let reference = put_secret(v, &id, &value, "api", origins)?;
        if provider.starts_with("search/") {
            let field = if provider == "search/exa" {
                "apiKey"
            } else {
                "deepseekApiKey"
            };
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

pub fn trusted_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("网页及辅助窗口无权访问应用凭据存储".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn secure_archive_legacy(
    window: tauri::WebviewWindow,
    values: BTreeMap<String, Value>,
) -> Result<(), String> {
    trusted_window(&window)?;
    storage_task(move || archive_legacy_inner(values)).await
}
fn archive_legacy_inner(values: BTreeMap<String, Value>) -> Result<(), String> {
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
fn archive_file(path: &std::path::Path) -> Result<(), String> {
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
fn clean_tree(dir: &std::path::Path, mode: &str, depth: usize) -> Result<usize, String> {
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
pub async fn secure_cleanup_legacy(window: tauri::WebviewWindow) -> Result<Value, String> {
    trusted_window(&window)?;
    tauri::async_runtime::spawn_blocking(cleanup_legacy)
        .await
        .map_err(|_| "敏感数据迁移任务失败".to_string())?
}
fn cleanup_legacy() -> Result<Value, String> {
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
    window: tauri::WebviewWindow,
    pending: String,
    site: String,
) -> Result<Value, String> {
    trusted_window(&window)?;
    storage_task(move || bind_pending_inner(pending, site)).await
}
fn bind_pending_inner(pending: String, site: String) -> Result<Value, String> {
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

#[cfg(test)]
mod credential_tests {
    use super::*;
    #[test]
    fn failed_master_access_is_cached_until_explicit_recovery() {
        let mut state = MasterState::default();
        let calls = std::cell::Cell::new(0);
        for _ in 0..5 {
            assert!(state
                .obtain(|| {
                    calls.set(calls.get() + 1);
                    Err("authorization required".into())
                })
                .is_err());
        }
        assert_eq!(calls.get(), 1);
        state.key = Some(Zeroizing::new(vec![7; 32]));
        state.error = None;
        assert_eq!(
            state.obtain(|| panic!("already recovered")).unwrap(),
            &[7; 32]
        );
    }
    #[test]
    fn durable_migration_is_encrypted_and_imports_late_browser_storage_only_once() {
        let directory = root();
        std::fs::create_dir_all(&directory).unwrap();
        let source = directory.join("site-accounts.json");
        std::fs::write(&source,json!({"zjooc":{"account":"migration-first-user","password":"migration-first-password","updatedAt":1}}).to_string()).unwrap();
        // The native server can read the legacy file before the main WebView starts.
        let initial = document_read("site_accounts", None).unwrap();
        assert_eq!(initial["zjooc"]["account"], "{{secret:site/zjooc/account}}");
        assert!(!source.exists());
        let later = json!({"zjooc":{"account":"migration-new-user","password":"migration-new-password","updatedAt":2}});
        document_read("site_accounts", Some(later)).unwrap();
        assert_eq!(
            resolve(
                "{{secret:site/zjooc/password}}",
                "site",
                "https://background.zjooc.cn"
            )
            .unwrap()
            .as_str(),
            "migration-new-password"
        );
        document_read(
            "site_accounts",
            Some(
                json!({"zjooc":{"account":"stale-user","password":"stale-password","updatedAt":3}}),
            ),
        )
        .unwrap();
        assert_eq!(
            resolve(
                "{{secret:site/zjooc/password}}",
                "site",
                "https://background.zjooc.cn"
            )
            .unwrap()
            .as_str(),
            "migration-new-password"
        );
        let encrypted = std::fs::read_to_string(vault_path()).unwrap();
        assert!(encrypted.starts_with(PREFIX));
        assert!(!encrypted.contains("migration-new-password"));
        let backups = std::fs::read_dir(directory.join("secure/migration"))
            .unwrap()
            .count();
        assert!(backups > 0);
        // Drop the process cache to verify that actual encrypted disk data reopens.
        *CACHE.get().unwrap().lock() = None;
        assert_eq!(
            document_read("site_accounts", None).unwrap()["zjooc"]["password"],
            "{{secret:site/zjooc/password}}"
        );
        document_write(
            "agent_chats",
            json!([{"content":"pending-password-for-test"}]),
        )
        .unwrap();
        let pending = register_inner(
            "unknown.example.test".into(),
            BTreeMap::from([("password".into(), "pending-password-for-test".into())]),
        )
        .unwrap();
        let reference = pending["references"]["password"].as_str().unwrap();
        assert!(resolve(reference, "site", "https://unknown.example.test").is_err());
        assert!(!document_read("agent_chats", None)
            .unwrap()
            .to_string()
            .contains("pending-password-for-test"));
        bind_pending_inner(pending["site"].as_str().unwrap().into(), "zjooc".into()).unwrap();
        assert_eq!(
            resolve(reference, "site", "https://background.zjooc.cn")
                .unwrap()
                .as_str(),
            "pending-password-for-test"
        );
        register_inner(
            "zjooc".into(),
            BTreeMap::from([("account".into(), "a-different-user".into())]),
        )
        .unwrap();
        assert!(resolve(
            "{{secret:site/zjooc/password}}",
            "site",
            "https://background.zjooc.cn"
        )
        .is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn references_require_exact_origin_and_secret_kind_even_after_pending_binding() {
        let mut vault = Vault::default();
        let reference = put_secret(
            &mut vault,
            "site/example.test/password",
            "synthetic-password",
            "site",
            vec!["https://example.test".into()],
        )
        .unwrap();
        vault.aliases.insert(
            "{{secret:site/pending-test/password}}".into(),
            reference.clone(),
        );
        assert_eq!(
            resolve_in_vault(&vault, &reference, "site", "https://example.test/login")
                .unwrap()
                .as_str(),
            "synthetic-password"
        );
        for target in [
            "http://example.test/login",
            "https://example.test.evil.test/",
            "https://example.test:444/",
            "https://evil.test/",
            "https://user:pass@example.test/",
        ] {
            assert!(resolve_in_vault(&vault, &reference, "site", target).is_err());
        }
        assert!(resolve_in_vault(&vault, &reference, "api", "https://example.test/").is_err());
        let pending = "{{secret:site/pending-test/password}}";
        assert!(resolve_in_vault(&vault, pending, "site", "https://example.test/").is_ok());
        assert_eq!(redact_text(&vault, pending), reference);
        vault.secrets.clear();
        assert!(resolve_in_vault(&vault, pending, "site", "https://example.test/").is_err());
    }
    #[test]
    fn migration_never_mixes_two_principals_and_unifies_verified_login_alias() {
        let rows = merge_accounts(
            json!({"menhu.haou.edu.cn":{"account":"old-user","password":"complete-old","updatedAt":10}}),
            json!({"authserver.open.ha.cn":{"account":"new-user","password":"","updatedAt":20}}),
        );
        assert_eq!(rows["menhu.haou.edu.cn"]["account"], "old-user");
        assert_eq!(rows["menhu.haou.edu.cn"]["password"], "complete-old");
        assert!(rows.get("authserver.open.ha.cn").is_none());
        let matched = merge_accounts(
            json!({"menhu.haou.edu.cn":{"account":"same-user","password":"","updatedAt":10}}),
            json!({"authserver.open.ha.cn":{"account":"same-user","password":"complete-new","updatedAt":20}}),
        );
        assert_eq!(matched["menhu.haou.edu.cn"]["password"], "complete-new");
    }
    #[test]
    fn username_projection_exposes_only_current_site_usernames() {
        let mut vault = Vault::default();
        let mut document = json!({"zjooc":{"account":"visible-synthetic-user","password":"private-synthetic-password"}});
        protect_document(&mut vault, "site_accounts", &mut document).unwrap();
        vault.documents.insert("site_accounts".into(), document.clone());
        let names = site_account_names_in_vault(&vault);
        assert_eq!(names.get("zjooc").unwrap(), "visible-synthetic-user");
        assert!(!serde_json::to_string(&names).unwrap().contains("private-synthetic-password"));
        assert!(!document.to_string().contains("visible-synthetic-user"));
        // Neither forged references nor another website can select password slots.
        vault.documents.get_mut("site_accounts").unwrap()["zjooc"]["account"] = json!("{{secret:site/zjooc/password}}");
        assert!(site_account_names_in_vault(&vault).is_empty());
        vault.documents.get_mut("site_accounts").unwrap()["other.test"] = document["zjooc"].clone();
        assert!(site_account_names_in_vault(&vault).is_empty());
        vault.documents.insert("site_accounts".into(), json!({}));
        assert!(site_account_names_in_vault(&vault).is_empty());
    }
    #[test]
    fn configuration_contains_references_and_revokes_deleted_accounts() {
        let mut vault = Vault::default();
        let mut data =
            json!({"zjooc":{"account":"synthetic-user","password":"synthetic-password"}});
        protect_document(&mut vault, "site_accounts", &mut data).unwrap();
        assert_eq!(data["zjooc"]["password"], "{{secret:site/zjooc/password}}");
        assert!(!data.to_string().contains("synthetic"));
        assert!(vault.secrets["site/zjooc/password"]
            .origins
            .contains(&"https://background.zjooc.cn".to_string()));
        protect_document(&mut vault, "site_accounts", &mut json!({})).unwrap();
        assert!(vault.secrets.is_empty());
    }
    #[test]
    fn headers_are_bound_to_the_configured_service_and_pending_sites_have_no_origin() {
        let mut vault = Vault::default();
        let mut data = json!({"platforms":[{"id":"provider","baseUrl":"https://api.example.test/v1","apiKey":"test-key","customHeaders":{"Authorization":"Bearer header-key","Accept":"application/json"}}]});
        protect_document(&mut vault, "model_settings", &mut data).unwrap();
        assert_eq!(
            data["platforms"][0]["apiKey"],
            "{{secret:model/provider/apiKey}}"
        );
        assert_eq!(
            data["platforms"][0]["customHeaders"]["Authorization"],
            "{{secret:model/provider/header/Authorization}}"
        );
        assert_eq!(
            data["platforms"][0]["customHeaders"]["Accept"],
            "application/json"
        );
        assert_eq!(
            vault.secrets["model/provider/header/Authorization"].origins,
            vec!["https://api.example.test"]
        );
        assert!(site_origins("pending-example").is_empty());
        assert!(!approved_site(&vault, "newly-discovered.example.test"));
        assert!(!site_origins("menhu.haou.edu.cn")
            .contains(&"https://authserver.open.ha.cn.evil.test".to_string()));
        assert!(origin("https://user:pass@api.example.test").is_none());
    }
    #[test]
    fn stored_transcripts_are_rewritten_in_the_registration_transaction() {
        let mut vault = Vault::default();
        vault.documents.insert("agent_chats".into(),json!([{"title":"账号 synthetic-user","messages":[{"content":"password synthetic-password"}]}]));
        put_secret(
            &mut vault,
            "site/zjooc/account",
            "synthetic-user",
            "site",
            vec![],
        )
        .unwrap();
        put_secret(
            &mut vault,
            "site/zjooc/password",
            "synthetic-password",
            "site",
            vec![],
        )
        .unwrap();
        scrub_stored_chats(&mut vault);
        assert!(!vault.documents["agent_chats"]
            .to_string()
            .contains("synthetic"));
    }
    #[test]
    fn failed_atomic_write_leaves_original_data_intact() {
        let folder =
            std::env::temp_dir().join(format!("zerror-write-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let original = folder.join("blocked-parent");
        std::fs::write(&original, b"original").unwrap();
        assert!(atomic_write(&original.join("vault.enc"), b"replacement").is_err());
        assert_eq!(std::fs::read(&original).unwrap(), b"original");
        std::fs::remove_dir_all(folder).unwrap();
    }
}
