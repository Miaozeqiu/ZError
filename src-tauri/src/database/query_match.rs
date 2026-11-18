use jieba_rs::Jieba;
use regex::Regex;
use std::cell::OnceCell;
use std::collections::HashSet;
use std::sync::OnceLock;
use strsim::normalized_levenshtein;

fn url_regex() -> &'static Regex {
    static URLS: OnceLock<Regex> = OnceLock::new();
    URLS.get_or_init(|| Regex::new(r"(?:https?://|data:image/)[^\s\u{200b}\u{feff}]+").unwrap())
}

fn url_text(span: &str) -> &str {
    let mut url = span.trim_end_matches(|c: char| {
        matches!(
            c,
            '，' | '。' | '！' | '？' | '、' | '；' | '：' | '【' | '】' | '\u{300c}'..='\u{300f}'
        )
    });
    // A closing bracket can belong to the surrounding question rather than the URL.
    while let Some(close @ (')' | '）')) = url.chars().next_back() {
        let opens = url.chars().filter(|&c| c == '(' || c == '（').count();
        let closes = url.chars().filter(|&c| c == ')' || c == '）').count();
        if closes <= opens {
            break;
        }
        url = &url[..url.len() - close.len_utf8()];
    }
    url
}

/// Preserve the order of links and images in the question.
pub(crate) fn extract_urls(text: &str) -> Vec<String> {
    url_regex()
        .find_iter(text)
        .map(|m| url_text(m.as_str()).to_string())
        .collect()
}

/// 将字符串中所有 URL 替换为统一占位符，用于相似度比较
fn normalize_urls(text: &str) -> std::borrow::Cow<'_, str> {
    url_regex().replace_all(text, |captures: &regex::Captures<'_>| {
        let span = &captures[0];
        format!("__URL__{}", &span[url_text(span).len()..])
    })
}

static JIEBA: OnceLock<Jieba> = OnceLock::new();

const QUERY_STOPWORDS: &[&str] = &[
    "的",
    "地",
    "得",
    "了",
    "着",
    "吗",
    "呢",
    "啊",
    "呀",
    "吧",
    "么",
    "嘛",
    "在",
    "是",
    "和",
    "与",
    "及",
    "或",
    "并",
    "且",
    "将",
    "把",
    "被",
    "由",
    "对",
    "于",
    "中",
    "上",
    "下",
    "请问",
    "哪里",
    "哪儿",
    "哪个",
    "哪种",
    "哪项",
    "哪些",
    "什么",
    "怎么",
    "怎样",
    "如何",
    "为何",
    "为什么",
    "多少",
    "几",
    "一下",
    "以下",
    "下列",
    "题目",
    "选项",
    "答案",
    "内容",
    "说法",
    "图片",
    "图中",
    "名字",
    "名称",
    "城市",
    "国家",
    "地区",
    "地方",
];

/// A generic stem cannot identify a question without its choices.
pub(crate) fn is_generic_choice_title(title: &str) -> bool {
    static GENERIC_STEM: OnceLock<Regex> = OnceLock::new();
    let pattern = GENERIC_STEM.get_or_init(|| {
        let wording = concat!(
            r"(?:下列|以下|下面|下述|下叙|上述|上列|",
            r"哪(?:一|几)?(?:项|个|种)|哪些|[各每](?:项|个|种)|",
            r"说法|选项|答案|陈述|表述|叙述|描述|选择|选出|单选题?|多选题?|",
            r"[一项的中是不为请最有均都]|\p{P})",
        );
        let judgment = r"(?:正确|错误|恰当|合适|准确|合理|符合(?:题意|要求)|对|错)";
        Regex::new(&format!(
            r"^(?:第[0-9]+题|[0-9]+[.、)])?{wording}*{judgment}{wording}*$"
        )).unwrap()
    });
    pattern.is_match(title.trim_matches(is_punctuation_or_space))
}

pub(crate) fn normalize_optional_query_text(text: Option<&str>) -> Option<String> {
    text.map(str::trim)
        .filter(|text| text.chars().any(|c| !is_query_spacing(c)))
        .map(|text| text.to_string())
}

pub(crate) fn is_punctuation_or_space(c: char) -> bool {
    c.is_whitespace()
        || c.is_ascii_punctuation()
        || matches!(
            c,
            '，' | '。'
                | '！'
                | '？'
                | '、'
                | '；'
                | '：'
                | '（'
                | '）'
                | '【'
                | '】'
                | '《'
                | '》'
                | '“'
                | '”'
                | '‘'
                | '’'
                | '—'
                | '…'
                | '·'
        )
}

pub(crate) fn is_meaningful_query_token(token: &str) -> bool {
    let trimmed = token.trim();
    if trimmed.is_empty() || QUERY_STOPWORDS.contains(&trimmed) {
        return false;
    }
    if trimmed.chars().all(is_punctuation_or_space) {
        return false;
    }

    let char_count = trimmed.chars().count();
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if trimmed.chars().all(|c| c.is_ascii_alphabetic()) {
        return char_count > 1;
    }

    char_count > 1
}

pub(crate) fn extract_query_keywords(text: &str) -> HashSet<String> {
    let jieba = JIEBA.get_or_init(Jieba::new);
    jieba
        .cut_for_search(text, false)
        .into_iter()
        .map(|token| token.trim().to_lowercase())
        .filter(|token| is_meaningful_query_token(token))
        .collect()
}

pub(crate) fn keyword_coverage(
    query_keywords: &HashSet<String>,
    candidate_keywords: &HashSet<String>,
) -> f64 {
    if query_keywords.is_empty() {
        return 1.0;
    }

    let matched = query_keywords
        .iter()
        .filter(|token| candidate_keywords.contains(*token))
        .count();

    matched as f64 / query_keywords.len() as f64
}

pub(crate) fn min_keyword_coverage(query_keywords_len: usize, char_similarity: f64) -> f64 {
    if query_keywords_len <= 2 {
        return 1.0;
    }

    // 高字符相似但关键词数量不多时，要求所有关键词都命中，
    // 避免“题干几乎一致但核心词不同”的题目误匹配。
    if char_similarity >= 0.88 && query_keywords_len <= 8 {
        return 1.0;
    }

    if query_keywords_len <= 4 {
        return 1.0;
    }

    if query_keywords_len <= 8 {
        return 0.9;
    }

    0.75
}

fn is_query_spacing(c: char) -> bool {
    c.is_whitespace() || matches!(c, '\u{200b}' | '\u{feff}')
}

pub(crate) fn compact_query_spacing(text: &str) -> String {
    text.chars().filter(|&c| !is_query_spacing(c)).collect()
}

pub(crate) fn normalize_search_text(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '\u{200b}' | '\u{feff}'))
        .map(|c| match c {
            '（' => '(',
            '）' => ')',
            '？' => '?',
            '！' => '!',
            '，' => ',',
            '：' => ':',
            '；' => ';',
            _ => c,
        })
        .flat_map(char::to_lowercase)
        .collect()
}

pub(crate) struct QueryMatchText {
    words: String,
    pub compact: String,
    keywords: OnceCell<HashSet<String>>,
    pairs: OnceCell<HashSet<(char, char)>>,
}

impl QueryMatchText {
    pub(crate) fn new(text: &str) -> Self {
        let words = normalize_search_text(&normalize_urls(text));
        let compact = compact_query_spacing(&words);
        Self {
            words,
            compact,
            keywords: OnceCell::new(),
            pairs: OnceCell::new(),
        }
    }

    pub(crate) fn matches_omitted_blank(&self, candidate: &Self) -> bool {
        let (with_blank, plain) = match (
            self.compact.contains("()"),
            candidate.compact.contains("()"),
        ) {
            (true, false) => (&self.compact, &candidate.compact),
            (false, true) => (&candidate.compact, &self.compact),
            _ => return false,
        };
        !plain.is_empty() && with_blank.replacen("()", "", 1) == *plain
    }
}

pub(crate) fn query_text_similarity(query: &str, candidate: &str) -> f64 {
    if query.is_empty() || candidate.is_empty() {
        0.0
    } else if query == candidate {
        1.0
    } else {
        normalized_levenshtein(query, candidate)
    }
}

pub(crate) fn compute_query_match_score(query: &str, candidate: &str) -> Option<f64> {
    if extract_urls(query) != extract_urls(candidate) {
        return None;
    }
    let query = QueryMatchText::new(query);
    let candidate = QueryMatchText::new(candidate);
    let similarity = query_text_similarity(&query.compact, &candidate.compact);
    filter_query_match_score(&query, &candidate, similarity)
}

pub(crate) fn search_character_pairs(text: &str) -> impl Iterator<Item = (char, char)> + '_ {
    text.chars()
        .zip(text.chars().skip(1))
        .filter(|(a, b)| a.is_alphanumeric() && b.is_alphanumeric())
}

pub(crate) fn filter_query_match_score(
    query: &QueryMatchText,
    candidate: &QueryMatchText,
    char_similarity: f64,
) -> Option<f64> {
    if query.compact.is_empty() || candidate.compact.is_empty() {
        return None;
    }
    if query.compact == candidate.compact {
        return Some(1.0);
    }

    let query_keywords = query
        .keywords
        .get_or_init(|| extract_query_keywords(&query.words));
    let candidate_keywords = candidate
        .keywords
        .get_or_init(|| extract_query_keywords(&candidate.words));
    let coverage = keyword_coverage(query_keywords, candidate_keywords);
    if char_similarity >= 0.72
        && coverage + f64::EPSILON >= min_keyword_coverage(query_keywords.len(), char_similarity)
    {
        return Some(char_similarity * 0.7 + coverage * 0.3);
    }
    // Shared words and character pairs can recover rephrased titles. They only
    // create candidates for the same-question check, never exact matches.
    if query_keywords.len() < 3 || coverage < 0.6 {
        return None;
    }
    let query_pairs = query
        .pairs
        .get_or_init(|| search_character_pairs(&query.compact).collect());
    let candidate_pairs = candidate
        .pairs
        .get_or_init(|| search_character_pairs(&candidate.compact).collect());
    let overlap = 2.0 * query_pairs.intersection(candidate_pairs).count() as f64
        / (query_pairs.len() + candidate_pairs.len()).max(1) as f64;
    (overlap >= 0.45).then_some(char_similarity * 0.4 + coverage * 0.3 + overlap * 0.3)
}

pub(crate) fn is_exact_match_score(score: f64) -> bool {
    (score - 1.0).abs() <= f64::EPSILON
}

/// Parse only unambiguous sequential labels. Continuation lines belong to the preceding choice.
pub(crate) fn labeled_options(text: &str) -> Option<Vec<(char, String)>> {
    static LABEL: OnceLock<Regex> = OnceLock::new();
    let label = LABEL.get_or_init(|| Regex::new(r"^([A-Za-z])\s*([.．、)）])\s*(.*)$").unwrap());
    let mut options: Vec<(char, String)> = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let capture = label.captures(line).filter(|capture| {
            let body = capture[3].as_bytes();
            // A chemical element list such as C、H、O is option text.
            &capture[2] != "、"
                || !(body.first().is_some_and(u8::is_ascii_alphabetic)
                    && body
                        .get(1..)
                        .is_some_and(|rest| rest.starts_with("、".as_bytes())))
        });
        if let Some(capture) = capture {
            let key = capture[1].as_bytes()[0].to_ascii_uppercase();
            if usize::from(key - b'A') != options.len() {
                return None;
            }
            options.push((char::from(key), capture[3].to_string()));
        } else {
            let (_, body) = options.last_mut()?;
            if !body.is_empty() {
                body.push('\n');
            }
            body.push_str(line);
        }
    }
    (!options.is_empty() && options.iter().all(|(_, body)| !body.is_empty())).then_some(options)
}

pub(crate) fn same_option_text(a: &str, b: &str) -> bool {
    extract_urls(a) == extract_urls(b)
        && QueryMatchText::new(a).compact == QueryMatchText::new(b).compact
}

pub(crate) fn nonempty_option_lines(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .map(str::trim)
        .filter(|line| line.chars().any(|c| !is_query_spacing(c)))
}

/// Allow reordered choices only when each choice body still has a matching counterpart.
pub(crate) fn same_query_options_unordered(query: &str, candidate: &str) -> bool {
    fn keys(text: &str) -> Vec<(String, Vec<String>)> {
        let bodies = labeled_options(text)
            .map(|options| options.into_iter().map(|(_, body)| body).collect())
            .unwrap_or_else(|| {
                nonempty_option_lines(text)
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            });
        let mut keys: Vec<_> = bodies
            .iter()
            .map(|body| (QueryMatchText::new(body).compact, extract_urls(body)))
            .collect();
        keys.sort_unstable();
        keys
    }
    keys(query) == keys(candidate)
}

pub(crate) fn exact_query_options_match(query: &str, candidate: &str) -> bool {
    match (labeled_options(query), labeled_options(candidate)) {
        (Some(query), Some(candidate)) => {
            query.len() == candidate.len()
                && query
                    .iter()
                    .zip(&candidate)
                    .all(|((_, a), (_, b))| same_option_text(a, b))
        }
        (None, None) => {
            let mut query = nonempty_option_lines(query);
            let mut candidate = nonempty_option_lines(candidate);
            loop {
                match (query.next(), candidate.next()) {
                    (Some(a), Some(b)) if same_option_text(a, b) => continue,
                    (None, None) => break true,
                    _ => break false,
                }
            }
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compute_query_match_score, exact_query_options_match, is_exact_match_score,
        is_generic_choice_title, QueryMatchText,
    };

    #[test]
    fn only_generic_option_judgments_require_choices() {
        for title in [
            "下列选项正确的是",
            "下列选项错误的是",
            "以下哪一项不正确？",
            "下面各项中，描述错误的是（ ）",
            "上述说法中、哪一项是错误的？",
            "1. 下列说法中，不正确的是（ ）",
            "请选择正确选项",
        ] {
            assert!(is_generic_choice_title(&QueryMatchText::new(title).compact), "{title}");
        }
        for title in [
            "下列哪种媒介的雄虫不传播疾病？",
            "下列关于蚊虫传播的说法正确的是",
            "以下哪一种属于哺乳动物？",
        ] {
            assert!(!is_generic_choice_title(&QueryMatchText::new(title).compact), "{title}");
        }
    }

    #[test]
    fn ignores_spacing_and_parenthesis_width_in_question_text() {
        assert_eq!(
            compute_query_match_score(
                "中国画（ ）\n 有哪些种类？",
                "中\u{200b}国画(\t)有哪些种类？"
            ),
            Some(1.0)
        );
        assert_ne!(compute_query_match_score("2×（3+4）", "2×3+4"), Some(1.0));
    }

    #[test]
    fn option_wrapping_preserves_distinct_choices() {
        assert!(exact_query_options_match(
            "A. 山水画（ 宋代 ）\nB. 花鸟画",
            "A. 山水画\n (宋代)\r\n\r\nB.花鸟画"
        ));
        assert!(exact_query_options_match(
            "山水画\n\n 花鸟画",
            "山水画\r\n花鸟画"
        ));
        assert!(!exact_query_options_match("甲乙\n丙", "甲\n乙丙"));
    }

    #[test]
    fn normalizes_parentheses_around_urls_without_merging_different_images() {
        let query = "看图(https://example.test/figure(1).png)";
        assert_eq!(
            compute_query_match_score(query, "看图（ https://example.test/figure(1).png ）"),
            Some(1.0)
        );
        assert_eq!(
            compute_query_match_score(query, "看图（ https://example.test/figure(2).png ）"),
            None
        );
    }

    #[test]
    fn rejects_same_template_with_different_entity() {
        assert!(compute_query_match_score("韩国的首都在哪里", "美国的首都在哪里").is_none());
    }

    #[test]
    fn keeps_same_question_with_small_wording_changes() {
        assert!(compute_query_match_score("韩国的首都在哪里", "韩国首都是哪里").is_some());
    }

    #[test]
    fn keeps_exact_match() {
        assert_eq!(
            compute_query_match_score("韩国的首都在哪里", "韩国的首都在哪里"),
            Some(1.0)
        );
    }

    #[test]
    fn compares_image_positions_and_option_boundaries() {
        assert_eq!(
            compute_query_match_score(
                "甲 https://example.test/1.png 乙 https://example.test/2.png",
                "甲 https://example.test/2.png 乙 https://example.test/1.png",
            ),
            None
        );
        assert!(!exact_query_options_match(
            "A. 甲 B. 乙\nC. 丙",
            "A. 甲\nB. 乙 C. 丙"
        ));
        assert!(exact_query_options_match("A．甲\nB）乙", "A. 甲\nB. 乙"));
        assert_eq!(
            compute_query_match_score("中国画有哪些种类？", "中国画有哪些种类?"),
            Some(1.0)
        );
    }

    #[test]
    fn exact_match_score_is_detected() {
        assert!(is_exact_match_score(1.0));
        assert!(!is_exact_match_score(0.999));
    }
}
