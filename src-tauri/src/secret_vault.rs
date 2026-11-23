//! Sensitive data never goes to ordinary configuration files. The encryption key is
//! owned by the OS credential store; only ciphertext is written to the app directory.
mod crypto;
use crypto::*;
mod migration;
pub use migration::*;
mod credentials;
pub use credentials::*;

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

#[cfg(any(target_os = "macos", all(target_os = "linux", not(test))))]
const SERVICE: &str = "cc.zerror.credentials";
#[cfg(all(not(test), target_os = "linux"))]
const KEY_ACCOUNT: &str = "vault-master-v1";
const PREFIX: &str = "zerror-secure-v1:";
const DEEPSEEK_ORIGIN: &str = "https://api.deepseek.com";
const DEEPSEEK_KEY_FIELD: &str = "deepseekApiKey";
const DEEPSEEK_KEY_ID: &str = "search/deepseekApiKey";
const SEARCH_API_KEYS: [(&str, &str, &str); 5] = [
    ("exa", "apiKey", "https://mcp.exa.ai"),
    ("deepseek", DEEPSEEK_KEY_FIELD, DEEPSEEK_ORIGIN),
    ("tavily", "tavilyApiKey", "https://api.tavily.com"),
    ("brave", "braveApiKey", "https://api.search.brave.com"),
    ("you", "youApiKey", "https://ydc-index.io"),
];
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
#[cfg(test)]
fn root() -> PathBuf {
    std::env::temp_dir().join(format!("zerror-vault-tests-{}", std::process::id()))
}

#[cfg(not(test))]
fn root() -> PathBuf {
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
#[cfg(target_os = "macos")]
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
pub async fn secure_storage_authorize(webview: tauri::Webview) -> Result<(), String> {
    trusted_webview(&webview)?;
    if !crate::secret_access::window_is_foreground(&webview.window()) {
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
// Build the matcher once for this immutable vault snapshot, not once per
// string in a potentially large chat transcript. Never cache past mutations.
struct Redactor<'a> {
    vault: &'a Vault,
    entries: Vec<(String, String)>,
    matcher: Option<regex::Regex>,
}
impl<'a> Redactor<'a> {
  fn new(v: &'a Vault) -> Self {
    let mut entries: Vec<(String, String)> = v
        .secrets
        .iter()
        .map(|(id, s)| (s.value.clone(), token(id)))
        .chain(v.retired.iter().cloned())
        .filter(|(s, _)| !s.is_empty())
        .collect();
    entries.sort_by_key(|(s, _)| std::cmp::Reverse(s.len()));
    let matcher = if entries.is_empty() { None } else { Some(regex::Regex::new(
        &entries
            .iter()
            .map(|(value, _)| regex::escape(value))
            .collect::<Vec<_>>()
            .join("|"),
    ).expect("escaped credential literals")) };
    Self { vault: v, entries, matcher }
  }
  fn text(&self, text: &str) -> String {
    static TOKENS: OnceLock<regex::Regex> = OnceLock::new();
    let re = TOKENS.get_or_init(|| regex::Regex::new(r"\{\{secret:[^{}]+\}\}").unwrap());
    let replace = |part: &str| {
        if self.entries.is_empty() {
            return part.to_owned();
        }
        self.matcher
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
                self.entries
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
            self.vault.aliases
                .get(m.as_str())
                .map(String::as_str)
                .unwrap_or(m.as_str()),
        );
        start = m.end();
    }
    out.push_str(&replace(&text[start..]));
    out
  }
  fn value(&self, data: &mut Value) {
    match data {
        Value::String(s) => {
            if let Ok(mut nested) = serde_json::from_str::<Value>(s) {
                if nested.is_object() || nested.is_array() {
                    self.value(&mut nested);
                    *s = nested.to_string();
                    return;
                }
            }
            *s = self.text(s);
        }
        Value::Array(rows) => rows.iter_mut().for_each(|row| self.value(row)),
        Value::Object(rows) => rows
            .iter_mut()
            .filter(|(key, _)| {
                !["id", "name", "role", "tool_call_id", "source_message_id"].contains(&key.as_str())
            })
            .for_each(|(_, row)| self.value(row)),
        _ => {}
    }
  }
}
fn redact_text(v: &Vault, text: &str) -> String {
    Redactor::new(v).text(text)
}
fn redact_value(v: &Vault, data: &mut Value) {
    Redactor::new(v).value(data)
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
                    if row["host"].as_str() != Some(primary) {
                        continue;
                    }
                    if let Some(excluded) = row["excludedDomains"].as_array() {
                        hosts.retain(|host| !excluded.iter().filter_map(Value::as_str)
                            .any(|domain| host == domain || host.ends_with(&format!(".{domain}"))));
                    }
                    if row["credentialsApproved"] == true || row.get("credentialsApproved").is_none() {
                        if let Some(aliases) = row["loginHosts"].as_array() {
                            hosts.extend(aliases.iter().filter_map(Value::as_str).map(str::to_string));
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
#[cfg(windows)]
pub(crate) fn site_accepts_origin(site: &str, target: &str) -> bool {
    site_origins(site).iter().any(|origin| origin == target)
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
    if let Ok(raw) = std::fs::read_to_string(root().join("website-identities.json")) {
        if let Ok(data) = serde_json::from_str::<Value>(&raw) {
            if let Some(rows) = data["profiles"].as_array() {
                for row in rows {
                    if site == "authserver.open.ha.cn" && row["host"] == "menhu.haou.edu.cn"
                        && row["excludedDomains"].as_array().is_some_and(|domains| domains.iter().any(|domain| domain == site)) {
                        return site.into();
                    }
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
    if site == "authserver.open.ha.cn" { return "menhu.haou.edu.cn".into(); }
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
fn is_official_deepseek(platform: &Value) -> bool {
    platform["isRemote"].as_bool() == Some(true)
        && platform["baseUrl"].as_str().and_then(origin).as_deref() == Some(DEEPSEEK_ORIGIN)
}

fn protect_deepseek_key(v: &mut Vault, data: &mut Value) -> Result<(), String> {
    let legacy_model_key = data["platforms"].as_array().into_iter().flatten()
        .filter(|platform| is_official_deepseek(platform))
        .filter_map(|platform| {
            let key = platform["apiKey"].as_str()?.trim();
            if let Some(reference) = token_id(key) {
                let expected = format!("model/{}/apiKey", platform["id"].as_str()?);
                if reference != expected { return None; }
                return v.secrets.get(reference)
                    .filter(|secret| secret.origins.iter().any(|value| value == DEEPSEEK_ORIGIN))
                    .map(|secret| secret.value.as_str());
            }
            (!key.is_empty()).then_some(key)
        })
        .next();
    let key = data[DEEPSEEK_KEY_FIELD].as_str()
        .or(legacy_model_key)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if v.secrets.contains_key(DEEPSEEK_KEY_ID) { token(DEEPSEEK_KEY_ID) } else { String::new() }
        });
    data[DEEPSEEK_KEY_FIELD] = json!(put_secret(
        v, DEEPSEEK_KEY_ID, &key, "api", vec![DEEPSEEK_ORIGIN.into()]
    )?);
    if let Some(search) = v.documents.get_mut("app_settings")
        .and_then(|settings| settings["search"].as_object_mut())
    {
        search.remove(DEEPSEEK_KEY_FIELD);
    }
    Ok(())
}

fn protect_document(v: &mut Vault, name: &str, data: &mut Value) -> Result<(), String> {
    if name == "model_settings" {
        if data.is_object() {
            protect_deepseek_key(v, data)?;
        }
        if let Some(platforms) = data["platforms"].as_array_mut() {
            for platform in platforms {
                let id = platform["id"]
                    .as_str()
                    .ok_or("模型平台缺少 id")?
                    .to_string();
                let origins: Vec<String> = origin(platform["baseUrl"].as_str().unwrap_or(""))
                    .into_iter()
                    .collect();
                if is_official_deepseek(platform) {
                    v.secrets.remove(&format!("model/{}/apiKey", id));
                    platform["apiKey"] = json!("");
                } else if let Some(key) = platform["apiKey"].as_str() {
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
        for (_, field, endpoint) in SEARCH_API_KEYS {
            if field == DEEPSEEK_KEY_FIELD && v.documents.get("model_settings")
                .is_some_and(|settings| settings[DEEPSEEK_KEY_FIELD].is_string())
            {
                if let Some(search) = data["search"].as_object_mut() {
                    search.remove(field);
                }
                continue;
            }
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
        "website_repositories",
        "website_workflows",
        "website_package_state",
        "auth",
    ]
    .contains(&name)
}


pub fn document_read(name: &str, legacy: Option<Value>) -> Result<Value, String> {
    if !valid_document(name) {
        return Err("无效的存储名称".into());
    }
    let value = with_vault(true, |v| {
        let importing = legacy.as_ref().is_some_and(|data| !data.is_null())
            && !v.legacy_imported.contains(name);
        if let Some(stored) = v.documents.get(name) {
            if !importing && (name != "model_settings" || stored[DEEPSEEK_KEY_FIELD].is_string()) {
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
        if name == "model_settings" && data.is_null() && v.secrets.contains_key(DEEPSEEK_KEY_ID) {
            data = json!({"platforms": []});
        }
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
        // The replacement transcript has already been fully redacted. Scanning
        // the old copy here only doubles checkpoint work before overwriting it.
        if name != "agent_chats" { scrub_stored_chats(v); }
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
    webview: tauri::Webview,
    name: String,
    legacy: Option<Value>,
) -> Result<Value, String> {
    trusted_webview(&webview)?;
    storage_task(move || document_read(&name, legacy)).await
}
#[tauri::command]
pub async fn secure_document_write(
    webview: tauri::Webview,
    name: String,
    value: Value,
) -> Result<Value, String> {
    trusted_webview(&webview)?;
    storage_task(move || document_write(&name, value)).await
}
#[tauri::command]
pub async fn secure_redact(webview: tauri::Webview, value: Value) -> Result<Value, String> {
    trusted_webview(&webview)?;
    storage_task(move || redact(value)).await
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
    #[test]
    fn transcript_redaction_keeps_nested_json_boundaries_and_rotated_secrets_safe() {
        let mut vault = Vault::default();
        let id = "site/example.test/password";
        let reference = put_secret(&mut vault, id, "demo-secret-long", "site", vec![]).unwrap();
        let short = put_secret(&mut vault, "site/example.test/account", "abc", "site", vec![]).unwrap();
        let row = json!({"id":"stable-message-id", "content":"demo-secret-long abc abcdef", "arguments":json!({"text":"demo-secret-long", "reference":reference}).to_string()});
        let mut transcript = Value::Array(vec![row; 2048]);
        redact_value(&vault, &mut transcript);
        for row in transcript.as_array().unwrap() {
            assert_eq!(row["id"], "stable-message-id");
            assert_eq!(row["content"], format!("{} {} abcdef", reference, short));
            let args: Value = serde_json::from_str(row["arguments"].as_str().unwrap()).unwrap();
            assert_eq!(args["text"], reference);
            assert_eq!(args["reference"], reference);
        }
        put_secret(&mut vault, id, "rotated-secret", "site", vec![]).unwrap();
        let mut next = json!(["rotated-secret", "demo-secret-long"]);
        redact_value(&vault, &mut next);
        assert_eq!(next, json!([reference, reference]));
    }
}


pub(crate) fn trusted_webview(webview: &tauri::Webview) -> Result<(), String> {
    // The host can also contain native browser tabs. Only the app's own view
    // can access the vault, regardless of how many views the window hosts.
    if webview.label() != "main" || webview.window().label() != "main" {
        return Err("网页及辅助窗口无权访问应用凭据存储".into());
    }
    Ok(())
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
        let repository = json!({"version":1,"fork":{"files":{"SKILL.md":"synthetic-private-site-experience"}}});
        document_write("website_repositories", repository.clone()).unwrap();
        let encrypted_repository = std::fs::read_to_string(vault_path()).unwrap();
        assert!(encrypted_repository.starts_with(PREFIX));
        assert!(!encrypted_repository.contains("synthetic-private-site-experience"));
        *CACHE.get().unwrap().lock() = None;
        assert_eq!(document_read("website_repositories", None).unwrap(), repository);
        document_write(
            "agent_chats",
            json!([{"content":"pending-password-for-test"}]),
        )
        .unwrap();
        let fields = BTreeMap::from([
            ("account".into(), "chat-form-user".into()),
            ("password".into(), "chat-form-password".into()),
        ]);
        let host = "chat-login.example";
        assert!(register_site_fields(host.into(), fields.clone(), Some("https://other.example")).is_err());
        let receipt = register_site_fields(host.into(), fields, Some("https://chat-login.example")).unwrap();
        assert_eq!(receipt["pending"], false);
        assert!(!receipt.to_string().contains("chat-form-"));
        let reference = receipt["references"]["password"].as_str().unwrap();
        assert_eq!(resolve(reference, "site", "https://chat-login.example").unwrap().as_str(), "chat-form-password");
        assert!(resolve(reference, "site", "https://other.example").is_err());
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
    fn website_password_length_counts_characters_and_rejects_other_fields() {
        let mut vault = Vault::default();
        let mut document = json!({"zjooc": {"account": "synthetic-user", "password": "a密🔒7"}});
        protect_document(&mut vault, "site_accounts", &mut document).unwrap();
        let password = document["zjooc"]["password"].as_str().unwrap();
        assert_eq!(site_password_length(&vault, password).unwrap(), 4);
        let account = document["zjooc"]["account"].as_str().unwrap();
        assert!(site_password_length(&vault, account).is_err());
        let api_key = put_secret(&mut vault, "model/demo/apiKey", "synthetic-key", "api", vec![]).unwrap();
        assert!(site_password_length(&vault, &api_key).is_err());
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
    fn deepseek_shares_one_origin_bound_key_and_does_not_restore_a_cleared_key() {
        let mut vault = Vault::default();
        let mut search = json!({"search":{"deepseekApiKey":"old-search-key"}});
        protect_document(&mut vault, "app_settings", &mut search).unwrap();
        vault.documents.insert("app_settings".into(), search.clone());
        let mut model = json!({"platforms":[
            {"id":"deepseek","baseUrl":"https://api.deepseek.com/v1","isRemote":true,"apiKey":"old-model-key"},
            {"id":"proxy","baseUrl":"https://api.deepseek.com.example.test/v1","isRemote":true,"apiKey":"proxy-key"}
        ]});
        model["platforms"][0]["apiKey"] = json!(put_secret(
            &mut vault, "model/deepseek/apiKey", "old-model-key", "api", vec![DEEPSEEK_ORIGIN.into()]
        ).unwrap());
        protect_document(&mut vault, "model_settings", &mut model).unwrap();
        assert_eq!(model[DEEPSEEK_KEY_FIELD], token(DEEPSEEK_KEY_ID));
        assert_eq!(vault.secrets[DEEPSEEK_KEY_ID].value, "old-model-key");
        assert_eq!(vault.secrets[DEEPSEEK_KEY_ID].origins, vec![DEEPSEEK_ORIGIN]);
        assert!(!vault.secrets.contains_key("model/deepseek/apiKey"));
        assert_eq!(model["platforms"][1]["apiKey"], token("model/proxy/apiKey"));
        assert!(vault.documents["app_settings"]["search"].get(DEEPSEEK_KEY_FIELD).is_none());

        model[DEEPSEEK_KEY_FIELD] = json!("");
        protect_document(&mut vault, "model_settings", &mut model).unwrap();
        vault.documents.insert("model_settings".into(), model);
        protect_document(&mut vault, "app_settings", &mut search).unwrap();
        assert!(!vault.secrets.contains_key(DEEPSEEK_KEY_ID));
        assert!(search["search"].get(DEEPSEEK_KEY_FIELD).is_none());
    }

    #[test]
    fn deepseek_migrates_a_search_key_without_a_configured_model() {
        let mut vault = Vault::default();
        let mut search = json!({"search":{"deepseekApiKey":"search-only-key"}});
        protect_document(&mut vault, "app_settings", &mut search).unwrap();
        let mut model = json!({"platforms":[]});
        protect_document(&mut vault, "model_settings", &mut model).unwrap();
        assert_eq!(model[DEEPSEEK_KEY_FIELD], token(DEEPSEEK_KEY_ID));
        assert_eq!(vault.secrets[DEEPSEEK_KEY_ID].value, "search-only-key");
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
