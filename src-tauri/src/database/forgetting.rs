use chrono::{DateTime, Duration, NaiveDateTime, Utc};

pub(crate) fn clamp_mastery(value: i64) -> i64 {
    if value < 0 {
        0
    } else if value > 3 {
        3
    } else {
        value
    }
}

pub(crate) fn clamp_forgetting_stage(value: i64) -> i64 {
    value.clamp(0, 6)
}

pub(crate) fn forgetting_strength_days(stage: i64) -> f64 {
    match clamp_forgetting_stage(stage) {
        0 => 0.5,
        1 => 1.0,
        2 => 2.0,
        3 => 4.0,
        4 => 7.0,
        5 => 15.0,
        _ => 30.0,
    }
}

pub(crate) fn parse_study_quality(raw: Option<&str>) -> &'static str {
    let text = raw.unwrap_or("").trim().to_ascii_lowercase();
    if matches!(
        text.as_str(),
        "poor" | "bad" | "weak" | "差" | "生疏" | "忘" | "不会"
    ) {
        "poor"
    } else if matches!(
        text.as_str(),
        "fair" | "ok" | "okay" | "medium" | "一般" | "还行" | "半对" | "有印象"
    ) {
        "fair"
    } else {
        "good"
    }
}

pub(crate) fn reviewed_at_for_quality(stage: i64, quality: &str, now: DateTime<Utc>) -> String {
    let target = match quality {
        "poor" => 0.4_f64,
        "fair" => 0.72_f64,
        _ => return now.to_rfc3339(),
    };
    let days = -target.ln() * forgetting_strength_days(stage).max(0.25);
    let millis = (days * 86_400_000.0).round() as i64;
    (now - Duration::milliseconds(millis)).to_rfc3339()
}

pub(crate) fn stage_base_mastery(stage: i64) -> i64 {
    match clamp_forgetting_stage(stage) {
        0 => 1,
        1 | 2 | 3 => 2,
        _ => 3,
    }
}

pub(crate) fn parse_reviewed_at(raw: &str) -> Option<DateTime<Utc>> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(text) {
        return Some(dt.with_timezone(&Utc));
    }
    NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|value| value.and_utc())
}

pub(crate) fn lapse_forgetting(mut stage: i64, mut days: f64) -> (i64, f64, f64) {
    stage = clamp_forgetting_stage(stage);
    let mut retention = 1.0;
    while stage > 0 && days > forgetting_strength_days(stage) {
        retention *= (-1.0_f64).exp();
        days -= forgetting_strength_days(stage);
        stage -= 1;
    }
    retention *= (-days / forgetting_strength_days(stage)).exp();
    (stage, days, retention)
}

pub(crate) fn days_since_reviewed(raw: Option<&str>) -> f64 {
    let Some(at) = raw.and_then(parse_reviewed_at) else {
        return 0.0;
    };
    let secs = (Utc::now() - at).num_seconds().max(0) as f64;
    secs / 86_400.0
}

pub(crate) fn days_between_reviewed(from: Option<&str>, to: &str) -> f64 {
    let Some(start) = from.and_then(parse_reviewed_at) else {
        return 0.0;
    };
    let end = parse_reviewed_at(to).unwrap_or_else(Utc::now);
    (end - start).num_seconds().max(0) as f64 / 86_400.0
}

pub(crate) fn next_forgetting_stage(
    prev_stage: i64,
    prev_reviewed: Option<&str>,
    remembered: bool,
    at: &str,
) -> i64 {
    let had_review = prev_reviewed
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if !had_review && clamp_forgetting_stage(prev_stage) <= 0 {
        return 0;
    }
    let days = days_between_reviewed(prev_reviewed, at);
    let (stage, _days, retention) = lapse_forgetting(prev_stage, days);
    if !remembered {
        return (stage - 1).max(0);
    }
    let too_soon = days < forgetting_strength_days(prev_stage) * 0.35 && days < 0.75;
    if too_soon && retention >= 0.85 {
        return stage;
    }
    if retention >= 0.3 {
        return (stage + 1).min(6);
    }
    (stage - 1).max(0)
}

pub(crate) fn effective_mastery(stored: i64, stage: i64, last_reviewed: Option<&str>) -> i64 {
    let reviewed = last_reviewed.map(str::trim).filter(|value| !value.is_empty());
    if stored == 0 && clamp_forgetting_stage(stage) == 0 && reviewed.is_none() {
        return 0;
    }
    let (lapsed_stage, _days, retention) =
        lapse_forgetting(stage, days_since_reviewed(reviewed));
    let base = stage_base_mastery(lapsed_stage);
    if retention >= 0.7 {
        base
    } else if retention >= 0.4 {
        base.min(2).max(1)
    } else {
        1
    }
}

pub(crate) fn mastery_for_stage(stage: i64, last_reviewed: Option<&str>) -> i64 {
    effective_mastery(1, stage, last_reviewed)
}
