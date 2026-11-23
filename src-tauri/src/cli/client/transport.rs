use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(windows)]
use std::process::Command;
use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    time::Duration,
};
pub const MAX_BODY: usize = 2 * 1024 * 1024;
#[derive(Clone, Deserialize, Serialize)]
pub struct Endpoint {
    pub version: u32,
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

pub fn directory() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("ZError"));
    #[cfg(not(windows))]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|p| p.join(".local/share/zerror"));
    base.map(|p| p.join("cli"))
        .ok_or_else(|| "无法确定用户目录".into())
}

pub fn private_directory(path: &Path) -> Result<(), String> {
    if path
        .symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("CLI 目录不能是符号链接".into());
    }
    fs::create_dir_all(path).map_err(|_| "无法创建 CLI 用户目录")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护 CLI 目录")?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 不拼接终端命令；先为当前用户 SID 显式授权，再移除继承权限。
        let out = Command::new("whoami.exe")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW：启动图形界面时不弹出控制台。
            .args(["/user", "/fo", "csv", "/nh"])
            .output()
            .map_err(|_| "无法读取当前 Windows 用户 SID")?;
        let sid = String::from_utf8_lossy(&out.stdout)
            .split(',')
            .last()
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .to_string();
        if !out.status.success()
            || !sid.starts_with("S-1-")
            || !sid
                .chars()
                .all(|c| c.is_ascii_digit() || c == '-' || c == 'S')
        {
            return Err("无法验证 Windows 用户 SID".into());
        }
        let status = Command::new("icacls.exe")
            .creation_flags(0x08000000)
            .arg(path)
            .args([
                "/grant:r",
                &format!("*{sid}:(OI)(CI)F"),
                "*S-1-5-18:(OI)(CI)F",
                "/inheritance:r",
            ])
            .output()
            .map_err(|_| "无法保护 CLI 目录 ACL")?;
        if !status.status.success() {
            return Err("无法保护 CLI 目录 ACL".into());
        }
    }
    Ok(())
}

pub fn read_endpoint() -> Result<Endpoint, String> {
    let path = directory()?.join("endpoint.json");
    let metadata = fs::symlink_metadata(&path).map_err(|_| "软件尚未启动或 CLI 尚未就绪")?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return Err("无效的 CLI 连接信息".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("CLI 连接文件权限不安全，请重新启动软件".into());
        }
    }
    let endpoint: Endpoint =
        serde_json::from_slice(&fs::read(path).map_err(|_| "无法读取 CLI 连接信息")?)
            .map_err(|_| "CLI 连接信息无效")?;
    if endpoint.version != 1
        || endpoint.token.len() != 64
        || !endpoint.token.bytes().all(|b| b.is_ascii_hexdigit())
        || endpoint.port == 0
    {
        return Err("CLI 连接协议不受支持".into());
    }
    Ok(endpoint)
}

pub fn request(endpoint: &Endpoint, method: &str, params: Value) -> Result<Value, String> {
    request_with_timeout(endpoint, method, params, Duration::from_secs(35))
}

pub fn request_with_timeout(
    endpoint: &Endpoint,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let body =
        serde_json::to_vec(&json!({"method": method, "params": params})).map_err(|_| "无效请求")?;
    if body.len() > MAX_BODY {
        return Err("请求超过 2 MiB 限制".into());
    }
    let address = SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1))
        .map_err(|_| "无法连接软件的 CLI 接口")?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| "无法设置连接超时")?;
    stream
        .set_write_timeout(Some(timeout.min(Duration::from_secs(5))))
        .map_err(|_| "无法设置写入超时")?;
    write!(stream, "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n", endpoint.port, endpoint.token, body.len()).map_err(|_| "无法发送 CLI 请求")?;
    stream.write_all(&body).map_err(|_| "无法发送 CLI 请求")?;
    let mut response = Vec::new();
    stream
        .take((MAX_BODY + 8193) as u64)
        .read_to_end(&mut response)
        .map_err(|_| "CLI 连接中断或超时；操作可能已执行，请先查询状态，勿直接重试写操作")?;
    if response.len() > MAX_BODY + 8192 {
        return Err("CLI 返回内容过大".into());
    }
    decode_response(&response)
}

pub(super) fn decode_response(bytes: &[u8]) -> Result<Value, String> {
    let split = bytes
        .windows(4)
        .position(|s| s == b"\r\n\r\n")
        .ok_or("CLI HTTP 响应无效")?;
    let header = std::str::from_utf8(&bytes[..split]).map_err(|_| "CLI 响应头无效")?;
    if !header.starts_with("HTTP/1.1 200 ") {
        return Err("CLI 接口拒绝连接；请重启软件并使用同一用户重试".into());
    }
    serde_json::from_slice(&bytes[split + 4..]).map_err(|_| "CLI JSON 响应无效".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_only_valid_authenticated_endpoint_responses() {
        assert_eq!(
            decode_response(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"ok\":true}").unwrap(),
            json!({"ok":true})
        );
        assert!(decode_response(b"HTTP/1.1 403 Forbidden\r\n\r\n{}").is_err());
        assert!(decode_response(b"HTTP/1.1 200 OK\r\n\r\nnot-json").is_err());
    }
    #[test]
    fn request_size_limit_is_checked_before_connecting() {
        let endpoint = Endpoint {
            version: 1,
            port: 1,
            token: "a".repeat(64),
            pid: 1,
        };
        let error = request(
            &endpoint,
            "config.set",
            json!({"value":"x".repeat(MAX_BODY)}),
        )
        .unwrap_err();
        assert!(error.contains("2 MiB"));
    }
}
