use crate::logger::{RequestLogger, SSEEvent};
use crate::types::QueryResponse;
use serde::Serialize;
use std::{convert::Infallible, future::Future};
use tokio::sync::{broadcast, mpsc};
use tokio_stream::wrappers::UnboundedReceiverStream;
use warp::{http::HeaderMap, Reply};

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Step {
    Local,
    Verify,
    Search,
    Model,
    Summary,
    Return,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum State {
    Running,
    Done,
    Failed,
    NoResult,
}

type Event = Result<warp::sse::Event, Infallible>;

#[derive(Default)]
pub(super) struct QueryProgress(Option<mpsc::UnboundedSender<Event>>);

impl QueryProgress {
    pub(super) fn for_request(headers: &HeaderMap) -> (Self, Option<warp::reply::Response>) {
        let wants_progress = headers
            .get_all(warp::http::header::ACCEPT)
            .iter()
            .any(|value| {
                value.to_str().is_ok_and(|value| {
                    value
                        .split(',')
                        .any(|item| item.trim().eq_ignore_ascii_case("text/event-stream"))
                })
            });
        if !wants_progress {
            return (Self::default(), None);
        }
        let (sender, receiver) = mpsc::unbounded_channel();
        let events = UnboundedReceiverStream::new(receiver);
        let mut response = warp::sse::reply(events).into_response();
        response.headers_mut().insert(
            warp::http::header::CACHE_CONTROL,
            warp::http::HeaderValue::from_static("no-store"),
        );
        (Self(Some(sender)), Some(response))
    }

    fn send(&self, name: &str, data: impl Serialize) {
        if let Some(sender) = &self.0 {
            if let Ok(event) = warp::sse::Event::default().event(name).json_data(data) {
                let _ = sender.send(Ok(event));
            }
        }
    }

    pub(super) fn step(&self, step: Step, state: State, detail: impl AsRef<str>) {
        if self.0.is_some() {
            self.send(
                "progress",
                serde_json::json!({
                    "step": step,
                    "state": state,
                    "detail": detail.as_ref(),
                }),
            );
        }
    }

    pub(super) fn finish(&self, response: &QueryResponse) {
        self.send("result", response);
    }

    pub(super) fn details(&self, step: Step, data: impl Serialize) {
        if self.0.is_some() {
            self.send("details", serde_json::json!({ "step": step, "data": data }));
        }
    }

    pub(super) async fn track_answer(
        &self,
        logger: &RequestLogger,
        request_id: &str,
        answer: impl Future<Output = (u16, QueryResponse)>,
    ) -> (u16, QueryResponse) {
        if self.0.is_none() {
            return answer.await;
        }
        let mut signals = logger.subscribe();
        let mut search_started = false;
        let mut search_finished = false;
        let mut model_started = false;
        let mut summary_started = false;
        let mut summary_finished = false;
        tokio::pin!(answer);
        let result = loop {
            tokio::select! {
                // Preserve stage events already queued when a fast model returns.
                biased;
                event = signals.recv() => match event {
                    Ok(SSEEvent::ModelCallProgress(event)) if event.request_id == request_id => {
                        match event.content.as_str() {
                            "searching" if !search_started && !search_finished && !model_started => {
                                search_started = true;
                                self.step(Step::Search, State::Running, "正在查询网络资料");
                            }
                            "search-finished" | "search-failed" if !search_finished => {
                                search_finished = true;
                                let (state, detail) = if event.content == "search-failed" {
                                    (State::Failed, "未能取得网络资料，继续处理题目")
                                } else if event.details.as_ref().and_then(|trace| trace["results"].as_array()).is_some_and(Vec::is_empty) {
                                    (State::NoResult, "没有解析到结构化结果")
                                } else {
                                    (State::Done, "已取得网络搜索结果")
                                };
                                if let Some(trace) = &event.details {
                                    self.details(Step::Search, trace);
                                }
                                self.step(Step::Search, state, detail);
                            }
                            "started" if !model_started && !summary_started => {
                                model_started = true;
                                self.step(Step::Model, State::Running, "正在等待模型回答");
                            }
                            "models-finished" => {
                                if let Some(models) = &event.details {
                                    self.details(Step::Model, models);
                                }
                            }
                            "summary-started" if !summary_started => {
                                summary_started = true;
                                self.step(Step::Model, State::Done, "已取得模型回答");
                                self.step(Step::Summary, State::Running, "正在整理模型回答");
                            }
                            "summary-finished" | "summary-failed" if summary_started && !summary_finished => {
                                summary_finished = true;
                                if let Some(models) = &event.details {
                                    self.details(Step::Summary, models);
                                }
                                if event.content == "summary-finished" {
                                    self.step(Step::Summary, State::Done, "已完成总结");
                                } else {
                                    self.step(Step::Summary, State::Failed, "总结失败，尝试使用已有回答");
                                }
                            }
                            _ => {}
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break answer.await,
                    _ => {}
                },
                result = &mut answer => break result,
            }
        };
        if !summary_started {
            if result.1.code == 1 {
                self.step(Step::Model, State::Done, "模型处理完成");
            } else {
                self.step(Step::Model, State::Failed, "未能返回答案");
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use warp::hyper::body::HttpBody;

    #[tokio::test]
    async fn streams_only_this_querys_stages_before_result() {
        let mut headers = HeaderMap::new();
        assert!(QueryProgress::for_request(&headers).1.is_none());

        headers.insert("accept", "text/event-stream".parse().unwrap());
        let (progress, response) = QueryProgress::for_request(&headers);
        let response = response.unwrap();
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        let mut body = response.into_body();
        let (answer_ready, wait_for_answer) = tokio::sync::oneshot::channel();

        let task = tokio::spawn(async move {
            progress.step(Step::Local, State::Done, "未命中本地答案");
            let logger = RequestLogger::new(1);
            let (_, result) = progress
                .track_answer(&logger, "current", async {
                    logger.send_model_call_progress(
                        "other".into(),
                        "models-finished".into(),
                        Some(serde_json::json!(["other request"])),
                    );
                    for content in [
                        "private model output",
                        "searching",
                        "searching",
                        "search-failed",
                        "started",
                        "summary-started",
                        "started",
                        "summary-failed",
                    ] {
                        logger.send_model_call_progress("current".into(), content.into(), None);
                    }
                    logger.send_model_call_progress(
                        "current".into(),
                        "models-finished".into(),
                        Some(serde_json::json!([{ "modelName": "fixture", "response": "42" }])),
                    );
                    wait_for_answer.await.unwrap();
                    (200, QueryResponse::not_found())
                })
                .await;
            progress.finish(&result);
        });

        for (step, state) in [
            ("local", "done"),
            ("search", "running"),
            ("search", "failed"),
            ("model", "running"),
            ("model", "done"),
            ("summary", "running"),
            ("summary", "failed"),
        ] {
            let frame = tokio::time::timeout(Duration::from_secs(1), body.data())
                .await
                .expect("stage arrives before the answer")
                .unwrap()
                .unwrap();
            let frame = std::str::from_utf8(&frame).unwrap();
            let payload = frame.strip_prefix("event:progress\ndata:").unwrap();
            let data: serde_json::Value = serde_json::from_str(payload).unwrap();
            assert_eq!(data["step"], step);
            assert_eq!(data["state"], state);
        }

        let frame = body.data().await.unwrap().unwrap();
        let payload = std::str::from_utf8(&frame)
            .unwrap()
            .strip_prefix("event:details\ndata:")
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(payload).unwrap(),
            serde_json::json!({
                "step": "model",
                "data": [{ "modelName": "fixture", "response": "42" }],
            }),
        );

        answer_ready.send(()).unwrap();
        let frame = body.data().await.unwrap().unwrap();
        let payload = std::str::from_utf8(&frame)
            .unwrap()
            .strip_prefix("event:result\ndata:")
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(payload).unwrap(),
            serde_json::to_value(QueryResponse::not_found()).unwrap(),
        );
        assert!(body.data().await.is_none());
        task.await.unwrap();
    }
}
