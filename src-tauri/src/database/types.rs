use serde::{Deserialize, Serialize};
use rusqlite::Row;

#[derive(Debug, Serialize, Deserialize)]
pub struct AIResponse {
    pub id: i64,
    pub question: String,
    pub options: Option<String>,
    pub answer: Option<String>,
    pub question_type: Option<String>,
    pub folder_id: i64,
    pub folder_name: Option<String>,
    pub create_time: Option<String>,
    pub is_ai: bool,
    pub is_pending_correction: bool,
    pub importance: i64,
    pub mastery: i64,
    pub difficulty: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PracticeRecord {
    pub id: i64,
    pub question_id: i64,
    pub user_answer: String,
    pub is_correct: bool,
    pub note: String,
    pub source: String,
    pub create_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PracticeSummary {
    pub question_id: i64,
    pub count: i64,
    pub last_answer: String,
    pub last_correct: bool,
    pub last_note: String,
    pub last_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PracticeMarks {
    pub question_id: i64,
    pub results: Vec<bool>,
}

pub(crate) fn map_ai_response_row(row: &Row<'_>) -> rusqlite::Result<AIResponse> {
    Ok(AIResponse {
        id: row.get(0)?,
        question: row.get(1)?,
        options: row.get(2)?,
        answer: row.get(3)?,
        question_type: row.get(4)?,
        folder_id: row.get(5)?,
        folder_name: row.get(6)?,
        create_time: row.get(7)?,
        is_ai: row.get(8)?,
        is_pending_correction: row.get(9)?,
        importance: row.get(10).unwrap_or(0),
        mastery: row.get(11).unwrap_or(0),
        difficulty: row.get(12).unwrap_or(0),
    })
}

pub(crate) fn map_practice_row(row: &Row<'_>) -> rusqlite::Result<PracticeRecord> {
    Ok(PracticeRecord {
        id: row.get(0)?,
        question_id: row.get(1)?,
        user_answer: row.get(2)?,
        is_correct: row.get::<_, i64>(3)? != 0,
        note: row.get(4)?,
        source: row.get(5)?,
        create_time: row.get(6)?,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub parent_id: i64,
    pub create_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderStat {
    pub folder_id: i64,
    pub folder_name: String,
    pub question_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuestionMetricBucket {
    pub importance: i64,
    pub mastery: i64,
    pub difficulty: i64,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderPathItem {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedAIResponses {
    pub items: Vec<AIResponse>,
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudySubject {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub create_time: Option<String>,
    pub node_count: i64,
    pub progress: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyGraphNodeRow {
    pub id: i64,
    pub subject_id: i64,
    pub node_key: String,
    pub name: String,
    pub summary: String,
    pub mastery: i64,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    #[serde(default)]
    pub forgetting_stage: i64,
    #[serde(default)]
    pub last_reviewed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyGraphEdgeRow {
    pub id: i64,
    pub subject_id: i64,
    pub from_id: i64,
    pub to_id: i64,
    pub relation: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyGraphPayload {
    pub subject: StudySubject,
    pub nodes: Vec<StudyGraphNodeRow>,
    pub edges: Vec<StudyGraphEdgeRow>,
}

#[derive(Debug, Deserialize)]
pub struct StudyGraphNodeInput {
    pub key: Option<String>,
    pub name: String,
    pub summary: Option<String>,
    #[serde(default, alias = "parentKey")]
    pub parent_key: Option<String>,
    #[serde(default)]
    pub mastery: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StudyGraphEdgeInput {
    pub from_key: String,
    pub to_key: String,
    pub relation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StudyGraphNodePatch {
    pub id: i64,
    pub name: Option<String>,
    pub summary: Option<String>,
    pub mastery: Option<i64>,
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub forgetting_stage: Option<i64>,
    #[serde(default)]
    pub last_reviewed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuestionKnowledgeLink {
    pub question_id: i64,
    pub node_id: i64,
    pub node_name: String,
    pub subject_id: i64,
    pub subject_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyActivity {
    pub id: i64,
    pub subject_id: i64,
    pub kind: String,
    pub names: Vec<String>,
    pub question_count: i64,
    pub correct_count: i64,
    pub create_time: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyTimelineSummary {
    pub id: i64,
    pub subject_id: i64,
    pub text: String,
    pub start_time: String,
    pub end_time: String,
    pub covered_through_id: i64,
    pub activity_count: i64,
    pub create_time: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StudyHeatmapPoint {
    pub names: Vec<String>,
    pub create_time: String,
}

#[derive(Debug, Deserialize)]
pub struct SplitSubjectPart {
    pub name: String,
    pub description: Option<String>,
    pub node_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub struct SplitSubjectResult {
    pub original: StudySubject,
    pub created: Vec<StudySubject>,
}

#[derive(Debug, Deserialize)]
pub struct StudyProgressUpdate {
    pub id: Option<i64>,
    pub name: Option<String>,
    #[serde(default)]
    pub forgetting_stage: Option<i64>,
    #[serde(default)]
    pub last_reviewed_at: Option<String>,
    #[serde(default)]
    pub mastery: Option<i64>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub remembered: Option<bool>,
    #[serde(default)]
    pub days_ago: Option<f64>,
}
