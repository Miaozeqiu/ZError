use crate::logger::RequestLogger;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json;
use std::sync::Arc;
use tokio::task::JoinHandle;

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
    /// 图片题优化（OCS >= 5.1.0）：base64 图片数组，与 [图片N] 占位符严格同序。
    /// 兼容 JSON 数组和 `${images}` 字符串占位符两种传参形式。
    #[serde(default, deserialize_with = "deserialize_images_field")]
    pub images: Option<Vec<String>>,
    /// 图片题优化：题干图片 URL 替换为 [图片N] 占位符后的文本（不含 base64）
    #[serde(default)]
    pub suggestion_title: Option<String>,
    /// 图片题优化：选项中图片 URL 替换为 [图片N] 占位符后的文本（选项无图片时可能为空串）
    #[serde(default)]
    pub suggestion_options: Option<String>,
}

/// 反序列化 images 字段：兼容 JSON 数组与 `${images}` 字符串占位符两种形式
fn deserialize_images_field<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Array(items)) => Ok(Some(
            items
                .into_iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .filter(|s| !s.trim().is_empty())
                .collect(),
        )),
        Some(serde_json::Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            // 单个 data URL 直接返回；逗号拼接串按 ",data:" 边界切分
            if trimmed.starts_with("data:") && !trimmed[5..].contains(",data:") {
                return Ok(Some(vec![trimmed.to_string()]));
            }
            let parts: Vec<String> = trimmed
                .split(",data:")
                .enumerate()
                .map(|(i, part)| {
                    if i == 0 {
                        part.trim().to_string()
                    } else {
                        format!("data:{}", part.trim())
                    }
                })
                .filter(|s| s.starts_with("data:"))
                .collect();
            Ok(Some(parts))
        }
        Some(_) => Ok(None),
    }
}

/// 模型调用响应请求结构体
#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCallResponseRequest {
    pub request_id: String,
    pub content: String,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub is_success: Option<bool>,
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
                                let item: QueryData =
                                    serde_json::from_value(v).map_err(serde::de::Error::custom)?;
                                data = Some(vec![item]);
                            }
                        }
                        "message" => message = map.next_value()?,
                        _ => {
                            let _: serde_json::Value = map.next_value()?;
                        }
                    }
                }
                Ok(QueryResponse {
                    code,
                    data,
                    message,
                })
            }
        }
        deserializer.deserialize_map(Visitor)
    }
}

/// 查询数据结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryData {
    pub id: i64,
    pub question: String,
    pub answer: String,
    pub is_ai: bool,
    pub is_pending_correction: bool,
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
pub struct ServerState {
    pub info: Arc<Mutex<ServerInfo>>,
    pub handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub logger: RequestLogger,
    pub app_handle: Option<tauri::AppHandle>,
}

impl std::fmt::Debug for ServerState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServerState")
            .field("info", &self.info)
            .field("handle", &self.handle)
            .field("logger", &self.logger)
            .field("app_handle", &self.app_handle)
            .finish()
    }
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
            app_handle: None,
        }
    }
}
