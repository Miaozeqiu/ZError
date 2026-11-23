mod package;
mod store;
use package::{fetch, source_url, Package, DEFAULT_SOURCE};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, path::PathBuf};
use store::{Installation, Receipt};

struct Options {
    action: String,
    agent: Option<String>,
    dir: Option<PathBuf>,
    source: Option<String>,
    manual: bool,
}
fn parse(args: &[String]) -> Result<Options, String> {
    let mut options = Options {
        action: args.first().cloned().unwrap_or_default(),
        agent: None,
        dir: None,
        source: None,
        manual: false,
    };
    if !["install", "list", "check", "update", "sync"].contains(&options.action.as_str()) {
        return Err("用法：zerror skill install --agent codex|claude|cursor|pi|opencode|shared，或 skill list / check / update；--dir 可指定其他 Agent 的 skills 根目录".into());
    }
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--no-auto-update" => {
                options.manual = true;
                i += 1;
            }
            "--agent" | "--dir" | "--source" => {
                let flag = &args[i];
                let value = args
                    .get(i + 1)
                    .filter(|v| !v.is_empty() && !v.starts_with("--"))
                    .ok_or_else(|| format!("{flag} 缺少值"))?;
                match flag.as_str() {
                    "--agent" => {
                        if options.agent.replace(value.clone()).is_some() {
                            return Err("--agent 不能重复".into());
                        }
                    }
                    "--dir" => {
                        if options.dir.replace(PathBuf::from(value)).is_some() {
                            return Err("--dir 不能重复".into());
                        }
                    }
                    _ => {
                        if options.source.replace(source_url(value)?).is_some() {
                            return Err("--source 不能重复".into());
                        }
                    }
                }
                i += 2;
            }
            _ => return Err("未知 Skill 选项".into()),
        }
    }
    if options.action == "sync" && args.len() != 1 {
        return Err("skill sync 不接受选项；定期同步所有已登记的自动更新安装".into());
    }
    if options.agent.is_some() && options.dir.is_some() {
        return Err("--agent 与 --dir 只能指定一个".into());
    }
    if options.action == "install" && options.agent.is_none() && options.dir.is_none() {
        return Err("请通过 --agent 或 --dir 指定要安装到的 Agent".into());
    }
    Ok(options)
}
fn target(options: &Options, create: bool) -> Result<Option<PathBuf>, String> {
    let root = if let Some(dir) = &options.dir {
        dir.clone()
    } else if let Some(agent) = &options.agent {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .ok_or("无法确定用户目录")?;
        match agent.as_str() {
            "codex" => std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"))
                .join("skills"),
            "claude" => home.join(".claude/skills"),
            "cursor" => home.join(".cursor/skills"),
            "pi" => home.join(".pi/agent/skills"),
            "opencode" => std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
                .join("opencode/skills"),
            "shared" => home.join(".agents/skills"),
            _ => return Err("未知 Agent；其他工具请使用 --dir 指定 skills 根目录".into()),
        }
    } else {
        return Ok(None);
    };
    if create {
        fs::create_dir_all(&root).map_err(|_| "无法创建 Agent 的 skills 目录")?;
    }
    let root = if root.exists() {
        fs::canonicalize(&root).map_err(|_| "无法解析 skills 目录")?
    } else if root.is_absolute() {
        root
    } else {
        std::env::current_dir()
            .map_err(|_| "无法确定当前目录")?
            .join(root)
    };
    Ok(Some(root.join("zerror")))
}
fn result(record: &Receipt, path: &std::path::Path) -> Value {
    json!({"name":record.name,"version":record.version,"revision":record.revision,"path":path,"automatic":record.automatic,"source":record.source,"reloadHint":"文件已安装；当前 Agent 是否立即发现取决于其重载机制，必要时在下一轮或新会话使用。"})
}
fn operate(options: &Options, automatic: bool) -> Result<Value, String> {
    let store = store::Store::open()?;
    let selected = target(options, options.action == "install")?;
    if options.action == "install" {
        let path = selected.ok_or("缺少 Agent 目录")?;
        let source = options.source.as_deref().unwrap_or(DEFAULT_SOURCE);
        store.recover(&path, source)?;
        let package = fetch(source)?;
        let record = store.install(&path, source, &package, !options.manual)?;
        return Ok(result(&record, &path));
    }
    let entries = if let Some(path) = selected {
        let saved = store
            .installations()?
            .into_iter()
            .find(|row| row.path == path);
        if let Some(saved) = saved {
            store.recover(&path, &saved.source)?;
        }
        if !path.exists() {
            return Err("该 Agent 尚未安装 ZError Skill，请先 skill install".into());
        }
        let record = store::receipt(&path)?;
        vec![Installation {
            path,
            source: record.source,
            automatic: record.automatic,
            checked_at: 0,
            last_error: None,
        }]
    } else {
        store.installations()?
    };
    let mut packages: HashMap<String, Result<Package, String>> = HashMap::new();
    let mut rows = vec![];
    let mut failed = false;
    for mut entry in entries {
        if automatic
            && (!entry.automatic || store::now().saturating_sub(entry.checked_at) < 6 * 60 * 60)
        {
            continue;
        }
        let item = (|| {
            store.recover(&entry.path, &entry.source)?;
            let record = store::receipt(&entry.path)?;
            if automatic && !record.automatic {
                return Ok(result(&record, &entry.path));
            }
            if record.source != entry.source {
                return Err("Skill 登记来源不匹配，未更新".into());
            }
            if options.action == "list" {
                return Ok(result(&record, &entry.path));
            }
            let source = options.source.as_deref().unwrap_or(&record.source);
            if source != record.source {
                return Err("指定的 Open 地址与安装来源不匹配，未覆盖".into());
            }
            let package = packages
                .entry(source.to_string())
                .or_insert_with(|| fetch(source))
                .as_ref()
                .map_err(Clone::clone)?;
            if options.action == "check" {
                return Ok(
                    json!({"path":entry.path,"installedVersion":record.version,"availableVersion":package.version,"revision":package.revision,"updateAvailable":package::version(&package.version)?>package::version(&record.version)?,"automatic":record.automatic}),
                );
            }
            let updated = store.install(
                &entry.path,
                source,
                package,
                record.automatic && !options.manual,
            )?;
            Ok(result(&updated, &entry.path))
        })();
        match item {
            Ok(value) => rows.push(json!({"ok":true,"result":value})),
            Err(error) => {
                failed = true;
                rows.push(json!({"ok":false,"path":entry.path,"error":error}));
                if automatic {
                    entry.checked_at = store::now();
                    entry.last_error = Some(error);
                    let _ = store.register(entry);
                }
            }
        }
    }
    Ok(json!({"ok":!failed,"installations":rows}))
}
pub fn command(args: &[String]) -> (Value, i32) {
    let options = match parse(args) {
        Ok(options) => options,
        Err(error) => return (json!({"ok":false,"error":error}), 2),
    };
    let operation = if options.action == "sync" {
        sync_registered()
    } else if options.action == "install"
        && options.dir.is_none()
        && options.source.is_none()
        && !options.manual
    {
        install_for_agent(options.agent.clone().unwrap())
    } else if options.action == "update"
        && options.agent.is_none()
        && options.dir.is_none()
        && options.source.is_none()
        && !options.manual
    {
        update_registered()
    } else {
        operate(&options, false)
    };
    match operation {
        Ok(value) => {
            let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(true);
            (json!({"ok":ok,"result":value}), if ok { 0 } else { 4 })
        }
        Err(error) => (json!({"ok":false,"error":error}), 4),
    }
}
pub fn install_for_agent(agent: String) -> Result<Value, String> {
    operate(
        &Options {
            action: "install".into(),
            agent: Some(agent),
            dir: None,
            source: None,
            manual: false,
        },
        false,
    )
}
pub fn update_registered() -> Result<Value, String> {
    operate(
        &Options {
            action: "update".into(),
            agent: None,
            dir: None,
            source: None,
            manual: false,
        },
        false,
    )
}
pub fn sync_registered() -> Result<Value, String> {
    operate(
        &Options {
            action: "update".into(),
            agent: None,
            dir: None,
            source: None,
            manual: false,
        },
        true,
    )
}

#[cfg(test)]
mod tests;
