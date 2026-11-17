use super::escape_html;
use crate::database::set_question_pending_correction;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::hmac;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use warp::{http::StatusCode, Filter, Reply};

const CLICK_SCRIPT: &str = include_str!("correction_click.js");
const RECEIPT_KIND: &str = "zerror-local-correction";

fn signing_key() -> &'static hmac::Key {
    static KEY: OnceLock<hmac::Key> = OnceLock::new();
    KEY.get_or_init(|| {
        hmac::Key::generate(hmac::HMAC_SHA256, &ring::rand::SystemRandom::new())
            .expect("OS random source unavailable")
    })
}

pub(super) fn path_for(id: i64) -> String {
    let signature = hmac::sign(signing_key(), &id.to_be_bytes());
    format!(
        "/correction/{id}/{}",
        URL_SAFE_NO_PAD.encode(signature.as_ref())
    )
}

fn valid_signature(id: i64, signature: &str) -> bool {
    id > 0
        && signature.len() == 43
        && URL_SAFE_NO_PAD
            .decode(signature)
            .is_ok_and(|bytes| hmac::verify(signing_key(), &id.to_be_bytes(), &bytes).is_ok())
}

pub(super) fn link(url: &str) -> String {
    format!(
        r#"<a href="{}" target="_blank" rel="noopener noreferrer" style="display:block;width:fit-content;margin-top:8px;padding:4px 10px;border-radius:5px;background:#f4eee8;color:#82421f;text-decoration:none;font-size:13px;" onclick="{}">标记为待修正</a>"#,
        escape_html(url),
        escape_html(
            &CLICK_SCRIPT
                .lines()
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(" ")
        ),
    )
}

fn html_page(title: &str, content: &str) -> String {
    format!(
        r#"<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><style>body{{margin:3rem auto;padding:0 1.5rem;max-width:34rem;font:16px/1.6 system-ui,sans-serif;color:#272321;background:#faf8f6}}h1{{font-size:1.5rem}}button{{border:0;border-radius:8px;padding:.6em 1em;background:#37261e;color:white;font:inherit;cursor:pointer}}</style><h1>{title}</h1>{content}</html>"#,
    )
}

fn reply_page(title: &str, content: &str, status: StatusCode) -> warp::reply::Response {
    warp::reply::with_status(
        warp::reply::with_header(
            warp::reply::html(html_page(title, content)),
            "cache-control",
            "no-store",
        ),
        status,
    )
    .into_response()
}

pub(super) fn routes(
    app: Option<AppHandle>,
) -> warp::filters::BoxedFilter<(warp::reply::Response,)> {
    let path = warp::path("correction")
        .and(warp::path::param::<i64>())
        .and(warp::path::param::<String>())
        .and(warp::path::end());

    let confirm = path.and(warp::get()).map(|id: i64, signature: String| {
        if !valid_signature(id, &signature) {
            return reply_page("链接已失效", "<p>请重新查询此题后再试。</p>", StatusCode::FORBIDDEN);
        }
        reply_page(
            "标记为待修正",
            &format!(r#"<p>将本地题库中的第 {id} 号题标记为待修正。</p><form method="post"><button type="submit">确认标记</button></form>"#),
            StatusCode::OK,
        )
    });

    let submit = path.and(warp::post())
        .and(warp::header::optional::<String>("accept"))
        .and_then(move |id: i64, signature: String, accept: Option<String>| {
            let app = app.clone();
            async move {
                let (status, message) = if !valid_signature(id, &signature) {
                    (StatusCode::FORBIDDEN, "链接已失效，请重新查询此题")
                } else {
                    match set_question_pending_correction(id, true).await {
                        Ok(()) => {
                            if let Some(app) = app {
                                let _ = app.emit_to("main", "question-correction-marked", id);
                            }
                            (StatusCode::OK, "已标记待修正")
                        }
                        Err(error) if error == "题目不存在" => (StatusCode::NOT_FOUND, "题目不存在"),
                        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "标记失败，请重试"),
                    }
                };
                let success = status == StatusCode::OK;
                let reply = if accept.as_deref() == Some("application/json") {
                    warp::reply::with_header(
                        warp::reply::with_status(warp::reply::json(&serde_json::json!({ "success": success, "message": message, "id": id })), status),
                        "cache-control", "no-store",
                    ).into_response()
                } else {
                    // Only echo a valid token, whose alphabet is safe inside the receipt script.
                    let token = if status == StatusCode::FORBIDDEN { "" } else { &signature };
                    let receipt = serde_json::json!({ "kind": RECEIPT_KIND, "id": id.to_string(), "token": token, "success": success, "message": message });
                    let content = format!(r#"<script>if(parent!==window)parent.postMessage({receipt},"*");</script>"#);
                    reply_page(message, &content, status)
                };
                Ok::<_, warp::Rejection>(reply)
            }
        });
    confirm.or(submit).unify().boxed()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn prompt_requires_post_and_correction_signature_is_bound_to_question() {
        let routes = routes(None);
        let path = path_for(42);
        let response = warp::test::request().path(&path).reply(&routes).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(std::str::from_utf8(response.body())
            .unwrap()
            .contains("确认标记"));
        let forged = path.replacen("/42/", "/43/", 1);
        let denied = warp::test::request()
            .method("POST")
            .path(&forged)
            .header("accept", "application/json")
            .reply(&routes)
            .await;
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    }
}
