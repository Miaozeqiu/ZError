use serde_json::{json, Value};
#[derive(Debug, PartialEq)]
pub(super) struct Parsed {
    pub(super) method: String,
    pub(super) params: Value,
    pub(super) no_start: bool,
    pub(super) wait: bool,
    pub(super) timeout: u64,
}

pub(super) fn parse(
    mut args: Vec<String>,
    input: impl FnOnce() -> Result<String, String>,
) -> Result<Parsed, String> {
    let mut data = json!({});
    let mut no_start = false;
    let mut wait = false;
    let mut timeout = 600;
    let mut session = None;
    let mut message = None;
    let mut stdin = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--no-start" => {
                no_start = true;
                args.remove(i);
            }
            "--wait" => {
                wait = true;
                args.remove(i);
            }
            "--timeout" | "--session" | "--message" | "--json" => {
                let flag = args.remove(i);
                if i == args.len() {
                    return Err(format!("{flag} 缺少值"));
                }
                let value = args.remove(i);
                match flag.as_str() {
                    "--timeout" => {
                        timeout = value.parse().map_err(|_| "--timeout 必须是秒数")?;
                        if timeout == 0 || timeout > 86400 {
                            return Err("--timeout 范围为 1–86400 秒".into());
                        }
                    }
                    "--session" => session = Some(value),
                    "--message" => message = Some(value),
                    _ => {
                        if data != json!({}) || stdin {
                            return Err("--json 不能重复".into());
                        }
                        if value == "-" {
                            stdin = true;
                        } else {
                            data =
                                serde_json::from_str(&value).map_err(|_| "--json 不是合法 JSON")?;
                        }
                    }
                }
            }
            value if value.starts_with("--") => return Err(format!("未知选项：{value}")),
            _ => i += 1,
        }
    }
    if stdin {
        data = serde_json::from_str(&input()?).map_err(|_| "标准输入不是合法 JSON")?;
    }
    if !data.is_object() {
        return Err("参数必须是 JSON 对象".into());
    }
    let method = match args.first().map(String::as_str) {
        Some("status" | "methods") if args.len() == 1 => args[0].clone(),
        Some("call") if args.len() == 2 => args[1].clone(),
        Some(_) if args.len() >= 2 => format!("{}.{}", args[0], args[1]),
        _ => return Err("缺少命令；运行 zerror --help 查看用法".into()),
    };
    let rest = if args.first().map(String::as_str) == Some("call") {
        &args[args.len()..]
    } else {
        &args[2.min(args.len())..]
    };
    match (method.as_str(), rest) {
        ("config.get", [key]) => data["key"] = json!(key),
        ("config.set", [key, value]) => {
            data["key"] = json!(key);
            data["value"] = serde_json::from_str(value)
                .map_err(|_| "配置值必须是合法 JSON，如 true、123 或 \"dark\"")?;
        }
        ("agent.run", [text]) => data["text"] = json!(text),
        ("agent.status" | "agent.stop" | "browser.state" | "tools.result", [id]) => {
            data["id"] = json!(id)
        }
        ("browser.open", [url]) => data["url"] = json!(url),
        (_, []) => (),
        _ => return Err("此命令不接受这些位置参数；使用 --json 传入参数".into()),
    }
    if let Some(id) = session {
        if id.trim().is_empty() {
            return Err("--session 不能为空".into());
        }
        data["sessionId"] = json!(id);
    }
    if let Some(id) = message {
        if id.trim().is_empty() {
            return Err("--message 不能为空".into());
        }
        data["messageId"] = json!(id);
    }
    if wait && method != "agent.run" && method != "tools.run" {
        return Err("--wait 仅用于 agent run 或 tools run".into());
    }
    // 密码和密钥只能从标准输入读取，避免进入终端历史和进程参数。
    if !stdin
        && (method == "accounts.set"
            || method == "models.add"
            || method == "models.key"
            || data
                .get("key")
                .and_then(Value::as_str)
                .map(secret_name)
                .unwrap_or(false)
            || has_secret_key(&data))
    {
        return Err("账号、密码和密钥配置必须通过 --json - 从标准输入读取".into());
    }
    Ok(Parsed {
        method,
        params: data,
        no_start,
        wait,
        timeout,
    })
}

fn has_secret_key(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(k, v)| secret_name(k) || has_secret_key(v)),
        Value::Array(items) => items.iter().any(has_secret_key),
        _ => false,
    }
}

fn secret_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "password",
        "apikey",
        "api_key",
        "token",
        "authorization",
        "cookie",
        "secret",
    ]
    .iter()
    .any(|part| name.contains(part))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(args: &[&str], stdin: &str) -> Result<Parsed, String> {
        parse(args.iter().map(|s| s.to_string()).collect(), || {
            Ok(stdin.into())
        })
    }
    #[test]
    fn friendly_commands() {
        assert_eq!(
            p(&["config", "set", "theme", "\"dark\""], "")
                .unwrap()
                .params,
            json!({"key":"theme","value":"dark"})
        );
        assert_eq!(
            p(
                &["agent", "run", "read this", "--wait", "--session", "abc"],
                ""
            )
            .unwrap()
            .params,
            json!({"text":"read this","sessionId":"abc"})
        );
        assert!(p(&["agent", "run", "x", "y"], "").is_err());
    }
    #[test]
    fn secrets_only_via_stdin() {
        assert!(p(
            &["accounts", "set", "--json", "{\"password\":\"secret\"}"],
            ""
        )
        .is_err());
        assert!(p(
            &["call", "accounts.set", "--json", "-"],
            "{\"password\":\"secret\"}"
        )
        .is_ok());
        assert!(p(
            &[
                "call",
                "config.set",
                "--json",
                "{\"value\":{\"apiKey\":\"x\"}}"
            ],
            ""
        )
        .is_err());
    }
    #[test]
    fn invalid_cli_arguments() {
        for args in [
            &["status", "--timeout"][..],
            &["status", "--unknown"],
            &["status", "--wait"],
            &["status", "--json", "[]"],
            &["status", "--timeout", "0"],
        ] {
            assert!(p(args, "").is_err());
        }
    }
    #[test]
    fn accepts_scoped_status_and_rejects_empty_task_identity() {
        assert_eq!(
            p(&["agent", "status", "session", "--message", "task"], "")
                .unwrap()
                .params,
            json!({"id":"session","messageId":"task"})
        );
        assert!(p(&["agent", "status", "session", "--message", ""], "").is_err());
        assert!(p(&["agent", "run", "text", "--session", ""], "").is_err());
    }
}
