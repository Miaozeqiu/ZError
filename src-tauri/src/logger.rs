use crate::database::{increment_daily_request_count};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tokio::time::Duration;
use uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    pub id: String, // 唯一标识符，用于关联开始和完成事件
    pub timestamp: DateTime<Utc>,
    pub method: String,
    pub path: String,
    pub status: Option<u16>,        // 开始时为None，完成时有值
    pub response_time: Option<u64>, // 开始时为None，完成时有值
    pub request_body: Option<String>,
    pub response_body: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub stage: String, // "started" 或 "completed"
}

// 新增：模型调用请求事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCallRequest {
    pub request_id: String, // 关联的请求ID
    pub query: String,      // 需要查询的内容
    pub timestamp: DateTime<Utc>,
}

// 新增：模型调用进度事件（用于流式输出的活跃信号）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCallProgress {
    pub request_id: String, // 关联的请求ID
    pub content: String,    // 当前累计或增量内容
    pub timestamp: DateTime<Utc>,
}

// 新增：模型调用响应事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCallResponse {
    pub request_id: String, // 关联的请求ID
    pub content: String,    // 模型返回的内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    pub is_success: bool,
    pub timestamp: DateTime<Utc>,
}

// 统一的SSE事件类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SSEEvent {
    #[serde(rename = "request_log")]
    RequestLog(RequestLog),
    #[serde(rename = "model_call_request")]
    ModelCallRequest(ModelCallRequest),
    #[serde(rename = "model_call_progress")]
    ModelCallProgress(ModelCallProgress),
    #[serde(rename = "model_call_response")]
    ModelCallResponse(ModelCallResponse),
}

#[derive(Debug, Clone)]
pub struct RequestLogger {
    logs: Arc<Mutex<VecDeque<RequestLog>>>,
    max_logs: usize,
    broadcaster: broadcast::Sender<SSEEvent>, // 修改为SSEEvent类型
    pending_responses: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>>, // 等待模型响应的通道
    pending_error_responses: Arc<Mutex<HashMap<String, (String, std::time::Instant)>>>, // 暂存错误响应，给成功回调留一个兜底窗口
    /// 按 request_id 记录最近一次进度/响应时间；不依赖 broadcast 订阅（可 Lagged）
    last_activity: Arc<Mutex<HashMap<String, std::time::Instant>>>,
}

impl RequestLogger {
    pub fn new(max_logs: usize) -> Self {
        let (broadcaster, _) = broadcast::channel(1000);
        Self {
            logs: Arc::new(Mutex::new(VecDeque::new())),
            max_logs,
            broadcaster,
            pending_responses: Arc::new(Mutex::new(HashMap::new())),
            pending_error_responses: Arc::new(Mutex::new(HashMap::new())),
            last_activity: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn touch_activity(&self, request_id: &str) {
        let mut map = self.last_activity.lock().unwrap();
        // 清理超过 10 分钟的孤儿条目
        let ttl = std::time::Duration::from_secs(600);
        map.retain(|_, at| at.elapsed() <= ttl);
        map.insert(request_id.to_string(), std::time::Instant::now());
    }

    fn clear_activity(&self, request_id: &str) {
        self.last_activity.lock().unwrap().remove(request_id);
    }

    fn activity_elapsed(&self, request_id: &str) -> Option<std::time::Duration> {
        self.last_activity
            .lock()
            .unwrap()
            .get(request_id)
            .map(|at| at.elapsed())
    }

    fn persist_query_count(&self, log: &RequestLog) {
        // 只对 /query 路由的 started 阶段计数，不记录请求详情
        if log.path == "/query"
            && (log.method == "GET" || log.method == "POST")
            && log.stage == "started"
        {
            if let Err(error) = increment_daily_request_count() {
                println!("❌ 更新每日请求计数失败: {}", error);
            }
        }
    }

    pub fn max_logs(&self) -> usize {
        self.max_logs
    }

    // 记录请求开始
    pub fn log_request_start(
        &self,
        id: String,
        method: String,
        path: String,
        request_body: Option<String>,
        headers: Option<HashMap<String, String>>,
        ip: Option<String>,
        user_agent: Option<String>,
    ) {
        let log = RequestLog {
            id,
            timestamp: Utc::now(),
            method,
            path,
            status: None,
            response_time: None,
            request_body,
            response_body: None,
            headers,
            ip,
            user_agent,
            stage: "started".to_string(),
        };

        let mut logs = self.logs.lock().unwrap();
        logs.push_back(log.clone());

        // Keep only the most recent logs
        while logs.len() > self.max_logs {
            logs.pop_front();
        }

        drop(logs);
        self.persist_query_count(&log);

        // Broadcast the new log to SSE subscribers
        println!(
            "📡 Broadcasting request start to {} subscribers",
            self.subscriber_count()
        );
        match self.broadcaster.send(SSEEvent::RequestLog(log.clone())) {
            Ok(_) => println!("✅ Request start broadcast successful"),
            Err(e) => println!("❌ Request start broadcast failed: {:?}", e),
        }
    }

    // 记录请求完成
    pub fn log_request_complete(
        &self,
        id: String,
        method: String,
        path: String,
        status: u16,
        response_time: u64,
        response_body: Option<String>,
    ) {
        let mut logs = self.logs.lock().unwrap();
        // 优先就地更新 started 记录，避免同一请求占两条导致上限形同虚设
        let log = if let Some(existing) = logs.iter_mut().rev().find(|item| item.id == id) {
            existing.status = Some(status);
            existing.response_time = Some(response_time);
            existing.response_body = response_body;
            existing.stage = "completed".to_string();
            existing.clone()
        } else {
            let created = RequestLog {
                id,
                timestamp: Utc::now(),
                method,
                path,
                status: Some(status),
                response_time: Some(response_time),
                request_body: None,
                response_body,
                headers: None,
                ip: None,
                user_agent: None,
                stage: "completed".to_string(),
            };
            logs.push_back(created.clone());
            while logs.len() > self.max_logs {
                logs.pop_front();
            }
            created
        };
        drop(logs);
        self.persist_query_count(&log);

        println!(
            "📡 Broadcasting request complete to {} subscribers",
            self.subscriber_count()
        );
        match self.broadcaster.send(SSEEvent::RequestLog(log)) {
            Ok(_) => println!("✅ Request complete broadcast successful"),
            Err(e) => println!("❌ Request complete broadcast failed: {:?}", e),
        }
    }

    // 保留原有方法以兼容其他路由
    pub fn log_request(
        &self,
        method: String,
        path: String,
        status: u16,
        response_time: u64,
        request_body: Option<String>,
        response_body: Option<String>,
        headers: Option<HashMap<String, String>>,
        ip: Option<String>,
        user_agent: Option<String>,
    ) {
        let log = RequestLog {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            method,
            path,
            status: Some(status),
            response_time: Some(response_time),
            request_body,
            response_body,
            headers,
            ip,
            user_agent,
            stage: "completed".to_string(), // 一次性记录视为已完成
        };

        let mut logs = self.logs.lock().unwrap();
        logs.push_back(log.clone());

        // Keep only the most recent logs
        while logs.len() > self.max_logs {
            logs.pop_front();
        }

        drop(logs);
        self.persist_query_count(&log);

        // Broadcast the new log to SSE subscribers
        println!(
            "📡 Broadcasting log to {} subscribers",
            self.subscriber_count()
        );
        match self.broadcaster.send(SSEEvent::RequestLog(log.clone())) {
            Ok(_) => println!("✅ Log broadcast successful"),
            Err(e) => println!("❌ Log broadcast failed: {:?}", e),
        }
    }

    // 新增：发送模型调用请求事件
    pub fn send_model_call_request(&self, request_id: String, query: String) {
        let event = ModelCallRequest {
            request_id,
            query,
            timestamp: Utc::now(),
        };

        println!(
            "📡 Broadcasting model call request to {} subscribers",
            self.subscriber_count()
        );
        match self.broadcaster.send(SSEEvent::ModelCallRequest(event)) {
            Ok(_) => println!("✅ Model call request broadcast successful"),
            Err(e) => println!("❌ Model call request broadcast failed: {:?}", e),
        }
    }

    // 新增：发送模型调用进度事件（不会完成等待通道，仅用于活跃心跳）
    pub fn send_model_call_progress(&self, request_id: String, content: String) {
        self.touch_activity(&request_id);
        let event = ModelCallProgress {
            request_id,
            content,
            timestamp: Utc::now(),
        };

        println!(
            "📡 Broadcasting model call progress to {} subscribers",
            self.subscriber_count()
        );
        match self.broadcaster.send(SSEEvent::ModelCallProgress(event)) {
            Ok(_) => println!("✅ Model call progress broadcast successful"),
            Err(e) => println!("❌ Model call progress broadcast failed: {:?}", e),
        }
    }

    // 新增：发送模型调用响应事件
    pub fn send_model_call_response(
        &self,
        request_id: String,
        content: String,
        reasoning_content: Option<String>,
        is_success: bool,
    ) {
        self.touch_activity(&request_id);
        if is_success {
            self.pending_error_responses
                .lock()
                .unwrap()
                .remove(&request_id);

            // 成功响应优先完成等待通道
            if let Some(sender) = {
                let mut pending = self.pending_responses.lock().unwrap();
                pending.remove(&request_id)
            } {
                let _ = sender.send(content.clone());
            }
        } else {
            // 错误响应先暂存，给其他可能成功的消费者留出覆盖窗口
            let mut pending_errors = self.pending_error_responses.lock().unwrap();
            // 清理超过 2 分钟的孤儿错误，避免 Map 只增不减
            let ttl = std::time::Duration::from_secs(120);
            pending_errors.retain(|_, (_, at)| at.elapsed() <= ttl);
            pending_errors.insert(
                request_id.clone(),
                (content.clone(), std::time::Instant::now()),
            );
        }

        let event = ModelCallResponse {
            request_id,
            content,
            reasoning_content,
            is_success,
            timestamp: Utc::now(),
        };

        println!(
            "📡 Broadcasting model call response to {} subscribers",
            self.subscriber_count()
        );
        match self.broadcaster.send(SSEEvent::ModelCallResponse(event)) {
            Ok(_) => println!("✅ Model call response broadcast successful"),
            Err(e) => println!("❌ Model call response broadcast failed: {:?}", e),
        }
    }

    pub fn get_logs(&self) -> Vec<RequestLog> {
        let logs = self.logs.lock().unwrap();
        logs.iter().cloned().collect()
    }

    pub fn clear_logs(&self) {
        let mut logs = self.logs.lock().unwrap();
        logs.clear();
        self.pending_responses.lock().unwrap().clear();
        self.pending_error_responses.lock().unwrap().clear();
        self.last_activity.lock().unwrap().clear();
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SSEEvent> {
        self.broadcaster.subscribe()
    }

    pub fn subscriber_count(&self) -> usize {
        self.broadcaster.receiver_count()
    }

    // 等待模型响应：inactivity=无新进度超时；absolute=整段等待上限（防止 keepalive 无限续命）
    pub async fn wait_for_model_response(
        &self,
        request_id: String,
        inactivity_seconds: u64,
        absolute_seconds: u64,
    ) -> Result<String, String> {
        let (sender, mut final_receiver) = tokio::sync::oneshot::channel();

        // 注册等待最终响应的通道，并初始化活动时钟
        {
            let mut pending = self.pending_responses.lock().unwrap();
            pending.insert(request_id.clone(), sender);
        }
        self.touch_activity(&request_id);

        // 订阅SSE事件作为补充；主时钟以 last_activity map 为准（HTTP progress 直写）
        let mut sse_receiver = self.broadcaster.subscribe();
        let inactivity = Duration::from_secs(inactivity_seconds.max(5));
        let absolute = Duration::from_secs(absolute_seconds.max(inactivity_seconds.max(5)));
        let wait_started = std::time::Instant::now();
        let error_grace = Duration::from_secs(2);
        let check_interval = Duration::from_millis(300);

        loop {
            tokio::select! {
                // 最终成功响应到达
                res = &mut final_receiver => {
                    match res {
                        Ok(content) => {
                            self.pending_error_responses.lock().unwrap().remove(&request_id);
                            self.clear_activity(&request_id);
                            return Ok(content)
                        },
                        Err(_) => {
                            let mut pending = self.pending_responses.lock().unwrap();
                            pending.remove(&request_id);
                            self.pending_error_responses.lock().unwrap().remove(&request_id);
                            self.clear_activity(&request_id);
                            return Err("Response channel closed".to_string());
                        }
                    }
                }
                // 收到进度或响应事件，视为有新token活动（补充路径）
                evt = sse_receiver.recv() => {
                    match evt {
                        Ok(SSEEvent::ModelCallProgress(progress)) if progress.request_id == request_id => {
                            self.touch_activity(&request_id);
                        }
                        Ok(SSEEvent::ModelCallResponse(resp)) if resp.request_id == request_id => {
                            self.touch_activity(&request_id);
                        }
                        Ok(_) => {}
                        Err(_e) => {
                            // 忽略广播接收错误（例如滞后）；活动以 last_activity map 为准
                        }
                    }
                }
                _ = tokio::time::sleep(check_interval) => {
                    let pending_error = {
                        let errors = self.pending_error_responses.lock().unwrap();
                        errors.get(&request_id).cloned()
                    };

                    let elapsed = self
                        .activity_elapsed(&request_id)
                        .unwrap_or_else(|| inactivity);

                    if let Some((error_content, error_at)) = pending_error {
                        // 仅按错误到达时间宽限；不要要求 activity 也静默——
                        // 否则前端 keepalive 会不断 touch，错误永远无法结束等待（一直「处理中」）
                        if error_at.elapsed() >= error_grace {
                            self.pending_error_responses.lock().unwrap().remove(&request_id);
                            self.pending_responses.lock().unwrap().remove(&request_id);
                            self.clear_activity(&request_id);
                            return Ok(error_content);
                        }
                    }

                    if wait_started.elapsed() >= absolute {
                        self.pending_responses.lock().unwrap().remove(&request_id);
                        self.pending_error_responses.lock().unwrap().remove(&request_id);
                        self.clear_activity(&request_id);
                        return Err(format!(
                            "Timeout waiting for model response (absolute {}s)",
                            absolute.as_secs()
                        ));
                    }

                    if elapsed >= inactivity {
                        self.pending_responses.lock().unwrap().remove(&request_id);
                        self.pending_error_responses.lock().unwrap().remove(&request_id);
                        self.clear_activity(&request_id);
                        return Err("Timeout waiting for model response (no new tokens)".to_string());
                    }
                }
            }
        }
    }
}

impl Default for RequestLogger {
    fn default() -> Self {
        // 与前端 MAX_REQUEST_LOGS 对齐；完成阶段已就地更新，不再双倍占用
        Self::new(100)
    }
}
