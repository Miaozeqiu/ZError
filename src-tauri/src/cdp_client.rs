//! 连 CEF remote debugging 的薄 CDP 客户端。断流后标记死亡、回错待发请求、关掉事件广播。
#![cfg(target_os = "macos")]

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_tungstenite::{connect_async, tungstenite::Message};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct CdpConn {
  tx: mpsc::UnboundedSender<Pending>,
  events: broadcast::Sender<Value>,
  alive: Arc<AtomicBool>,
}

struct Pending {
  method: String,
  params: Value,
  session_id: Option<String>,
  reply: oneshot::Sender<Result<Value, String>>,
}

struct MethodStat {
  total: u64,
  recent: VecDeque<Instant>,
}

fn method_stats() -> &'static Mutex<HashMap<String, MethodStat>> {
  static S: OnceLock<Mutex<HashMap<String, MethodStat>>> = OnceLock::new();
  S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn unowned_hits() -> &'static AtomicU64 {
  static N: OnceLock<AtomicU64> = OnceLock::new();
  N.get_or_init(|| AtomicU64::new(0))
}

pub fn note_unowned() {
  unowned_hits().fetch_add(1, Ordering::Relaxed);
}

fn note_call(method: &str) {
  let Ok(mut map) = method_stats().lock() else {
    return;
  };
  let row = map.entry(method.to_string()).or_insert_with(|| MethodStat {
    total: 0,
    recent: VecDeque::new(),
  });
  row.total += 1;
  let now = Instant::now();
  row.recent.push_back(now);
  while row.recent.front().is_some_and(|at| now.duration_since(*at) > Duration::from_secs(10)) {
    row.recent.pop_front();
  }
}

pub fn snapshot_stats() -> Value {
  let Ok(map) = method_stats().lock() else {
    return json!({ "ok": false });
  };
  let now = Instant::now();
  let mut methods = serde_json::Map::new();
  let mut recent_total = 0u64;
  let mut total = 0u64;
  for (name, row) in map.iter() {
    let last10 = row
      .recent
      .iter()
      .filter(|at| now.duration_since(**at) <= Duration::from_secs(10))
      .count() as u64;
    recent_total += last10;
    total += row.total;
    methods.insert(
      name.clone(),
      json!({ "total": row.total, "last10s": last10, "perSec": (last10 as f64) / 10.0 }),
    );
  }
  json!({
    "ok": true,
    "total": total,
    "last10s": recent_total,
    "unowned": unowned_hits().load(Ordering::Relaxed),
    "methods": methods,
  })
}

fn fail_waiters(waiters: HashMap<u64, oneshot::Sender<Result<Value, String>>>) {
  for (_, reply) in waiters {
    let _ = reply.send(Err("CDP 连接断开".into()));
  }
}

impl CdpConn {
  pub async fn connect(port: i32) -> Result<Self, String> {
    let list_url = format!("http://127.0.0.1:{port}/json/version");
    // reqwest 在 macOS 会读系统代理；系统代理例外常只有 localhost 没有 127.0.0.1，本机 CDP 会被转去代理。
    let client = reqwest::Client::builder()
      .no_proxy()
      .timeout(Duration::from_secs(3))
      .build()
      .map_err(|e| format!("CDP 客户端创建失败: {e}"))?;
    let body = client
      .get(&list_url)
      .send()
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
    let (sink, reader) = stream.split();
    Ok(Self::spawn(sink, reader))
  }

  fn spawn<Si, St>(mut sink: Si, mut reader: St) -> Self
  where
    Si: futures_util::Sink<Message> + Unpin + Send + 'static,
    St: StreamExt<Item = Result<Message, Si::Error>> + Unpin + Send + 'static,
    Si::Error: Send,
  {
    let (tx, mut rx) = mpsc::unbounded_channel::<Pending>();
    let (events, _) = broadcast::channel::<Value>(256);
    let event_tx = events.clone();
    let alive = Arc::new(AtomicBool::new(true));
    let flag = alive.clone();
    tokio::spawn(async move {
      let mut waiters: HashMap<u64, oneshot::Sender<Result<Value, String>>> = HashMap::new();
      loop {
        tokio::select! {
          incoming = reader.next() => {
            match incoming {
              None => break,
              Some(Err(_)) => break,
              Some(Ok(Message::Close(_))) => break,
              Some(Ok(Message::Text(text))) => {
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
                } else if v.get("method").and_then(|m| m.as_str()).is_some() {
                  let _ = event_tx.send(v);
                }
              }
              Some(Ok(_)) => continue,
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
            if sink.send(Message::Text(msg.to_string().into())).await.is_err() {
              break;
            }
          }
        }
      }
      flag.store(false, Ordering::Relaxed);
      fail_waiters(waiters);
      drop(event_tx);
    });
    Self { tx, events, alive }
  }

  pub fn is_alive(&self) -> bool {
    self.alive.load(Ordering::Relaxed)
  }

  pub fn subscribe(&self) -> broadcast::Receiver<Value> {
    self.events.subscribe()
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
    if !self.is_alive() {
      return Err("CDP 通道已关闭".into());
    }
    note_call(method);
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
        .filter(|t| {
          t.get("type").and_then(|x| x.as_str()) == Some("page")
            || t.get("type").and_then(|x| x.as_str()) == Some("iframe")
        })
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

/// 会话已经 detach 或方法打到了浏览器根会话。调用方应丢掉绑定再 attach 一次。
pub fn is_session_dead(err: &str) -> bool {
  let raw = err.to_ascii_lowercase();
  raw.contains("-32601")
    || raw.contains("wasn't found")
    || raw.contains("wasn\'t found")
    || raw.contains("session not found")
    || raw.contains("session with given id not found")
    || raw.contains("invalid session")
}

pub const HOST_CHANNEL_DOWN: &str = "浏览器通道重连失败";

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

#[cfg(test)]
mod tests {
  use super::*;
  use futures_util::stream;
  use tokio::sync::mpsc as tokio_mpsc;

  struct VecSink(tokio_mpsc::UnboundedSender<Message>);

  impl futures_util::Sink<Message> for VecSink {
    type Error = ();
    fn poll_ready(
      self: std::pin::Pin<&mut Self>,
      _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
      std::task::Poll::Ready(Ok(()))
    }
    fn start_send(self: std::pin::Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
      self.0.send(item).map_err(|_| ())
    }
    fn poll_flush(
      self: std::pin::Pin<&mut Self>,
      _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
      std::task::Poll::Ready(Ok(()))
    }
    fn poll_close(
      self: std::pin::Pin<&mut Self>,
      _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
      std::task::Poll::Ready(Ok(()))
    }
  }

  #[tokio::test]
  async fn closed_stream_marks_dead_and_fails_call() {
    let (out_tx, _out_rx) = tokio_mpsc::unbounded_channel();
    let incoming = stream::iter::<Vec<Result<Message, ()>>>(vec![]);
    let conn = CdpConn::spawn(VecSink(out_tx), incoming);
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(!conn.is_alive());
    let err = conn.call("Runtime.evaluate", json!({}), None).await.unwrap_err();
    assert!(err.contains("关闭") || err.contains("断开"));
  }

  #[tokio::test]
  async fn close_frame_fails_pending() {
    let (out_tx, _out_rx) = tokio_mpsc::unbounded_channel();
    let incoming = stream::iter(vec![Ok::<Message, ()>(Message::Close(None))]);
    let conn = CdpConn::spawn(VecSink(out_tx), incoming);
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(!conn.is_alive());
  }
}
