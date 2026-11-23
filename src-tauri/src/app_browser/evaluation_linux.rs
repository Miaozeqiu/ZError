//! Linux 脚本结果直接经 WebKitGTK 回调返回，不借用网页标题作为传输通道。
use javascriptcore::ValueExt;
use webkit2gtk::{gio, WebViewExt};

pub(super) async fn evaluate(view: &tauri::Webview, script: String) -> Result<String, String> {
    struct Cancel(gio::Cancellable);
    impl Drop for Cancel {
        fn drop(&mut self) {
            use gio::prelude::CancellableExt;
            self.0.cancel();
        }
    }
    let cancel = Cancel(gio::Cancellable::new());
    let cancellable = cancel.0.clone();
    let permit = crate::browser_control::current_permit();
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        if send.is_closed() {
            return;
        }
        if let Some(error) = permit.as_ref().and_then(|permit| permit.check().err()) {
            let _ = send.send(Err(error));
            return;
        }
        platform.inner().evaluate_javascript(
            &script,
            None,
            None,
            Some(&cancellable),
            move |result| {
                let result = result
                    .map_err(|error| format!("网页脚本执行失败：{error}"))
                    .and_then(|value| {
                        let text = value
                            .to_json(0)
                            .map(|text| text.to_string())
                            .unwrap_or_else(|| "null".into());
                        if text.len() > 2 * 1024 * 1024 {
                            return Err("执行结果过长".into());
                        }
                        Ok(text)
                    });
                let _ = send.send(result);
            },
        );
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), receive)
        .await
        .map_err(|_| "网页脚本执行超时")?
        .map_err(|_| "网页脚本回执丢失")?
}
