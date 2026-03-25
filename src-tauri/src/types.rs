use std::sync::Arc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json;
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
/// data 序列化为单个对象（取第一条），兼容题库配置 res.data.question/res.data.answer
#[derive(Debug)]
pub struct QueryResponse {
    pub code: i32,
    pub data: Option<Vec<QueryData>>,
    pub message: Option<String>,
}

impl Serialize for QueryResponse {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("code", &self.code)?;
        match &self.data {
            Some(list) if !list.is_empty() => {
                // 取第一条，序列化为对象而非数组
                map.serialize_entry("data", &list[0])?;
            }
            _ => {
                map.serialize_entry("data", &Option::<QueryData>::None)?;
            }
        }
        if let Some(msg) = &self.message {
            map.serialize_entry("message", msg)?;
        }
        map.end()
    }
}

impl<'de> Deserialize<'de> for QueryResponse {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::MapAccess;
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = QueryResponse;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                write!(f, "QueryResponse map")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut code = 0i32;
                let mut data: Option<Vec<QueryData>> = None;
                let mut message = None;
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "code" => code = map.next_value()?,
                        "data" => {
                            let v: serde_json::Value = map.next_value()?;
                            if v.is_array() {
                                data = serde_json::from_value(v).ok();
                            } else if v.is_object() {
                                let item: QueryData = serde_json::from_value(v)
                                    .map_err(serde::de::Error::custom)?;
                                data = Some(vec![item]);
                            }
                        }
                        "message" => message = map.next_value()?,
                        _ => { let _: serde_json::Value = map.next_value()?; }
                    }
                }
                Ok(QueryResponse { code, data, message })
            }
        }
        deserializer.deserialize_map(Visitor)
    }
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
    pub fn success(data: Vec<QueryData>) -> Self {
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
            code: 0,
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
    pub web_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
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
            web_handle: Arc::new(Mutex::new(None)),
            logger: RequestLogger::default(),
            analysis_enabled: Arc::new(Mutex::new(false)),
            is_thinking_model: Arc::new(Mutex::new(false)),
        }
    }
}