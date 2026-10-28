//! API references are resolved only in native request headers, for their bound origin.
//! Redirects are disabled and reflected keys are filtered before returning response bytes.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};
use tauri::ipc::Channel;
use zeroize::Zeroizing;

#[derive(Default)]
struct Requests {
    running: BTreeMap<String, tokio::task::AbortHandle>,
    // Cancellation can arrive while the request command is still being dispatched.
    cancelled: Vec<String>,
}
static REQUESTS: OnceLock<Mutex<Requests>> = OnceLock::new();
static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

#[derive(Default)]
struct ResponseFilter {
    replacements: Vec<(Zeroizing<Vec<u8>>, Vec<u8>)>,
    pending: Zeroizing<Vec<u8>>,
}
impl ResponseFilter {
    fn add(&mut self, secret: &str, reference: &str) {
        if secret.is_empty() {
            return;
        }
        let encoded = serde_json::to_string(secret).unwrap();
        for value in [
            secret.to_string(),
            encoded[1..encoded.len() - 1].to_string(),
        ] {
            if !self
                .replacements
                .iter()
                .any(|(key, _)| **key == value.as_bytes())
            {
                self.replacements.push((
                    Zeroizing::new(value.into_bytes()),
                    reference.as_bytes().to_vec(),
                ));
            }
        }
        self.replacements
            .sort_by_key(|(key, _)| std::cmp::Reverse(key.len()));
    }
    fn push(&mut self, bytes: &[u8], end: bool) -> Vec<u8> {
        self.pending.extend_from_slice(bytes);
        let mut offset = 0;
        let mut output = Vec::new();
        while offset < self.pending.len() {
            let rest = &self.pending[offset..];
            if !end
                && self
                    .replacements
                    .iter()
                    .any(|(key, _)| key.starts_with(rest) && key.len() > rest.len())
            {
                break;
            }
            if let Some((key, replacement)) = self
                .replacements
                .iter()
                .find(|(key, _)| rest.starts_with(key))
            {
                output.extend_from_slice(replacement);
                offset += key.len();
            } else {
                output.push(rest[0]);
                offset += 1;
            }
        }
        self.pending.drain(..offset);
        output
    }
    fn header(&self, value: &str) -> String {
        self.replacements
            .iter()
            .fold(value.to_string(), |result, (key, reference)| {
                result.replace(
                    std::str::from_utf8(key).unwrap(),
                    std::str::from_utf8(reference).unwrap(),
                )
            })
    }
}

#[tauri::command]
pub async fn secure_http_request(
    window: tauri::WebviewWindow,
    request_id: String,
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
    events: Channel<Value>,
) -> Result<(), String> {
    crate::secret_vault::trusted_window(&window)?;
    let (start, ready) = tokio::sync::oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        ready.await.map_err(|_| "请求已取消")?;
        let mut actual = reqwest::header::HeaderMap::new();
        let mut filter = ResponseFilter::default();
        let re = regex::Regex::new(r"\{\{secret:[^{}]+\}\}").unwrap();
        if re.is_match(&url) {
            return Err("请求地址不能包含敏感变量；正文中的变量保持原样".to_string());
        }
        for (name, value) in headers {
            let mut output = Zeroizing::new(value.clone());
            for reference in re.find_iter(&value) {
                let secret = crate::secret_vault::resolve(reference.as_str(), "api", &url)?;
                filter.add(&secret, reference.as_str());
                *output = output.replace(reference.as_str(), secret.as_str());
            }
            actual.insert(
                reqwest::header::HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| "请求头名称无效")?,
                reqwest::header::HeaderValue::from_str(&output).map_err(|_| "请求头值无效")?,
            );
        }
        let client = CLIENT
            .get_or_init(|| {
                reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .connect_timeout(std::time::Duration::from_secs(30))
                    .timeout(std::time::Duration::from_secs(900))
                    .build()
                    .map_err(|_| "无法初始化安全请求".to_string())
            })
            .as_ref()
            .map_err(Clone::clone)?;
        let mut request = client
            .request(
                method
                    .parse::<reqwest::Method>()
                    .map_err(|_| "请求方法无效")?,
                &url,
            )
            .headers(actual);
        if let Some(body) = body {
            request = request.body(body);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| "NetworkError: 服务连接失败")?;
        let headers: BTreeMap<String, String> = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|v| (name.to_string(), filter.header(v)))
            })
            .collect();
        events
            .send(json!({"type":"headers","status":response.status().as_u16(),"headers":headers}))
            .map_err(|_| "请求已取消")?;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "NetworkError: 读取服务响应失败")?
        {
            let safe = filter.push(&chunk, false);
            if !safe.is_empty() {
                events
                    .send(json!({"type":"chunk","data":STANDARD.encode(safe)}))
                    .map_err(|_| "请求已取消")?;
            }
        }
        let tail = filter.push(&[], true);
        if !tail.is_empty() {
            events
                .send(json!({"type":"chunk","data":STANDARD.encode(tail)}))
                .map_err(|_| "请求已取消")?;
        }
        events
            .send(json!({"type":"done"}))
            .map_err(|_| "请求已取消")?;
        Ok::<(), String>(())
    });
    {
        let mut requests = REQUESTS
            .get_or_init(|| Mutex::new(Requests::default()))
            .lock()
            .map_err(|_| "请求状态不可用")?;
        if let Some(index) = requests.cancelled.iter().position(|id| id == &request_id) {
            requests.cancelled.remove(index);
            handle.abort();
            return Err("请求已取消".into());
        }
        requests
            .running
            .insert(request_id.clone(), handle.abort_handle());
    }
    let _ = start.send(());
    let result = handle
        .await
        .map_err(|_| "请求已取消".to_string())
        .and_then(|r| r);
    if let Ok(mut requests) = REQUESTS.get().unwrap().lock() {
        requests.running.remove(&request_id);
    }
    result
}
#[tauri::command]
pub fn secure_http_cancel(window: tauri::WebviewWindow, request_id: String) -> Result<(), String> {
    crate::secret_vault::trusted_window(&window)?;
    let mut requests = REQUESTS
        .get_or_init(|| Mutex::new(Requests::default()))
        .lock()
        .map_err(|_| "请求状态不可用")?;
    if let Some(handle) = requests.running.remove(&request_id) {
        handle.abort();
    } else {
        if requests.cancelled.len() >= 256 {
            requests.cancelled.remove(0);
        }
        requests.cancelled.push(request_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reflected_keys_are_hidden_across_every_chunk_boundary_without_corrupting_unicode() {
        let key = "test-中文-secret";
        let input = format!("data: {{\"key\":\"{}\",\"text\":\"你好\"}}\n\n", key);
        for boundary in 0..=input.len() {
            let mut filter = ResponseFilter::default();
            filter.add(key, "{{secret:api/key}}");
            let mut output = filter.push(&input.as_bytes()[..boundary], false);
            output.extend(filter.push(&input.as_bytes()[boundary..], false));
            output.extend(filter.push(&[], true));
            assert_eq!(
                String::from_utf8(output).unwrap(),
                input.replace(key, "{{secret:api/key}}")
            );
        }
    }
    #[test]
    fn escaped_keys_and_headers_are_filtered_and_partial_nonmatches_are_preserved() {
        let mut filter = ResponseFilter::default();
        filter.add("key\"\\secret", "{{secret:key}}");
        let input = serde_json::to_vec(&json!({"key":"key\"\\secret","tail":"key"})).unwrap();
        let mut output = Vec::new();
        for byte in input {
            output.extend(filter.push(&[byte], false));
        }
        output.extend(filter.push(&[], true));
        assert_eq!(
            serde_json::from_slice::<Value>(&output).unwrap(),
            json!({"key":"{{secret:key}}","tail":"key"})
        );
        assert_eq!(
            filter.header("Bearer key\"\\secret"),
            "Bearer {{secret:key}}"
        );
    }
}
