mod query;
pub use query::*;
mod model;
use model::*;
mod http;
pub use http::*;
mod answers;
use answers::*;

use crate::app_activity::{begin_server_activity, end_server_activity};
use crate::database::{
    insert_ai_response, query_database_for_request, question_match_is_current, record_exact_match_rejection,
    set_question_pending_correction, LocalMatchStatus, LocalQuestionMatch, QuestionMatch,
};
use crate::types::{
    ModelCallProgressRequest, ModelCallResponseRequest, QueryData, QueryRequest, QueryResponse,
    QuerySaveFailure, ServerInfo, ServerState,
};
use futures_util::StreamExt;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::net::SocketAddr;
use tauri::{AppHandle, Emitter, State};
use tokio_stream::wrappers::BroadcastStream;
use uuid;
use warp::http::HeaderMap;
use warp::{Filter, Reply};

mod correction;
mod query_progress;

use query_progress::{QueryProgress, State as ProgressState, Step as ProgressStep};


const QUERY_TEST_PAGE_HTML: &str = include_str!("query_test_page.html");
const QUERY_DETAILS_CSS: &str = concat!(
    include_str!("../../src/styles/themes.css"),
    include_str!("../../src/views/home/RequestDetailsShared.css"),
    include_str!("../../src/views/home/SearchTraces.css"),
);
const QUERY_DETAILS_JS: &str = include_str!("query_details.js");


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QuestionKind {
    Single,
    Multiple,
    Judgement,
    Completion,
}

impl QuestionKind {
    pub(crate) fn requires_options(self) -> bool {
        matches!(self, Self::Single | Self::Multiple)
    }

    fn chinese_name(&self) -> &'static str {
        match self {
            QuestionKind::Single => "单选",
            QuestionKind::Multiple => "多选",
            QuestionKind::Judgement => "判断",
            QuestionKind::Completion => "填空",
        }
    }

    fn prompt_hint(&self) -> &'static str {
        match self {
            QuestionKind::Single => {
                "这是单选题，只有一个正确答案。answer 只能写正确选项的完整文字（与【选项】原文一致），禁止写 A/B/C/D，也禁止写成「B. 传动角」这种带字母前缀的形式，应直接写「传动角」。"
            }
            QuestionKind::Multiple => {
                "这是多选题，可能有多个正确答案。answer 只写各正确选项的完整文字，用 ### 连接（顺序不限）。禁止写 ABD，禁止写「A. xxx###C. yyy」这种带字母前缀的形式。"
            }
            QuestionKind::Judgement => {
                "这是判断题。answer 只能是「正确」或「错误」二字之一。禁止写 A/B，禁止写「A. 正确」。"
            }
            QuestionKind::Completion => {
                "这是填空题。answer 只填空白处应填的内容本身；若有多个空，用 ### 连接。不要加第1空/①/A. 等序号前缀。"
            }
        }
    }

    /// 题型对应的典型对答示例（写入 prompt；前端也会以多轮对话注入）
    fn few_shot_block(&self) -> &'static str {
        match self {
            QuestionKind::Single => {
                "【作答示例】\n\
题目：凸轮机构中从动件运动规律取决于（ ）。\n\
选项：A. 压力角  B. 传动角  C. 极力夹角\n\
正确输出：{\"answer\": \"传动角\"}\n\
错误输出：{\"answer\": \"B. 传动角\"} 或 {\"answer\": \"B\"}\n"
            }
            QuestionKind::Multiple => {
                "【作答示例】\n\
题目：下列属于输入设备的有（ ）。\n\
选项：A. 键盘  B. 显示器  C. 鼠标  D. 打印机\n\
正确输出：{\"answer\": \"键盘###鼠标\"}\n\
错误输出：{\"answer\": \"AC\"} 或 {\"answer\": \"A. 键盘###C. 鼠标\"}\n"
            }
            QuestionKind::Judgement => {
                "【作答示例】\n\
题目：地球绕太阳公转一周约为 365 天。\n\
正确输出：{\"answer\": \"正确\"}\n\
错误输出：{\"answer\": \"A\"} 或 {\"answer\": \"A. 正确\"}\n"
            }
            QuestionKind::Completion => {
                "【作答示例】\n\
题目：中国的首都是____，最大的城市是____。\n\
正确输出：{\"answer\": \"北京###上海\"}\n\
错误输出：{\"answer\": \"第1空：北京###第2空：上海\"}\n"
            }
        }
    }
}


const SAME_QUESTION_CHECK_PREFIX: &str = "__SAME_QUESTION_CHECK__:";
const SAME_QUESTION_CANDIDATE_LIMIT: usize = 5;


#[derive(serde::Serialize)]
pub struct HomeworkBankAnswer {
    id: i64,
    answer: String,
}


#[cfg(test)]
mod same_question_tests {
    use super::{answer_for_local_match, classify_model_failure, normalize_answer_against_options, parse_same_question_result};
    use crate::{database::QuestionMatch, types::QueryRequest};

    #[test]
    fn homework_bank_binds_stored_labels_to_current_text_and_rejects_ambiguity() {
        let mut row = super::QuestionMatch {
            id: 1, question: "请选择".into(), options: Some("A. 甲\nB. 乙 选项".into()),
            answer: "B".into(), question_type: Some("single".into()), is_ai: false,
            is_pending_correction: false, score: 1.0, title_similarity: 1.0,
        };
        let request: super::QueryRequest = serde_json::from_value(serde_json::json!({
            "title": "请选择", "options": "A. 乙选项\nB. 甲", "type": "single"
        })).unwrap();
        assert_eq!(super::homework_bank_answer(&row, &request).as_deref(), Some("乙选项"));
        row.options = Some("A. B\nB. 乙 选项".into());
        assert_eq!(super::homework_bank_answer(&row, &request), None);
    }

    #[test]
    fn maps_stored_choice_letter_by_content_after_reordering() {
        let matched = QuestionMatch {
            id: 1, question: "测试题".into(), options: Some("A. 山水画\n（宋代）\nB. 花鸟画".into()),
            answer: "A".into(), is_ai: false, is_pending_correction: false,
            question_type: Some("single".into()), score: 1.0, title_similarity: 1.0,
        };
        let mut request: QueryRequest = serde_json::from_value(serde_json::json!({
            "title": "测试题", "type": "single", "options": "A. 花鸟画\nB. 山水画(宋代)"
        })).unwrap();
        assert_eq!(answer_for_local_match(&matched, &request).as_deref(), Some("山水画(宋代)"));
        request.options = Some("A. 花鸟画\nB. 山水画(明代)".into());
        assert_eq!(answer_for_local_match(&matched, &request), None);
        request.options = None;
        request.query_type = None;
        assert_eq!(answer_for_local_match(&matched, &request).as_deref(), Some("山水画\n（宋代）"));

        let insect_match = QuestionMatch {
            id: 6715,
            question: "虫媒病的季节性主要取决于：".into(),
            options: Some("A. 湿度\nB. 雨量\nC. 温度\nD. 光照\nE. 食性".into()),
            answer: "C".into(),
            question_type: Some("单选".into()),
            ..matched.clone()
        };
        request.title = insect_match.question.clone();
        for options in [None, Some(""), Some("\u{200b}\n\u{feff}")] {
            request.options = options.map(str::to_owned);
            assert_eq!(answer_for_local_match(&insect_match, &request).as_deref(), Some("温度"));
        }
        request.options = None;
        let mosquito_match = QuestionMatch {
            question: "下列哪种媒介的雄虫不传播疾病？".into(),
            options: Some("A. 蚊\nB. 蝇\nC. 蚤\nD. 虱\nE. 蜚蠊".into()),
            answer: "A".into(),
            ..insect_match
        };
        request.title = mosquito_match.question.clone();
        assert_eq!(answer_for_local_match(&mosquito_match, &request).as_deref(), Some("蚊"));

        let mut dependent = matched;
        dependent.options = Some("A. 以上都正确\nB. 花鸟画".into());
        assert_eq!(answer_for_local_match(&dependent, &request), None);
    }

    #[test]
    fn preserves_empty_completion_answer_slots() {
        assert_eq!(normalize_answer_against_options("甲######丙", None), "甲######丙");
        assert_eq!(normalize_answer_against_options("###乙###", None), "###乙###");
        assert_eq!(normalize_answer_against_options("######", None), "######");
    }

    #[test]
    fn parses_same_true_with_matched_id() {
        assert_eq!(
            parse_same_question_result(r#"{"same":true,"matched_id":42}"#),
            Some(42)
        );
        assert_eq!(
            parse_same_question_result("答案如下\n{\"same\": true, \"matched_id\": 7}\n"),
            Some(7)
        );
    }

    #[test]
    fn parses_same_false_or_invalid_as_none() {
        assert_eq!(parse_same_question_result(r#"{"same":false}"#), None);
        assert_eq!(parse_same_question_result("错误: 未选择模型"), None);
        assert_eq!(parse_same_question_result(""), None);
    }

    #[test]
    fn no_model_selected_is_400_not_500() {
        let (status, msg) = classify_model_failure("错误: 未选择模型").expect("classified");
        assert_eq!(status, 400);
        assert_eq!(msg, "错误: 未选择模型");
    }
}

#[cfg(test)]
mod image_question_tests {
    use super::{
        build_query_request_log_body, image_placeholder_map, request_has_images,
        resolve_question_payload, restore_image_placeholders,
    };
    use crate::types::QueryRequest;

    fn make_request(
        title: &str,
        options: Option<&str>,
        images: Option<Vec<&str>>,
        suggestion_title: Option<&str>,
        suggestion_options: Option<&str>,
    ) -> QueryRequest {
        QueryRequest {
            title: title.to_string(),
            options: options.map(str::to_string),
            query_type: Some("completion".to_string()),
            images: images.map(|list| list.into_iter().map(str::to_string).collect()),
            suggestion_title: suggestion_title.map(str::to_string),
            suggestion_options: suggestion_options.map(str::to_string),
        }
    }

    #[test]
    fn maps_ocs_numbers_without_url_extension_assumptions() {
        let original = "题 https://a.com/render?id=1 与 https://b.com/y.png";
        let suggestion = "题  [图片1]  与  [图片2] ";
        let mapping = image_placeholder_map(original, suggestion).unwrap();
        assert_eq!(mapping.get(&1).unwrap(), "https://a.com/render?id=1");
        assert_eq!(mapping.get(&2).unwrap(), "https://b.com/y.png");
    }

    #[test]
    fn maps_only_successfully_converted_images() {
        let request = make_request("https://a.com/failed.png https://b.com/success.png", None,
            Some(vec!["data:image/png;base64,AAA"]),
            Some("https://a.com/failed.png  [图片1] "), None);
        assert_eq!(restore_image_placeholders("[图片1]", &request), "https://b.com/success.png");
    }

    #[test]
    fn leaves_ambiguous_missing_and_invalid_mappings_for_ocs() {
        let request = make_request("https://a.com/x.png", None, None, None, None);
        assert_eq!(restore_image_placeholders("[图片1]", &request), "[图片1]");
        assert!(image_placeholder_map("https://a.com/a.png https://a.com/b.png", "[图片1] [图片1]").is_none());
        assert!(image_placeholder_map("https://a.com/a.png", "[图片0]").is_none());
        assert!(image_placeholder_map("different text", "[图片1]").is_none());
    }

    #[test]
    fn restores_shared_title_and_option_numbers() {
        let request = make_request("题https://a.com/x.png", Some("A. https://a.com/x.png\nB. https://b.com/render?id=2"),
            Some(vec!["data:image/png;base64,AAA", "data:image/png;base64,BBB"]),
            Some("题 [图片1] "), Some("A.  [图片1] \nB.  [图片2] "));
        assert_eq!(restore_image_placeholders("[图片2]###[图片1]", &request), "https://b.com/render?id=2###https://a.com/x.png");
    }

    #[test]
    fn restores_placeholders_to_original_urls() {
        let request = make_request(
            "题<img src=\"https://a.com/x.png\">，又<img src=\"https://b.com/y.png\">",
            None,
            None,
            Some("题<img src=\" [图片1] \">，又<img src=\" [图片2] \">"),
            None,
        );
        assert_eq!(
            restore_image_placeholders("答案为[图片2]，补充[图片1]", &request),
            "答案为https://b.com/y.png，补充https://a.com/x.png"
        );
    }

    #[test]
    fn keeps_out_of_range_placeholder() {
        let request = make_request("题<img src=\"https://a.com/x.png\">", None, None, None, None);
        assert_eq!(restore_image_placeholders("[图片3]", &request), "[图片3]");
    }

    #[test]
    fn image_payload_prefers_suggestion_text() {
        let request = make_request(
            "原始题干 https://a.com/x.png",
            Some("原始选项 https://b.com/y.png"),
            Some(vec!["data:image/png;base64,AAA"]),
            Some("占位题干 [图片1]"),
            Some("A. 占位选项"),
        );
        let (title, options, images) = resolve_question_payload(&request);
        assert_eq!(title, "占位题干 [图片1]");
        assert_eq!(options.as_deref(), Some("A. 占位选项"));
        assert_eq!(images.len(), 1);
    }

    #[test]
    fn text_payload_falls_back_to_original_title() {
        let request = make_request("普通题干", Some("A. 选项"), None, None, None);
        let (title, options, images) = resolve_question_payload(&request);
        assert_eq!(title, "普通题干");
        assert_eq!(options.as_deref(), Some("A. 选项"));
        assert!(images.is_empty());
        assert!(!request_has_images(&request));
    }

    #[test]
    fn log_body_summarizes_base64_images() {
        let request = make_request(
            "题干",
            None,
            Some(vec!["data:image/png;base64,AAA", "data:image/png;base64,BBB"]),
            Some("[图片1]"),
            None,
        );
        let body = build_query_request_log_body(&request);
        assert!(body.contains("\"has_images\":true"));
        assert!(body.contains("2 张 base64 图片"));
        assert!(!body.contains("base64,AAA"));
    }

    #[test]
    fn invalid_image_array_slots_are_rejected_instead_of_renumbered() {
        for json in [r#"{"title":"t","images":["", "data:image/png;base64,BBB"]}"#,
                     r#"{"title":"t","images":[null, "data:image/png;base64,BBB"]}"#] {
            assert!(serde_json::from_str::<QueryRequest>(json).is_err());
        }
    }

    #[test]
    fn deserializes_images_as_array_or_placeholder_string() {
        let from_array: QueryRequest = serde_json::from_str(
            r#"{"title":"t","images":["data:image/png;base64,AAA"],"suggestion_title":"[图片1]"}"#,
        )
        .expect("array form");
        assert_eq!(from_array.images.as_ref().map(Vec::len), Some(1));
        assert_eq!(from_array.suggestion_title.as_deref(), Some("[图片1]"));

        let from_string: QueryRequest = serde_json::from_str(
            r#"{"title":"t","images":"data:image/png;base64,AAA,data:image/png;base64,BBB"}"#,
        )
        .expect("string form");
        assert_eq!(
            from_string.images,
            Some(vec![
                "data:image/png;base64,AAA".to_string(),
                "data:image/png;base64,BBB".to_string(),
            ])
        );
    }
}
