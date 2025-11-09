use std::sync::{Arc, Mutex};
use std::collections::{VecDeque, HashMap};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio::time::{timeout, Duration};
use uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    pub id: String, // 唯一标识符，用于关联开始和完成事件
    pub timestamp: DateTime<Utc>,
    pub method: String,
    pub path: String,
    pub status: Option<u16>, // 开始时为None，完成时有值
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
    pub query: String, // 需要查询的内容
    pub timestamp: DateTime<Utc>,
}

// 新增：模型调用进度事件（用于流式输出的活跃信号）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCallProgress {
    pub request_id: String, // 关联的请求ID
    pub content: String, // 当前累计或增量内容
    pub timestamp: DateTime<Utc>,
}

// 新增：模型调用响应事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCallResponse {
    pub request_id: String, // 关联的请求ID
    pub content: String, // 模型返回的内容
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
}

impl RequestLogger {
    pub fn new(max_logs: usize) -> Self {
        let (broadcaster, _) = broadcast::channel(1000);
        Self {
            logs: Arc::new(Mutex::new(VecDeque::new())),
            max_logs,
            broadcaster,
            pending_responses: Arc::new(Mutex::new(HashMap::new())),
        }
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

        // Broadcast the new log to SSE subscribers
        println!("📡 Broadcasting request start to {} subscribers", self.subscriber_count());
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
        let log = RequestLog {
            id,
            timestamp: Utc::now(),
            method,
            path,
            status: Some(status),
            response_time: Some(response_time),
            request_body: None, // 完成阶段不重复发送请求体
            response_body,
            headers: None, // 完成阶段不重复发送请求头
            ip: None,
            user_agent: None,
            stage: "completed".to_string(),
        };

        let mut logs = self.logs.lock().unwrap();
        logs.push_back(log.clone());

        // Keep only the most recent logs
        while logs.len() > self.max_logs {
            logs.pop_front();
        }

        // Broadcast the new log to SSE subscribers
        println!("📡 Broadcasting request complete to {} subscribers", self.subscriber_count());
        match self.broadcaster.send(SSEEvent::RequestLog(log.clone())) {
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

        // Broadcast the new log to SSE subscribers
        println!("📡 Broadcasting log to {} subscribers", self.subscriber_count());
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

        println!("📡 Broadcasting model call request to {} subscribers", self.subscriber_count());
        match self.broadcaster.send(SSEEvent::ModelCallRequest(event)) {
            Ok(_) => println!("✅ Model call request broadcast successful"),
            Err(e) => println!("❌ Model call request broadcast failed: {:?}", e),
        }
    }

    // 新增：发送模型调用进度事件（不会完成等待通道，仅用于活跃心跳）
    pub fn send_model_call_progress(&self, request_id: String, content: String) {
        let event = ModelCallProgress {
            request_id,
            content,
            timestamp: Utc::now(),
        };

        println!("📡 Broadcasting model call progress to {} subscribers", self.subscriber_count());
        match self.broadcaster.send(SSEEvent::ModelCallProgress(event)) {
            Ok(_) => println!("✅ Model call progress broadcast successful"),
            Err(e) => println!("❌ Model call progress broadcast failed: {:?}", e),
        }
    }

    // 新增：发送模型调用响应事件
    pub fn send_model_call_response(&self, request_id: String, content: String) {
        // 首先检查是否有等待这个响应的请求
        if let Some(sender) = {
            let mut pending = self.pending_responses.lock().unwrap();
            pending.remove(&request_id)
        } {
            // 发送响应到等待的请求
            let _ = sender.send(content.clone());
        }

        let event = ModelCallResponse {
            request_id,
            content,
            timestamp: Utc::now(),
        };

        println!("📡 Broadcasting model call response to {} subscribers", self.subscriber_count());
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
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SSEEvent> {
        self.broadcaster.subscribe()
    }

    pub fn subscriber_count(&self) -> usize {
        self.broadcaster.receiver_count()
    }

    // 新增：等待模型响应的方法（基于无新token的静默超时）
    pub async fn wait_for_model_response(&self, request_id: String, inactivity_seconds: u64) -> Result<String, String> {
        let (sender, mut final_receiver) = tokio::sync::oneshot::channel();

        // 注册等待最终响应的通道
        {
            let mut pending = self.pending_responses.lock().unwrap();
            pending.insert(request_id.clone(), sender);
        }

        // 订阅SSE事件，用于检测进度心跳
        let mut sse_receiver = self.broadcaster.subscribe();
        let inactivity = Duration::from_secs(inactivity_seconds);
        let mut last_activity = std::time::Instant::now();

        loop {
            tokio::select! {
                // 最终响应到达
                res = &mut final_receiver => {
                    match res {
                        Ok(content) => return Ok(content),
                        Err(_) => {
                            let mut pending = self.pending_responses.lock().unwrap();
                            pending.remove(&request_id);
                            return Err("Response channel closed".to_string());
                        }
                    }
                }
                // 收到进度或响应事件，视为有新token活动
                evt = sse_receiver.recv() => {
                    match evt {
                        Ok(SSEEvent::ModelCallProgress(progress)) if progress.request_id == request_id => {
                            last_activity = std::time::Instant::now();
                        }
                        Ok(SSEEvent::ModelCallResponse(resp)) if resp.request_id == request_id => {
                            last_activity = std::time::Instant::now();
                            // 最终响应通常会触发上面的oneshot，这里仅更新活动时间
                        }
                        Ok(_) => {}
                        Err(_e) => {
                            // 忽略广播接收错误（例如滞后），不影响超时判断
                        }
                    }
                }
                // 静默计时器触发，检查是否超过不活跃阈值
                _ = tokio::time::sleep(inactivity) => {
                    if last_activity.elapsed() >= inactivity {
                        let mut pending = self.pending_responses.lock().unwrap();
                        pending.remove(&request_id);
                        return Err("Timeout waiting for model response (no new tokens)".to_string());
                    }
                }
            }
        }
    }
}

impl Default for RequestLogger {
    fn default() -> Self {
        Self::new(1000) // Default to keeping 1000 logs
    }
}