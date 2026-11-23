use std::path::{Path, PathBuf};

#[cfg(unix)]
const START: &str = "# >>> ZError CLI >>>";
#[cfg(unix)]
const END: &str = "# <<< ZError CLI <<<";
#[cfg(unix)]
const POSIX: &str = "case \":${PATH-}:\" in\n  *\":$HOME/.local/bin:\"*) ;;\n  *) export PATH=\"$HOME/.local/bin${PATH:+:$PATH}\" ;;\nesac";

/// 仅更新带标记的配置块，保留用户原有配置；重复安装不重复追加。
#[cfg(unix)]
fn ensure_block(path: &Path, body: &str) -> Result<(), String> {
    use std::fs;
    let before = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Err(format!("无法读取终端配置：{}", path.display())),
    };
    let block = format!("{START}\n{body}\n{END}\n");
    let after = if let Some(start) = before.find(START) {
        let end = before[start..]
            .find(END)
            .ok_or("CLI 配置块不完整，未覆盖终端配置")?
            + start
            + END.len();
        let end = end + usize::from(before[end..].starts_with('\n'));
        format!("{}{}{}", &before[..start], block, &before[end..])
    } else {
        format!(
            "{}{}{block}",
            before,
            if before.is_empty() || before.ends_with('\n') {
                ""
            } else {
                "\n"
            }
        )
    };
    if before != after {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|_| "无法创建终端配置目录")?;
        }
        // 先完整写入再原子替换，磁盘写入失败也不能截断用户的终端配置；保留 dotfiles 符号链接。
        let actual = if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
            fs::canonicalize(path).map_err(|_| "终端配置符号链接无效，未覆盖")?
        } else {
            path.to_path_buf()
        };
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "系统时间异常")?
            .as_nanos();
        let temporary =
            actual.with_file_name(format!(".zerror-path-{}-{stamp}.tmp", std::process::id()));
        let result = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?;
            if let Ok(meta) = fs::metadata(&actual) {
                file.set_permissions(meta.permissions())?;
            }
            file.write_all(after.as_bytes())?;
            file.sync_all()?;
            fs::rename(&temporary, &actual)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(|_| format!("无法更新终端配置：{}", path.display()))?;
    }
    Ok(())
}

#[cfg(unix)]
fn configure_unix(
    home: &Path,
    shell: &str,
    zdotdir: Option<PathBuf>,
    config_home: Option<PathBuf>,
) -> Result<Vec<PathBuf>, String> {
    let files = if shell.ends_with("fish") {
        vec![config_home
            .unwrap_or_else(|| home.join(".config"))
            .join("fish/conf.d/zerror.fish")]
    } else if shell.ends_with("zsh") {
        let directory = zdotdir.unwrap_or_else(|| home.to_path_buf());
        vec![directory.join(".zshenv"), directory.join(".zshrc")]
    } else {
        // Bash 登录配置只读取第一个存在的文件，不能新建 .bash_profile 遮住原 .profile。
        let login = [".bash_profile", ".bash_login", ".profile"]
            .iter()
            .map(|name| home.join(name))
            .find(|path| path.is_file())
            .unwrap_or_else(|| home.join(".profile"));
        vec![login, home.join(".bashrc")]
    };
    let body = if shell.ends_with("fish") {
        "if not contains -- \"$HOME/.local/bin\" $PATH\n  set -gx PATH \"$HOME/.local/bin\" $PATH\nend"
    } else {
        POSIX
    };
    for path in &files {
        ensure_block(path, body)?;
    }
    Ok(files)
}

pub(super) fn configure(bin: &Path) -> Result<Vec<PathBuf>, String> {
    #[cfg(windows)]
    {
        windows_path::configure(bin)?;
        Ok(Vec::new())
    }
    #[cfg(unix)]
    {
        let _ = bin;
        let home = PathBuf::from(std::env::var_os("HOME").ok_or("无法定位用户目录")?);
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh"
            } else {
                "/bin/bash"
            }
            .into()
        });
        let zdotdir = std::env::var_os("ZDOTDIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        if shell.ends_with("zsh") && zdotdir.as_ref().is_some_and(|path| !path.is_absolute()) {
            return Err("ZDOTDIR 不是绝对路径，未修改终端配置".into());
        }
        let config_home = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute());
        configure_unix(&home, &shell, zdotdir, config_home)
    }
}

#[cfg(any(windows, test))]
fn append_windows_path(current: &str, bin: &str) -> String {
    let normalize = |value: &str| {
        value
            .trim()
            .trim_matches('"')
            .trim_end_matches(['\\', '/'])
            .replace('/', "\\")
            .to_lowercase()
    };
    if current
        .split(';')
        .any(|item| normalize(item) == normalize(bin))
    {
        return current.into();
    }
    format!(
        "{current}{}{bin}",
        if current.is_empty() || current.ends_with(';') {
            ""
        } else {
            ";"
        }
    )
}

#[cfg(windows)]
mod windows_path {
    use super::*;
    use windows::{
        core::w,
        Win32::{
            Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, LPARAM, WPARAM},
            System::Registry::*,
            UI::WindowsAndMessaging::{
                SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
            },
        },
    };
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }
    pub(super) fn configure(bin: &Path) -> Result<(), String> {
        unsafe {
            let mut key = HKEY::default();
            let opened = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                w!("Environment"),
                0,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_QUERY_VALUE | KEY_SET_VALUE,
                None,
                &mut key,
                None,
            );
            if opened != ERROR_SUCCESS {
                return Err("无法打开当前用户环境变量".into());
            }
            let key = Key(key);
            let mut size = 0u32;
            let mut kind = REG_EXPAND_SZ;
            let read = RegQueryValueExW(
                key.0,
                w!("Path"),
                None,
                Some(&mut kind),
                None,
                Some(&mut size),
            );
            if read != ERROR_SUCCESS && read != ERROR_FILE_NOT_FOUND {
                return Err("无法读取用户 PATH".into());
            }
            if read == ERROR_SUCCESS && kind != REG_SZ && kind != REG_EXPAND_SZ {
                return Err("用户 PATH 格式异常，未覆盖".into());
            }
            if size > 1_000_000 {
                return Err("用户 PATH 长度异常，未覆盖".into());
            }
            let mut words = vec![0u16; (size as usize + 1) / 2];
            if size > 0
                && RegQueryValueExW(
                    key.0,
                    w!("Path"),
                    None,
                    Some(&mut kind),
                    Some(words.as_mut_ptr().cast()),
                    Some(&mut size),
                ) != ERROR_SUCCESS
            {
                return Err("无法读取用户 PATH".into());
            }
            while words.last() == Some(&0) {
                words.pop();
            }
            let current = String::from_utf16(&words).map_err(|_| "用户 PATH 编码异常，未覆盖")?;
            let next = append_windows_path(&current, &bin.to_string_lossy());
            if next != current {
                // 不从进程 PATH 回写注册表，不展开或截断已有的 %变量%。
                let bytes: Vec<u8> = next
                    .encode_utf16()
                    .chain(Some(0))
                    .flat_map(u16::to_le_bytes)
                    .collect();
                if RegSetValueExW(key.0, w!("Path"), 0, kind, Some(&bytes)) != ERROR_SUCCESS {
                    return Err("无法保存用户 PATH".into());
                }
                let _ = SendMessageTimeoutW(
                    HWND_BROADCAST,
                    WM_SETTINGCHANGE,
                    WPARAM(0),
                    LPARAM(w!("Environment").as_ptr() as isize),
                    SMTO_ABORTIFHUNG,
                    1000,
                    None,
                );
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_path_preserves_variables_and_deduplicates_case_and_slashes() {
        let original = "%USERPROFILE%\\tools;C:\\用户\\bin;";
        assert_eq!(append_windows_path(original, "c:/用户/bin/"), original);
        assert_eq!(
            append_windows_path(original, "C:\\ZError\\bin"),
            "%USERPROFILE%\\tools;C:\\用户\\bin;C:\\ZError\\bin"
        );
        assert_eq!(
            append_windows_path("", "C:\\ZError\\bin"),
            "C:\\ZError\\bin"
        );
    }
    #[cfg(unix)]
    fn home() -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("zerror-path-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }
    #[cfg(unix)]
    #[test]
    fn zsh_configuration_is_idempotent_and_preserves_user_content() {
        let root = home();
        let dot = root.join("dot files");
        std::fs::create_dir_all(&dot).unwrap();
        std::fs::write(dot.join(".zshrc"), "# 用户配置\nexport EDITOR=vim").unwrap();
        configure_unix(&root, "/bin/zsh", Some(dot.clone()), None).unwrap();
        let first = std::fs::read(dot.join(".zshrc")).unwrap();
        configure_unix(&root, "/bin/zsh", Some(dot.clone()), None).unwrap();
        assert_eq!(first, std::fs::read(dot.join(".zshrc")).unwrap());
        assert!(String::from_utf8(first)
            .unwrap()
            .starts_with("# 用户配置\nexport EDITOR=vim\n"));
        assert!(dot.join(".zshenv").is_file());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn bash_preserves_login_precedence_and_new_shell_can_find_command() {
        use std::os::unix::fs::PermissionsExt;
        let root = home();
        std::fs::write(root.join(".profile"), "# 原登录配置\n").unwrap();
        configure_unix(&root, "/bin/bash", None, None).unwrap();
        assert!(!root.join(".bash_profile").exists());
        let bin = root.join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("zerror"), "#!/bin/sh\nprintf ready").unwrap();
        std::fs::set_permissions(bin.join("zerror"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        let result = std::process::Command::new("/bin/bash")
            .args([
                "--noprofile",
                "--norc",
                "-c",
                ". \"$HOME/.bashrc\"; . \"$HOME/.bashrc\"; zerror; printf '\\n%s' \"$PATH\"",
            ])
            .env("HOME", &root)
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap();
        assert!(result.status.success());
        let output = String::from_utf8(result.stdout).unwrap();
        assert!(output.starts_with("ready\n"));
        assert_eq!(output.matches(".local/bin").count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn fish_and_invalid_managed_block_do_not_overwrite_user_settings() {
        let root = home();
        let config = root.join("配置");
        let files = configure_unix(&root, "/usr/bin/fish", None, Some(config.clone())).unwrap();
        assert_eq!(files, vec![config.join("fish/conf.d/zerror.fish")]);
        let path = root.join(".zshrc");
        std::fs::write(&path, START).unwrap();
        assert!(ensure_block(&path, POSIX).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), START);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn profile_update_preserves_dotfile_symlink_and_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = home();
        let actual = root.join("dotfile");
        let link = root.join(".zshrc");
        std::fs::write(&actual, "# 用户配置\n").unwrap();
        std::fs::set_permissions(&actual, std::fs::Permissions::from_mode(0o600)).unwrap();
        symlink(&actual, &link).unwrap();
        ensure_block(&link, POSIX).unwrap();
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            std::fs::metadata(&actual).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(std::fs::read_to_string(&actual)
            .unwrap()
            .starts_with("# 用户配置\n"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
