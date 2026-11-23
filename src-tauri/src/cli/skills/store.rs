use super::super::transport::{directory, private_directory};
use super::package::{hash, valid_path, Package, LIMIT};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
pub const RECEIPT: &str = ".zerror-skill.json";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub schema_version: u32,
    pub name: String,
    pub source: String,
    pub version: String,
    pub revision: String,
    pub automatic: bool,
    pub files: BTreeMap<String, String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    pub path: PathBuf,
    pub source: String,
    pub automatic: bool,
    pub checked_at: u64,
    pub last_error: Option<String>,
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub struct Store {
    root: PathBuf,
}
impl Store {
    pub fn open() -> Result<Self, String> {
        Self::at(directory()?.join("agent-skills"))
    }
    pub(super) fn at(root: PathBuf) -> Result<Self, String> {
        private_directory(&root)?;
        Ok(Self { root })
    }
    pub fn lock(&self, key: &str) -> Result<fs::File, String> {
        let path = self.root.join(format!("{}.lock", hash(key.as_bytes())));
        reject_symlink(&path)?;
        let mut options = fs::OpenOptions::new();
        options.create(true).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(path).map_err(|_| "无法锁定 Skill 安装状态")?;
        // Unix 上 fork 到 exec 之间可能短暂继承另一个线程刚释放的锁。
        // 只对锁竞争做有界重试；持久竞争和文件系统错误仍然停止写入。
        let deadline = Instant::now() + Duration::from_millis(500);
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(file),
                Err(fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(fs::TryLockError::WouldBlock) => {
                    return Err("另一进程正在管理 Skill，请稍后重试".into());
                }
                Err(_) => return Err("无法锁定 Skill 安装状态".into()),
            }
        }
    }
}
pub fn reject_symlink(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        Err("Skill 路径不能是符号链接".into())
    } else {
        Ok(())
    }
}
pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    reject_symlink(path)?;
    let file = fs::File::open(path).map_err(|_| "无法读取 Skill 安装状态")?;
    if file.metadata().map_err(|_| "无法读取文件信息")?.len() > LIMIT as u64 {
        return Err("Skill 状态文件过大".into());
    }
    let mut bytes = Vec::new();
    file.take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取 Skill 安装状态")?;
    serde_json::from_slice(&bytes).map_err(|_| "Skill 安装状态损坏".into())
}
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    reject_symlink(path)?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| "无法保存 Skill 状态")?;
        file.write_all(&serde_json::to_vec(value).map_err(|_| "无法编码 Skill 状态")?)
            .map_err(|_| "无法写入 Skill 状态")?;
        file.sync_all().map_err(|_| "无法保存 Skill 状态")?;
        drop(file);
        fs::rename(&temp, path).map_err(|_| "无法原子替换 Skill 状态")
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result.map_err(str::to_owned)
}
impl Store {
    pub fn installations(&self) -> Result<Vec<Installation>, String> {
        let path = self.root.join("installed.json");
        if !path.exists() {
            return Ok(vec![]);
        }
        read_json(&path)
    }
    pub fn register(&self, entry: Installation) -> Result<(), String> {
        let _guard = self.lock("registry")?;
        let mut rows = self.installations()?;
        rows.retain(|row| row.path != entry.path);
        if rows.len() >= 32 {
            return Err("已管理的 Skill 安装数量超过限制".into());
        }
        rows.push(entry);
        write_json(&self.root.join("installed.json"), &rows)
    }
}
pub fn receipt(path: &Path) -> Result<Receipt, String> {
    let r: Receipt = read_json(&path.join(RECEIPT))?;
    if r.schema_version != 1
        || r.name != "zerror"
        || r.files.is_empty()
        || r.files.len() > 32
        || !r.files.contains_key("SKILL.md")
        || r.files.keys().any(|p| !valid_path(p) || p == RECEIPT)
    {
        return Err("Skill 安装记录无效".into());
    }
    Ok(r)
}
pub fn unchanged(
    path: &Path,
    files: &BTreeMap<String, String>,
    with_receipt: bool,
) -> Result<(), String> {
    fn visit(
        root: &Path,
        path: &Path,
        files: &BTreeMap<String, String>,
        with_receipt: bool,
        found: &mut BTreeMap<String, String>,
        count: &mut usize,
    ) -> Result<(), String> {
        reject_symlink(path)?;
        for entry in fs::read_dir(path).map_err(|_| "无法检查 Skill 文件")? {
            let entry = entry.map_err(|_| "无法读取 Skill 文件")?;
            *count += 1;
            if *count > 256 {
                return Err("Skill 含额外内容，已保留本地修改".into());
            }
            let path = entry.path();
            let name = path
                .strip_prefix(root)
                .map_err(|_| "无效 Skill 路径")?
                .to_str()
                .ok_or("Skill 含额外文件")?
                .replace('\\', "/");
            let kind = entry.file_type().map_err(|_| "无法检查 Skill 文件")?;
            if kind.is_dir()
                && files
                    .keys()
                    .any(|file| file.starts_with(&format!("{name}/")))
            {
                visit(root, &path, files, with_receipt, found, count)?;
            } else if kind.is_file()
                && (files.contains_key(&name) || (with_receipt && name == RECEIPT))
            {
                if entry.metadata().map_err(|_| "无法检查 Skill 大小")?.len() > LIMIT as u64 {
                    return Err("Skill 文件过大，已保留本地内容".into());
                }
                let bytes = fs::read(&path).map_err(|_| "无法校验 Skill 文件")?;
                found.insert(name, hash(&bytes));
            } else {
                return Err("Skill 含额外目录、文件或符号链接，已保留本地内容".into());
            }
        }
        Ok(())
    }
    let mut found = BTreeMap::new();
    visit(path, path, files, with_receipt, &mut found, &mut 0)?;
    if with_receipt {
        found.remove(RECEIPT);
    }
    if &found != files {
        return Err("Skill 含本地修改或额外文件，未覆盖；请先保存并处理这些修改".into());
    }
    Ok(())
}
fn backup_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .and_then(Path::parent)
        .ok_or("无法确定 Skill 临时目录")?;
    Ok(parent.join(format!(
        ".zerror-{}-previous",
        &hash(path.to_string_lossy().as_bytes())[..16]
    )))
}
fn recover_swap(path: &Path, source: &str) -> Result<(), String> {
    reject_symlink(path)?;
    let backup = backup_path(path)?;
    reject_symlink(&backup)?;
    if !backup.exists() {
        return Ok(());
    }
    let old = receipt(&backup)?;
    if old.source != source {
        return Err("Skill 备份来源不匹配，未修改文件".into());
    }
    unchanged(&backup, &old.files, true)?;
    if !path.exists() {
        fs::rename(&backup, path).map_err(|_| "无法恢复上次 Skill 安装")?;
    } else {
        let current = receipt(path)?;
        if current.source != source {
            return Err("Skill 当前来源不匹配，未修改文件".into());
        }
        unchanged(path, &current.files, true)?;
        fs::remove_dir_all(&backup).map_err(|_| "无法清理已完成的 Skill 备份")?;
    }
    Ok(())
}
impl Store {
    pub fn recover(&self, path: &Path, source: &str) -> Result<(), String> {
        let _guard = self.lock(&path.to_string_lossy())?;
        recover_swap(path, source)
    }
    pub fn install(
        &self,
        path: &Path,
        source: &str,
        package: &Package,
        automatic: bool,
    ) -> Result<Receipt, String> {
        package.validate()?;
        let _guard = self.lock(&path.to_string_lossy())?;
        recover_swap(path, source)?;
        let parent = path
            .parent()
            .and_then(Path::parent)
            .ok_or("无法确定 Skill 临时目录")?;
        let backup = backup_path(path)?;
        let files = package
            .files
            .iter()
            .map(|f| (f.path.clone(), f.sha256.clone()))
            .collect::<BTreeMap<_, _>>();
        if path.exists() {
            let marker = path.join(RECEIPT);
            if marker.exists() {
                let old = receipt(path)?;
                if old.source != source {
                    return Err("现有 Skill 来自其他来源，未覆盖".into());
                }
                unchanged(path, &old.files, true)?;
                if super::package::version(&old.version)?
                    > super::package::version(&package.version)?
                {
                    return Err("Open 版本较旧，未降级现有 Skill".into());
                }
                if old.version == package.version && old.revision != package.revision {
                    return Err("Open 修改了相同版本的内容，请发布新的 Skill 版本号".into());
                }
                if old.revision == package.revision && old.automatic == automatic {
                    self.register(Installation {
                        path: path.into(),
                        source: source.into(),
                        automatic,
                        checked_at: now(),
                        last_error: None,
                    })?;
                    return Ok(old);
                }
            } else {
                unchanged(path, &files, false)?;
            }
        }
        let stage = parent.join(format!(".zerror-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&stage).map_err(|_| "无法创建 Skill 暂存目录")?;
        let record = Receipt {
            schema_version: 1,
            name: package.name.clone(),
            source: source.into(),
            version: package.version.clone(),
            revision: package.revision.clone(),
            automatic,
            files,
        };
        let result = (|| {
            for f in &package.files {
                let dest = stage.join(&f.path);
                fs::create_dir_all(dest.parent().unwrap())
                    .map_err(|_| "无法创建 Skill 文件目录")?;
                fs::write(dest, &f.content).map_err(|_| "无法写入 Skill 文件")?;
            }
            write_json(&stage.join(RECEIPT), &record)?;
            if path.exists() {
                if path.join(RECEIPT).exists() {
                    let old = receipt(path)?;
                    unchanged(path, &old.files, true)?;
                } else {
                    // 仅接管与官方内容完全一致的副本；替换前先登记来源，
                    // 使中断恢复也能识别并还原该副本的备份。
                    unchanged(path, &record.files, false)?;
                    write_json(&path.join(RECEIPT), &record)?;
                }
                fs::rename(path, &backup).map_err(|_| "无法替换正在使用的 Skill")?;
            }
            if fs::rename(&stage, path).is_err() {
                if backup.exists() {
                    let _ = fs::rename(&backup, path);
                }
                return Err("Skill 替换失败，已尝试恢复原版本".into());
            }
            if let Err(error) = self.register(Installation {
                path: path.into(),
                source: source.into(),
                automatic,
                checked_at: now(),
                last_error: None,
            }) {
                if fs::rename(path, &stage).is_err() {
                    return Err(format!("{error}；新文件已写入但登记失败，备份已保留"));
                }
                if backup.exists() && fs::rename(&backup, path).is_err() {
                    return Err(format!("{error}；原版本保留在备份目录，下次安装时恢复"));
                }
                return Err(error);
            }
            if backup.exists() {
                let old = receipt(&backup)?;
                unchanged(&backup, &old.files, true)?;
                fs::remove_dir_all(&backup).map_err(|_| "Skill 已更新，但旧版备份未能清理")?;
            }
            Ok(record)
        })();
        if stage.exists() {
            let _ = fs::remove_dir_all(&stage);
        }
        result
    }
}
