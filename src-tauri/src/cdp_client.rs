//! 连 CEF remote debugging 的薄 CDP 客户端。
#![cfg(target_os = "macos")]

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{connect_async, tungstenite::Message};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct CdpConn {
  tx: mpsc::UnboundedSender<Pending>,
}

struct Pending {
  method: String,
  params: Value,
  session_id: Option<String>,
  reply: oneshot::Sender<Result<Value, String>>,
}

impl CdpConn {
  pub async fn connect(port: i32) -> Result<Self, String> {
    let list_url = format!("http://127.0.0.1:{port}/json/version");
    let body = reqwest::get(&list_url)
      .await
      .map_err(|e| format!("CDP 版本探测失败: {e}"))?
      .text()
      .await
      .map_err(|e| format!("CDP 读版本失败: {e}"))?;
    let info: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let ws = info
      .get("webSocketDebuggerUrl")
      .and_then(|v| v.as_str())
      .ok_or_else(|| "CDP 没有 webSocketDebuggerUrl".to_string())?;
    let (stream, _) = connect_async(ws)
      .await
      .map_err(|e| format!("连接 CDP 失败: {e}"))?;
    let (mut sink, mut reader) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Pending>();
    tokio::spawn(async move {
      let mut waiters: HashMap<u64, oneshot::Sender<Result<Value, String>>> = HashMap::new();
      loop {
        tokio::select! {
          incoming = reader.next() => {
            let Some(Ok(Message::Text(text))) = incoming else { continue };
            let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
            if let Some(id) = v.get("id").and_then(|x| x.as_u64()) {
              let result = if let Some(err) = v.get("error") {
                Err(err.to_string())
              } else {
                Ok(v.get("result").cloned().unwrap_or(Value::Null))
              };
              if let Some(reply) = waiters.remove(&id) {
                let _ = reply.send(result);
              }
            }
          }
          job = rx.recv() => {
            let Some(job) = job else { break };
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let mut msg = json!({
              "id": id,
              "method": job.method,
              "params": job.params,
            });
            if let Some(sid) = job.session_id {
              msg["sessionId"] = json!(sid);
            }
            waiters.insert(id, job.reply);
            let payload = msg.to_string();
            if sink.send(Message::Text(payload.into())).await.is_err() {
              break;
            }
          }
        }
      }
    });
    Ok(Self { tx })
  }

  pub async fn call(&self, method: &str, params: Value, session_id: Option<&str>) -> Result<Value, String> {
    self.call_ms(method, params, session_id, 4000).await
  }

  pub async fn call_ms(
    &self,
    method: &str,
    params: Value,
    session_id: Option<&str>,
    ms: u64,
  ) -> Result<Value, String> {
    let (reply, rx) = oneshot::channel();
    self
      .tx
      .send(Pending {
        method: method.to_string(),
        params,
        session_id: session_id.map(str::to_string),
        reply,
      })
      .map_err(|_| "CDP 通道已关闭".to_string())?;
    match tokio::time::timeout(Duration::from_millis(ms.max(80)), rx).await {
      Ok(Ok(v)) => v,
      Ok(Err(_)) => Err("CDP 回执丢失".into()),
      Err(_) => Err("CDP 执行超时".into()),
    }
  }

  pub async fn pages(&self) -> Result<Vec<Value>, String> {
    let list = self.call("Target.getTargets", json!({}), None).await?;
    let arr = list
      .get("targetInfos")
      .and_then(|v| v.as_array())
      .cloned()
      .unwrap_or_default();
    Ok(
      arr
        .into_iter()
        .filter(|t| t.get("type").and_then(|x| x.as_str()) == Some("page")
          || t.get("type").and_then(|x| x.as_str()) == Some("iframe"))
        .collect(),
    )
  }

  pub async fn attach(&self, target_id: &str) -> Result<String, String> {
    self.attach_ms(target_id, 4000).await
  }

  pub async fn attach_ms(&self, target_id: &str, ms: u64) -> Result<String, String> {
    let r = self
      .call_ms(
        "Target.attachToTarget",
        json!({ "targetId": target_id, "flatten": true }),
        None,
        ms,
      )
      .await?;
    r.get("sessionId")
      .and_then(|v| v.as_str())
      .map(str::to_string)
      .ok_or_else(|| "没有 sessionId".into())
  }

  pub async fn evaluate(&self, expression: &str, session_id: Option<&str>) -> Result<Value, String> {
    self.evaluate_ms(expression, session_id, 4000).await
  }

  pub async fn evaluate_ms(
    &self,
    expression: &str,
    session_id: Option<&str>,
    ms: u64,
  ) -> Result<Value, String> {
    let r = self
      .call_ms(
        "Runtime.evaluate",
        json!({
          "expression": expression,
          "returnByValue": true,
          "awaitPromise": false,
          "userGesture": true,
        }),
        session_id,
        ms,
      )
      .await?;
    if let Some(exc) = r.get("exceptionDetails") {
      return Err(exc.to_string());
    }
    Ok(r.get("result").and_then(|v| v.get("value")).cloned().unwrap_or(Value::Null))
  }
}

pub async fn connect_loop(port: i32) -> Result<CdpConn, String> {
  let mut last = "未连接".to_string();
  for _ in 0..20 {
    match CdpConn::connect(port).await {
      Ok(c) => return Ok(c),
      Err(e) => last = e,
    }
    tokio::time::sleep(Duration::from_millis(150)).await;
  }
  Err(last)
}
