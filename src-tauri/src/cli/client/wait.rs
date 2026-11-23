use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize, PartialEq)]
pub(super) struct TaskRef {
    pub id: String,
    #[serde(rename = "messageId")]
    pub message_id: String,
}
#[derive(Debug)]
pub(super) enum WaitError {
    Connection(String),
    Protocol(&'static str),
    Timeout(TaskRef),
}

pub(super) fn wait_for_task(
    accepted: &Value,
    timeout: Duration,
    mut poll: impl FnMut(&TaskRef, Duration) -> Result<Value, String>,
    mut pause: impl FnMut(Duration),
) -> Result<Value, WaitError> {
    let task: TaskRef = serde_json::from_value(accepted["result"].clone())
        .map_err(|_| WaitError::Protocol("未返回完整任务标识；不会按对话读取其他任务代替"))?;
    if task.id.is_empty() || task.message_id.is_empty() {
        return Err(WaitError::Protocol("任务标识不能为空"));
    }
    let start = Instant::now();
    loop {
        let remaining = timeout.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            return Err(WaitError::Timeout(task));
        }
        pause(remaining.min(Duration::from_millis(500)));
        let remaining = timeout.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            return Err(WaitError::Timeout(task));
        }
        let mut response = poll(&task, remaining).map_err(WaitError::Connection)?;
        if response["ok"] == false {
            return Ok(response);
        }
        if response["ok"] != true
            || response["result"]["id"] != task.id
            || response["result"]["messageId"] != task.message_id
        {
            return Err(WaitError::Protocol(
                "任务回执标识不匹配；已停止等待，未读取其他任务代替",
            ));
        }
        match response["result"]["busy"].as_bool() {
            Some(true) => continue,
            None => return Err(WaitError::Protocol("任务回执缺少运行状态")),
            Some(false) => (),
        }
        if !matches!(
            response["result"]["status"].as_str(),
            Some("done" | "completed")
        ) {
            response["ok"] = json!(false);
            response["error"] = json!("任务未成功完成，请查看该任务的消息和错误回执");
        }
        return Ok(response);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn accepted() -> Value {
        json!({"ok":true,"result":{"id":"session","messageId":"task-a"}})
    }
    fn reply(id: &str, busy: bool, status: &str) -> Value {
        json!({"ok":true,"result":{"id":"session","messageId":id,"busy":busy,"status":status}})
    }
    #[test]
    fn waits_for_exact_message_and_preserves_its_result() {
        let mut count = 0;
        let result = wait_for_task(
            &accepted(),
            Duration::from_secs(1),
            |task, remaining| {
                assert_eq!(task.message_id, "task-a");
                assert!(remaining <= Duration::from_secs(1));
                count += 1;
                Ok(reply(
                    "task-a",
                    count == 1,
                    if count == 1 { "running" } else { "completed" },
                ))
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(count, 2);
        assert_eq!(result["ok"], true);
    }
    #[test]
    fn rejects_latest_message_or_missing_identity() {
        assert!(matches!(
            wait_for_task(
                &accepted(),
                Duration::from_secs(1),
                |_, _| Ok(reply("task-b", false, "completed")),
                |_| {}
            ),
            Err(WaitError::Protocol(_))
        ));
        assert!(matches!(
            wait_for_task(
                &json!({"result":{"id":"session"}}),
                Duration::from_secs(1),
                |_, _| panic!("must not poll"),
                |_| {}
            ),
            Err(WaitError::Protocol(_))
        ));
    }
    #[test]
    fn timeout_retains_identity_without_stopping_or_polling_other_tasks() {
        assert!(
            matches!(wait_for_task(&accepted(),Duration::ZERO,|_,_|panic!("must not poll"),|_|{}),Err(WaitError::Timeout(TaskRef{message_id,..})) if message_id=="task-a")
        );
    }
    #[test]
    fn failure_cancel_block_and_incomplete_do_not_succeed() {
        for status in ["failed", "stopped", "blocked", "interrupted", "incomplete"] {
            let result = wait_for_task(
                &accepted(),
                Duration::from_secs(1),
                |_, _| Ok(reply("task-a", false, status)),
                |_| {},
            )
            .unwrap();
            assert_eq!(result["ok"], false);
            assert_eq!(result["result"]["messageId"], "task-a");
        }
    }
    #[test]
    fn connection_and_protocol_failures_are_distinct() {
        assert!(matches!(
            wait_for_task(
                &accepted(),
                Duration::from_secs(1),
                |_, _| Err("closed".into()),
                |_| {}
            ),
            Err(WaitError::Connection(_))
        ));
        assert!(matches!(
            wait_for_task(
                &accepted(),
                Duration::from_secs(1),
                |_, _| Ok(json!({"ok":true,"result":{"id":"session","messageId":"task-a"}})),
                |_| {}
            ),
            Err(WaitError::Protocol(_))
        ));
    }
}
