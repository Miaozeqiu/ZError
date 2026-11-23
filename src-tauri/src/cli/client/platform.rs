use super::transport::{directory, private_directory};
use serde_json::{json, Value};
#[cfg(not(windows))]
use std::path::PathBuf;
#[cfg(not(windows))]
use std::process::Command;
use std::{fs, path::Path};
pub(super) fn launch() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if let Some(image) = std::env::var_os("APPIMAGE") {
        return spawn(Path::new(&image));
    }
    let executable = std::env::current_exe().map_err(|_| "无法定位软件")?;
    let parent = executable.parent().ok_or("无法定位软件目录")?;
    #[cfg(windows)]
    let names = ["ZError.exe", "zerror.exe"];
    #[cfg(not(windows))]
    let names = ["ZError", "zerror"];
    for name in names {
        let app = parent.join(name);
        if app.is_file() && app != executable {
            return spawn(&app);
        }
    }
    Err("未找到同一安装目录的 ZError，请先启动软件".into())
}
#[cfg(windows)]
fn spawn(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::{
            Foundation::CloseHandle,
            System::Threading::{
                CreateProcessW, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS, PROCESS_INFORMATION,
                STARTUPINFOW,
            },
        },
    };
    let executable: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    let mut process = PROCESS_INFORMATION::default();
    // 桌面进程不能继承 CLI 调用方的管道；否则输出已返回，外部 Agent 仍等不到 EOF。
    // 单独传入程序路径，避免空格、引号或中文路径被命令行再次解析。
    unsafe {
        CreateProcessW(
            PCWSTR(executable.as_ptr()),
            PWSTR::null(),
            None,
            None,
            false,
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            None,
            PCWSTR::null(),
            &startup,
            &mut process,
        )
        .map_err(|_| "无法启动 ZError，请手动启动软件后重试")?;
        let _ = CloseHandle(process.hThread);
        let _ = CloseHandle(process.hProcess);
    }
    Ok(())
}

#[cfg(not(windows))]
fn spawn(path: &Path) -> Result<(), String> {
    let mut command = Command::new(path);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // fork 与 exec 之间仅执行具备异步信号安全保证的 setsid 系统调用。
        // 图形界面应在终端或 CLI 进程退出后继续运行，自动化调用也保持这一行为。
        unsafe {
            extern "C" {
                fn setsid() -> std::os::raw::c_int;
            }
            command.pre_exec(|| {
                if setsid() == -1 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|_| "无法启动 ZError，请手动启动软件后重试".into())
}

pub fn install() -> Result<Value, String> {
    private_directory(&directory()?)?;
    let source = std::env::current_exe().map_err(|_| "无法定位 CLI")?;
    let source = source
        .parent()
        .ok_or("无法定位安装目录")?
        .join(if cfg!(windows) {
            "zerror-cli.exe"
        } else {
            "zerror-cli"
        });
    if !source.is_file() {
        return Err("当前安装包缺少 zerror-cli，请重新安装完整软件".into());
    }
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() && source.parent() == Some(Path::new("/usr/bin")) {
        return Ok(
            json!({"path":"/usr/bin/zerror","pathDirectory":"/usr/bin","onPath":true,"pathConfigured":true,"message":"已安装，可运行 zerror --help"}),
        );
    }
    #[cfg(windows)]
    let target = directory()?
        .parent()
        .ok_or("无法定位用户目录")?
        .join("bin/zerror.cmd");
    #[cfg(not(windows))]
    let target = PathBuf::from(std::env::var_os("HOME").ok_or("无法定位用户目录")?)
        .join(".local/bin/zerror");
    fs::create_dir_all(target.parent().unwrap()).map_err(|_| "无法创建命令目录")?;
    if target.exists()
        && !fs::read_to_string(&target)
            .unwrap_or_default()
            .contains("# ZError CLI launcher")
    {
        return Err("目标 zerror 命令已存在，未覆盖；请先检查用户命令目录".into());
    }
    #[cfg(windows)]
    let content = {
        let path = source.to_string_lossy();
        if path.contains(['%', '\n', '\r', '"']) {
            return Err("安装路径包含命令脚本不支持的字符".into());
        }
        // 按 UTF-8 读取启动器，兼容包含中文的 Windows 用户名。
        format!("@echo off\r\nchcp 65001 >nul\r\nrem # ZError CLI launcher\r\n\"{path}\" %*\r\n")
    };
    #[cfg(not(windows))]
    let content = {
        #[cfg(target_os = "linux")]
        let image = std::env::var_os("APPIMAGE");
        #[cfg(not(target_os = "linux"))]
        let image: Option<std::ffi::OsString> = None;
        let (path, extra) = if let Some(ref image) = image {
            (Path::new(image), " cli")
        } else {
            (source.as_path(), "")
        };
        format!(
            "#!/bin/sh\n# ZError CLI launcher\nexec '{}'{} \"$@\"\n",
            path.to_string_lossy().replace('\'', "'\\''"),
            extra
        )
    };
    if fs::read_to_string(&target).ok().as_deref() != Some(content.as_str()) {
        fs::write(&target, content).map_err(|_| "无法安装用户命令")?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
            .map_err(|_| "无法设置命令执行权限")?;
    }
    let bin = target.parent().unwrap();
    let profiles = super::path_config::configure(bin)?;
    let on_path = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|p| p == bin))
        .unwrap_or(false);
    Ok(
        json!({"path": target,"onPath":on_path,"pathConfigured":true,"profiles":profiles,"message":if on_path {"已安装并配置，可运行 zerror --help"} else {"已安装并自动配置 PATH，重新打开终端后可运行 zerror --help。"},"pathDirectory":bin}),
    )
}
