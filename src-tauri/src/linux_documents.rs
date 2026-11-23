//! Native WebKitGTK web-process transport. Only fixed host operations reach this channel.
use ring::digest::{digest, SHA256};
use serde_json::Value;
use std::{os::unix::fs::PermissionsExt, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};
use webkit2gtk::{gio, glib::variant::ToVariant, UserMessage, UserMessageExt, WebViewExt};

const EXTENSION: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libzerror-documents.so"));
const MAX_REPLY: usize = 128 * 1024;

pub(crate) fn extension_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let hash = digest(&SHA256, EXTENSION);
    let key: String = hash
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("webkit-documents")
        .join(key);
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| e.to_string())?;
    let file = directory.join("libzerror-documents.so");
    if !std::fs::read(&file).is_ok_and(|bytes| bytes == EXTENSION) {
        use std::io::Write;
        let mut pending = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
        pending.write_all(EXTENSION).map_err(|e| e.to_string())?;
        pending
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o500))
            .map_err(|e| e.to_string())?;
        pending.persist(&file).map_err(|e| e.to_string())?;
    }
    Ok(directory)
}

pub(crate) async fn request(
    view: &tauri::Webview,
    operation: &'static str,
    document: &Value,
    payload: String,
) -> Result<Value, String> {
    // A cancellable is thread safe; WebView and UserMessage remain on GTK's main thread.
    struct Cancel(gio::Cancellable);
    impl Drop for Cancel {
        fn drop(&mut self) {
            use gio::prelude::CancellableExt;
            self.0.cancel();
        }
    }
    let cancel = Cancel(gio::Cancellable::new());
    let cancellable = cancel.0.clone();
    let field = |key: &str| document[key].as_str().unwrap_or_default().to_owned();
    let parameters = (field("frameId"), field("loaderId"), field("url"), payload);
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        let message = UserMessage::new(operation, Some(&parameters.to_variant()));
        platform
            .inner()
            .send_message_to_page(&message, Some(&cancellable), move |result| {
                let parsed = result
                    .map_err(|_| "Linux 文档通道不可用，请重新打开标签页".to_owned())
                    .and_then(|reply| {
                        if reply.name().as_deref() != Some("zerror.documents.reply") {
                            return Err("Linux 文档回执类型错误".into());
                        }
                        let (ok, text) = reply
                            .parameters()
                            .and_then(|v| v.get::<(bool, String)>())
                            .ok_or("Linux 文档回执格式错误")?;
                        if text.len() > MAX_REPLY {
                            return Err("文档回执超过大小限制，请缩小读取范围".into());
                        }
                        if !ok {
                            return Err(text);
                        }
                        serde_json::from_str(&text).map_err(|_| "Linux 文档回执无效".into())
                    });
                let _ = send.send(parsed);
            });
    })
    .map_err(|_| "Linux 文档通道不可用")?;
    tokio::time::timeout(Duration::from_secs(35), receive)
        .await
        .map_err(|_| "Linux 文档操作超时")?
        .map_err(|_| "Linux 文档回执丢失")?
}
