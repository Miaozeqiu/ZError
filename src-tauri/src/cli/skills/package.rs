use ring::digest::{digest, SHA256};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Read, time::Duration};

pub const DEFAULT_SOURCE: &str = "https://open.zerrorai.com";
pub const LIMIT: usize = 2 * 1024 * 1024;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFile {
    pub path: String,
    pub bytes: usize,
    pub sha256: String,
    pub content: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub schema_version: u32,
    pub name: String,
    pub version: String,
    pub cli_protocol: u32,
    pub revision: String,
    pub files: Vec<SkillFile>,
}
pub fn hash(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub fn version(value: &str) -> Result<[u32; 3], String> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || p.len() > 8 || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("无效的 Skill 版本号".into());
    }
    Ok([
        parts[0].parse().map_err(|_| "无效版本")?,
        parts[1].parse().map_err(|_| "无效版本")?,
        parts[2].parse().map_err(|_| "无效版本")?,
    ])
}
pub fn valid_path(path: &str) -> bool {
    path.split('/').count() <= 8
        && !path.is_empty()
        && path.len() <= 200
        && path.split('/').all(|part| {
            let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with('.')
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                && !["CON", "PRN", "AUX", "NUL"].contains(&base.as_str())
                && !(base.len() == 4
                    && (base.starts_with("COM") || base.starts_with("LPT"))
                    && base.as_bytes()[3].is_ascii_digit())
        })
}
impl Package {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.name != "zerror" || self.cli_protocol != 1 {
            return Err("Skill 需要不兼容的 CLI 协议，请先升级软件".into());
        }
        version(&self.version)?;
        if self.files.is_empty()
            || self.files.len() > 32
            || !self.files.iter().any(|f| f.path == "SKILL.md")
        {
            return Err("Skill 文件清单无效".into());
        }
        let mut paths = BTreeMap::new();
        let mut directories = BTreeMap::new();
        let mut bytes = 0usize;
        for f in &self.files {
            if !valid_path(&f.path)
                || f.path
                    .split('/')
                    .next()
                    .unwrap_or("")
                    .eq_ignore_ascii_case(".zerror-skill.json")
                || paths
                    .insert(f.path.to_ascii_lowercase(), f.path.clone())
                    .is_some()
            {
                return Err("Skill 含不安全或重复路径".into());
            }
            let parts: Vec<_> = f.path.split('/').collect();
            for end in 1..parts.len() {
                let directory = parts[..end].join("/");
                if let Some(existing) =
                    directories.insert(directory.to_ascii_lowercase(), directory.clone())
                {
                    if existing != directory {
                        return Err("Skill 目录大小写冲突".into());
                    }
                }
            }
            bytes = bytes.saturating_add(f.bytes);
            if bytes > LIMIT || f.bytes != f.content.len() || f.sha256 != hash(f.content.as_bytes())
            {
                return Err("Skill 文件校验失败".into());
            }
        }
        if directories.keys().any(|dir| paths.contains_key(dir)) {
            return Err("Skill 文件与目录冲突".into());
        }
        let mut files = self.files.iter().collect::<Vec<_>>();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let mut identity = format!(
            "zerror-agent-skill:1\n{}\n{}\n{}\n",
            self.name, self.version, self.cli_protocol
        );
        for f in files {
            identity.push_str(&format!("{}\t{}\t{}\n", f.path, f.bytes, f.sha256));
        }
        if hash(identity.as_bytes()) != self.revision {
            return Err("Skill 发布清单校验失败".into());
        }
        Ok(())
    }
}
pub fn source_url(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "无效的 Open 地址")?;
    let local = matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    );
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Open 地址必须使用 HTTPS（本机测试除外），且不能包含凭据、查询或片段".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}
pub fn fetch(source: &str) -> Result<Package, String> {
    let source = source_url(source)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化 Skill 下载")?;
    let response = client
        .get(format!("{source}/v1/agent-skills/zerror"))
        .header("Cache-Control", "no-cache")
        .send()
        .map_err(|_| "无法连接 Open，已保留现有 Skill")?;
    if !response.status().is_success() || response.status().is_redirection() {
        return Err(format!("Open Skill 请求失败：{}", response.status()));
    }
    if response.content_length().unwrap_or(0) > LIMIT as u64 {
        return Err("Skill 发布包超过大小限制".into());
    }
    let mut bytes = Vec::new();
    response
        .take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Skill 下载不完整")?;
    if bytes.len() > LIMIT {
        return Err("Skill 发布包超过大小限制".into());
    }
    let package: Package =
        serde_json::from_slice(&bytes).map_err(|_| "Open 返回的 Skill 发布包无效")?;
    package.validate()?;
    Ok(package)
}
