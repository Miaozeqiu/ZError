use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

const MCP_PROTOCOL_VERSION: &str = "2025-03-26";

fn error_message(error: &Value) -> String {
    if let Some(message) = error.get("message").and_then(|value| value.as_str()) {
        return message.to_string();
    }
    if let Some(message) = error
        .get("data")
        .and_then(|data| data.get("message"))
        .and_then(|value| value.as_str())
    {
        return message.to_string();
    }
    error.to_string()
}

async fn write_json_line(stdin: &mut ChildStdin, payload: &Value) -> Result<(), String> {
    let mut line =
        serde_json::to_string(payload).map_err(|error| format!("序列化 MCP 消息失败: {error}"))?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|error| format!("写入 MCP stdin 失败: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("刷新 MCP stdin 失败: {error}"))?;
    Ok(())
}

async fn terminate_child(child: &mut tokio::process::Child) {
    #[cfg(target_os = "windows")]
    if let Some(pid) = child.id() {
        // cmd /C 会再拉起 npx/node，必须连同子进程树一起结束
        let pid_text = pid.to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", pid_text.as_str(), "/T", "/F"])
            .output()
            .await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn read_response(reader: &mut BufReader<ChildStdout>, id: u64) -> Result<Value, String> {
    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .await
            .map_err(|error| format!("读取 MCP stdout 失败: {error}"))?;
        if bytes == 0 {
            return Err("MCP 进程已退出（未返回响应）".to_string());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let payload: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(_) => {
                // 有些本地 server 会把启动日志混在 stdout，跳过非 JSON 行
                continue;
            }
        };

        if payload.get("id").and_then(|value| value.as_u64()) != Some(id) {
            continue;
        }

        if let Some(error) = payload.get("error") {
            return Err(format!("MCP 错误: {}", error_message(error)));
        }

        return Ok(payload.get("result").cloned().unwrap_or(Value::Null));
    }
}

/// 启动本地 stdio MCP Server，完成 initialize / tools/call 后退出。
/// 每次搜索独立起进程，避免长期持有子进程和会话状态。
#[tauri::command]
pub async fn mcp_stdio_search(
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    tool_name: String,
    arguments: Value,
    timeout_secs: Option<u64>,
) -> Result<Value, String> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("本地 MCP 启动命令为空".to_string());
    }

    let tool_name = tool_name.trim().to_string();
    if tool_name.is_empty() {
        return Err("MCP 工具名为空".to_string());
    }

    let timeout = Duration::from_secs(timeout_secs.unwrap_or(60).clamp(5, 300));

    let mut child_command = if cfg!(target_os = "windows") {
        // Windows 下 npx / node 等通常是 .cmd，通过 cmd /C 启动最稳妥
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(&command);
        cmd
    } else {
        Command::new(&command)
    };

    child_command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(env) = env {
        for (key, value) in env {
            if !key.trim().is_empty() {
                child_command.env(key, value);
            }
        }
    }

    let mut child = child_command
        .spawn()
        .map_err(|error| format!("启动本地 MCP 失败: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法写入本地 MCP stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取本地 MCP stdout".to_string())?;
    let stderr = child.stderr.take();

    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = stderr {
        let buffer = stderr_buffer.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut guard = buffer.lock().await;
                if guard.len() < 4000 {
                    guard.push_str(&line);
                    guard.push('\n');
                }
            }
        });
    }

    let result = tokio::time::timeout(timeout, async move {
        let mut reader = BufReader::new(stdout);

        write_json_line(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {
                        "name": "ZError",
                        "version": "2.2.7"
                    }
                }
            }),
        )
        .await?;
        read_response(&mut reader, 1).await?;

        write_json_line(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }),
        )
        .await?;

        write_json_line(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments
                }
            }),
        )
        .await?;

        read_response(&mut reader, 2).await
    })
    .await;

    // 无论成功失败都结束子进程，避免本地 MCP Server 残留
    terminate_child(&mut child).await;

    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => {
            let stderr_text = stderr_buffer.lock().await.clone();
            if stderr_text.trim().is_empty() {
                Err(error)
            } else {
                Err(format!("{}\nMCP stderr:\n{}", error, stderr_text.trim()))
            }
        }
        Err(_) => Err(format!("本地 MCP 搜索超时（{} 秒）", timeout.as_secs())),
    }
}

#[cfg(test)]
mod tests {
    use super::mcp_stdio_search;

    #[tokio::test]
    async fn stdio_search_round_trip() {
        let dir = std::env::temp_dir().join(format!("zerror-mcp-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let script_path = dir.join("mock-mcp-server.js");
        let script = r#"
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        serverInfo: { name: 'mock', version: '1.0.0' }
      }
    }));
    return;
  }
  if (message.method === 'tools/call') {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text: 'Title: Mock result\nURL: https://example.com' }]
      }
    }));
  }
});
"#;
        std::fs::write(&script_path, script).expect("write mock server");

        let result = mcp_stdio_search(
            "node".to_string(),
            vec![script_path.to_string_lossy().to_string()],
            None,
            "web_search_exa".to_string(),
            serde_json::json!({ "query": "test", "numResults": 1 }),
            Some(20),
        )
        .await;

        let _ = std::fs::remove_dir_all(&dir);
        let result = result.expect("mock mcp search should succeed");
        let text = result
            .get("content")
            .and_then(|content| content.get(0))
            .and_then(|block| block.get("text"))
            .and_then(|text| text.as_str())
            .unwrap_or("");
        assert!(text.contains("Mock result"), "unexpected result: {result}");
    }
}
