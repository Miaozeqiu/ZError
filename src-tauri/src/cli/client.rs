#[path = "client/args.rs"]
mod args;
#[path = "client/platform.rs"]
mod platform;
#[path = "client/path_config.rs"]
mod path_config;
#[path = "skills/mod.rs"]
pub(crate) mod skills;
#[path = "client/transport.rs"]
pub(crate) mod transport;
#[path = "client/wait.rs"]
mod wait;
pub use platform::install;

/// Linux 安装包的 zerror 同时是桌面入口；只有明确的命令行参数才进入 CLI。
pub fn is_cli_argument(argument: &str) -> bool {
    matches!(argument, "--help" | "-h" | "--version" | "call" | "status" | "app" | "config" | "models" | "accounts" | "folders" | "questions" | "server" | "agent" | "browser" | "websites" | "tools" | "cli" | "skill" | "methods")
}

#[test]
fn cli_arguments_do_not_capture_desktop_or_elevation_options() {
    for argument in ["status", "config", "--help", "--version"] { assert!(is_cli_argument(argument)); }
    for argument in ["", "--elevated", "--type=renderer", "--no-sandbox"] { assert!(!is_cli_argument(argument)); }
}
use serde_json::{json, Value};
use std::{
    io::Read,
    time::{Duration, Instant},
};
use transport::{read_endpoint, request, request_with_timeout, MAX_BODY};
const HELP: &str = r#"ZError CLI — 控制本机已安装的 ZError

用法: zerror <命令> [参数] [--json <JSON 或 ->] [--no-start]
      zerror call <方法> --json -

  status                          软件、模型、题库服务状态
  app show                        显示软件窗口
  config get [key]                 查看配置（敏感信息脱敏）
  config set <key> <JSON值>        修改配置，例如 theme '"dark"'
  models list                     列出模型与供应商
  models add --json -             从标准输入添加供应商和模型
  models select --json '{"id":"…","role":"agent"}'
  accounts list / set --json -     网站账号（账号密码只通过标准输入传入）
  folders list / add / rename / delete --json …
  questions list / search / add / update / delete --json …
  server status / start / stop    题库 HTTP 服务
  agent list / run <任务> / status <id> / stop <id>
  agent run <任务> --wait [--timeout 600] [--session <id>]
  agent status <对话ID> --message <消息ID>  查询指定任务
  agent stop <对话ID> --message <消息ID>    停止指定任务
  browser list / open <网址> / state <id>
  websites list / install / refresh / remove --json …
  tools list                      可用工具及其参数
  tools run --json …              在对话中执行工具，返回任务 ID
  cli install                     安装用户级 zerror 命令
  skill install --agent <名称>     从 Open 安装外部 Agent 的 Skill
  skill install --dir <skills目录> 安装到其他 Agent 的技能目录
  skill list / check / update      查看、检查或升级已安装 Skill
  skill sync                      按后台更新间隔同步登记的安装
                                  --no-auto-update 禁用该安装的后台更新
  methods                         查看全部方法与参数

--json - 从标准输入读取 JSON；输出始终是 JSON，成功退出码 0，参数错误 2，
连接错误 3，操作失败 4，等待超时 5。默认自动启动同一安装目录的软件。
CLI 复用桌面进程，审批、验证码和系统凭据授权仍在软件中处理。
文档: docs/cli.md
"#;

pub fn main(args: Vec<String>) -> i32 {
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{HELP}");
        return 0;
    }
    if args == ["--version"] {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return 0;
    }
    if args.first().map(String::as_str) == Some("skill") {
        let (value, code) = skills::command(&args[1..]);
        println!("{value}");
        return code;
    }
    if args == ["cli", "install"] {
        return output(
            install().map(|result| json!({"ok":true,"result":result})),
            4,
        );
    }
    let parsed = match args::parse(args, || {
        let mut s = String::new();
        std::io::stdin()
            .take((MAX_BODY + 1) as u64)
            .read_to_string(&mut s)
            .map_err(|_| "无法读取标准输入")?;
        if s.len() > MAX_BODY {
            return Err("标准输入超过 2 MiB".into());
        }
        Ok(s)
    }) {
        Ok(v) => v,
        Err(error) => return output(Err(error), 2),
    };
    let mut response = read_endpoint()
        .and_then(|endpoint| request(&endpoint, &parsed.method, parsed.params.clone()));
    if !parsed.no_start {
        // 仅重试尚未分发的连接失败，例如连接文件缺失或 TCP 连接被拒绝。
        let start_app = matches!(
            response.as_ref().err().map(String::as_str),
            Some("软件尚未启动或 CLI 尚未就绪" | "无法连接软件的 CLI 接口")
        );
        let not_ready = response
            .as_ref()
            .ok()
            .map(|value| value["code"] == "not_ready")
            .unwrap_or(false);
        if start_app {
            if let Err(error) = platform::launch() {
                return output(Err(error), 3);
            }
        }
        if start_app || not_ready {
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(25) {
                std::thread::sleep(Duration::from_millis(250));
                // 仅探测界面是否就绪，不重放原始修改请求。
                if let Ok(endpoint) = read_endpoint() {
                    if let Ok(ready) = request(&endpoint, "status", json!({})) {
                        if ready.get("ok") == Some(&Value::Bool(true)) {
                            response = request(&endpoint, &parsed.method, parsed.params.clone());
                            break;
                        }
                        if ready.get("code").and_then(Value::as_str) != Some("not_ready") {
                            response = Ok(ready);
                            break;
                        }
                    }
                }
            }
        }
    }
    let mut response = match response {
        Ok(v) => v,
        Err(e) => return output(Err(e), 3),
    };
    if parsed.wait && response["ok"] == true {
        response = match wait::wait_for_task(
            &response,
            Duration::from_secs(parsed.timeout),
            |task, remaining| {
                let endpoint = read_endpoint()?;
                request_with_timeout(
                    &endpoint,
                    "agent.status",
                    json!({"id":task.id,"messageId":task.message_id}),
                    remaining.min(Duration::from_secs(35)),
                )
            },
            std::thread::sleep,
        ) {
            Ok(value) => value,
            Err(wait::WaitError::Connection(error)) => return output(Err(error), 3),
            Err(wait::WaitError::Protocol(error)) => return output(Err(error.into()), 4),
            Err(wait::WaitError::Timeout(task)) => {
                println!(
                    "{}",
                    json!({"ok":false,"code":"wait_timeout","id":task.id,"messageId":task.message_id,"error":"等待超时，任务继续运行，可使用 agent status 查询或 agent stop 停止"})
                );
                return 5;
            }
        };
    }
    output(Ok(response), 4)
}
fn output(result: Result<Value, String>, code: i32) -> i32 {
    let value = result.unwrap_or_else(|error| json!({"ok":false,"error":error}));
    let exit = if value["ok"] == true { 0 } else { code };
    println!("{}", value);
    exit
}
