use std::sync::Arc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use crate::logger::RequestLogger;

/// 服务器信息结构体
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerInfo {
    pub running: bool,
    pub port: Option<u16>,
    pub url: Option<String>,
}

/// 查询请求结构体
#[derive(Debug, Serialize, Deserialize)]
pub struct QueryRequest {
    pub title: String,
    pub options: Option<String>,
    #[serde(rename = "type")]
    pub query_type: Option<String>,
}

/// 模型调用响应请求结构体
#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCallResponseRequest {
    pub request_id: String,
    pub content: String,
}

/// 模型调用进度请求结构体（用于流式输出心跳）
#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCallProgressRequest {
    pub request_id: String,
    pub content: String,
}

/// 查询响应结构体
#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResponse {
    pub code: i32,
    pub data: Option<QueryData>,
    pub message: Option<String>,
}

/// 查询数据结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryData {
    pub question: String,
    pub answer: String,
    pub is_ai: bool,
}

/// 请求日志结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    pub id: String,
    pub timestamp: i64,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub ip: String,
    pub user_agent: String,
    pub response_time: u64,
}

impl QueryResponse {
    /// 创建成功响应
    pub fn success(data: QueryData) -> Self {
        Self {
            code: 1,
            data: Some(data),
            message: None,
        }
    }
    
    /// 创建未找到响应
    pub fn not_found() -> Self {
        Self {
            code: 0,
            data: None,
            message: Some("No matching records found".to_string()),
        }
    }
    
    /// 创建错误响应
    pub fn error(message: String) -> Self {
        Self {
            code: -1,
            data: None,
            message: Some(message),
        }
    }
}

/// 服务器状态管理结构体
#[derive(Debug)]
pub struct ServerState {
    pub info: Arc<Mutex<ServerInfo>>,
    pub handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub logger: RequestLogger,
    pub analysis_enabled: Arc<Mutex<bool>>, // 非思考模型分析开关
    pub is_thinking_model: Arc<Mutex<bool>>, // 当前选中模型是否为思考模型
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            info: Arc::new(Mutex::new(ServerInfo {
                running: false,
                port: None,
                url: None,
            })),
            handle: Arc::new(Mutex::new(None)),
            logger: RequestLogger::default(),
            analysis_enabled: Arc::new(Mutex::new(false)),
            is_thinking_model: Arc::new(Mutex::new(false)),
        }
    }
}