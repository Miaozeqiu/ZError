use std::env;
use std::ffi::{OsStr, OsString};
use std::fs::Permissions;
use std::io::ErrorKind;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Mutex, TryLockError};
use std::time::{Duration, Instant};

const READY_SOCKET_ENV: &str = "ZERROR_ELEVATION_SOCKET";
static RELAUNCH: Mutex<()> = Mutex::new(());

pub(crate) fn relaunch() -> Result<(), String> {
    let _request = RELAUNCH.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => "already_requested".to_string(),
        TryLockError::Poisoned(_) => "elevation_failed".to_string(),
    })?;
    let exe = relaunch_executable(env::var_os("APPIMAGE"), env::current_exe)?;

    // Use a private, short path to stay within Unix socket path limits.
    let dir = tempfile::Builder::new()
        .prefix("zerror-elevation-")
        .permissions(Permissions::from_mode(0o700))
        .tempdir_in("/tmp")
        .map_err(|error| error.to_string())?;
    let path = dir.path().join("ready");
    let listener = UnixListener::bind(&path).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let mut child = elevated_command(&exe, &path).spawn().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            "pkexec_not_found".to_string()
        } else {
            error.to_string()
        }
    })?;
    let result = wait_until_ready(&listener, &mut child, Duration::from_secs(180));
    if result.is_err() && child.kill().is_ok() {
        let _ = child.wait();
    }
    result
}

fn relaunch_executable(
    appimage: Option<OsString>,
    current_exe: impl FnOnce() -> std::io::Result<PathBuf>,
) -> Result<PathBuf, String> {
    let exe = match appimage.filter(|path| !path.is_empty()) {
        Some(path) => PathBuf::from(path),
        None => current_exe().map_err(|error| error.to_string())?,
    };
    if !exe.is_absolute() {
        return Err("invalid_elevation_path".to_string());
    }
    Ok(exe)
}

fn elevated_command(exe: &Path, ready_socket: &Path) -> Command {
    let mut command = Command::new("pkexec");
    command.args(["--disable-internal-agent", "/usr/bin/env"]);
    // pkexec clears the caller's environment. Keep the desktop session and AppImage fallback.
    for key in [
        "DISPLAY",
        "XAUTHORITY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE",
        "DBUS_SESSION_BUS_ADDRESS",
        "HOME",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "APPIMAGE_EXTRACT_AND_RUN",
    ] {
        if let Some(value) = env::var_os(key) {
            command.arg(assignment(key, &value));
        }
    }
    command.arg(assignment(READY_SOCKET_ENV, ready_socket.as_os_str()));
    command.arg(exe).arg("--elevated");
    command
}

fn assignment(key: &str, value: &OsStr) -> OsString {
    let mut pair = OsString::from(key);
    pair.push("=");
    pair.push(value);
    pair
}

fn wait_until_ready(
    listener: &UnixListener,
    child: &mut Child,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(match status.code() {
                Some(126) => "elevation_cancelled",
                Some(127) => "elevation_denied",
                _ => "elevation_failed",
            }
            .to_string());
        }
        match listener.accept() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == ErrorKind::WouldBlock => {}
            Err(error) => return Err(error.to_string()),
        }
        if Instant::now() >= deadline {
            return Err("elevation_timed_out".to_string());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

pub(crate) fn notify_ready(main_window_created: bool) -> std::io::Result<()> {
    if let Some(path) = env::var_os(READY_SOCKET_ENV) {
        if !main_window_created {
            return Err(std::io::Error::other(
                "Could not create the elevated window",
            ));
        }
        UnixStream::connect(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_appimage_path_as_a_single_argument() {
        let appimage = Path::new("/home/user/Downloads/ZError 2.2.9.AppImage");
        let socket = Path::new("/tmp/zerror-elevation-test/ready");
        let exe = relaunch_executable(Some(appimage.as_os_str().to_owned()), || {
            Ok(PathBuf::from("/tmp/.mount_zerror/usr/bin/zerror"))
        })
        .unwrap();
        let command = elevated_command(&exe, socket);
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(command.get_program(), "pkexec");
        assert_eq!(args[args.len() - 2], appimage.as_os_str());
        assert_eq!(args[args.len() - 1], "--elevated");
    }

    #[test]
    fn uses_current_executable_for_native_installation() {
        let exe = relaunch_executable(None, || Ok(PathBuf::from("/usr/bin/zerror"))).unwrap();
        assert_eq!(exe, Path::new("/usr/bin/zerror"));
    }

    #[test]
    fn cancelled_and_denied_authorization_never_report_ready() {
        let dir = tempfile::tempdir().unwrap();
        let listener = UnixListener::bind(dir.path().join("ready")).unwrap();
        listener.set_nonblocking(true).unwrap();
        for (script, expected) in [
            ("exit 126", "elevation_cancelled"),
            ("exit 127", "elevation_denied"),
            ("exit 0", "elevation_failed"),
        ] {
            let mut child = Command::new("/bin/sh")
                .args(["-c", script])
                .spawn()
                .unwrap();
            let result = wait_until_ready(&listener, &mut child, Duration::from_secs(5));
            assert_eq!(result.unwrap_err(), expected);
        }
    }

    #[test]
    fn waits_for_new_instance_to_signal_ready() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("ready");
        let listener = UnixListener::bind(&socket).unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut child = Command::new("/bin/sleep").arg("10").spawn().unwrap();
        let pending = wait_until_ready(&listener, &mut child, Duration::ZERO);
        let connection = UnixStream::connect(socket).unwrap();
        let ready = wait_until_ready(&listener, &mut child, Duration::from_secs(5));
        child.kill().unwrap();
        child.wait().unwrap();
        assert_eq!(pending.unwrap_err(), "elevation_timed_out");
        assert!(ready.is_ok());
        drop(connection);
    }
}
