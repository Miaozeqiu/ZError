use super::query_match::{
    compact_query_spacing, normalize_search_text, search_character_pairs, QueryMatchText,
};
use rusqlite::{functions::FunctionFlags, Connection, OptionalExtension, Result};
use std::collections::HashSet;

pub(super) fn register_functions(conn: &Connection) -> Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8
        | FunctionFlags::SQLITE_DETERMINISTIC
        | FunctionFlags::SQLITE_INNOCUOUS;
    conn.create_scalar_function("ze_search_text", 1, flags, |ctx| {
        Ok(compact_query_spacing(&normalize_search_text(
            ctx.get_raw(0).as_str()?,
        )))
    })?;
    conn.create_scalar_function("ze_match_title", 1, flags, |ctx| {
        Ok(QueryMatchText::new(ctx.get_raw(0).as_str()?).compact)
    })?;
    conn.create_scalar_function("ze_title_grams", 1, flags, |ctx| {
        Ok(title_grams(ctx.get_raw(0).as_str()?).join(" "))
    })
}

fn title_grams(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    search_character_pairs(text)
        .filter(|&pair| seen.insert(pair))
        .map(|(a, b)| format!("g{:x}x{:x}", a as u32, b as u32))
        .collect()
}

pub(super) fn init_index(conn: &Connection) -> Result<()> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE name = 'QuestionSearchText'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS QuestionSearchText (
            Id INTEGER PRIMARY KEY,
            MatchTitle TEXT NOT NULL,
            Title TEXT NOT NULL,
            Options TEXT NOT NULL,
            Answer TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_question_match_title ON QuestionSearchText(MatchTitle);
         CREATE VIRTUAL TABLE IF NOT EXISTS QuestionSearchGrams USING fts5(Grams);
         CREATE TRIGGER IF NOT EXISTS question_search_insert AFTER INSERT ON AIResponses BEGIN
            INSERT INTO QuestionSearchText VALUES (
                new.Id, ze_match_title(new.Question), ze_search_text(new.Question),
                ze_search_text(COALESCE(new.Options, '')), ze_search_text(new.Answer)
            );
            INSERT INTO QuestionSearchGrams(rowid, Grams)
                SELECT Id, ze_title_grams(MatchTitle) FROM QuestionSearchText WHERE Id = new.Id;
         END;
         CREATE TRIGGER IF NOT EXISTS question_search_delete AFTER DELETE ON AIResponses BEGIN
            DELETE FROM QuestionSearchText WHERE Id = old.Id;
            DELETE FROM QuestionSearchGrams WHERE rowid = old.Id;
         END;
         CREATE TRIGGER IF NOT EXISTS question_search_update AFTER UPDATE OF Question, Options, Answer ON AIResponses
         WHEN old.Question IS NOT new.Question OR old.Options IS NOT new.Options OR old.Answer IS NOT new.Answer
         BEGIN
            UPDATE QuestionSearchText SET MatchTitle = ze_match_title(new.Question),
                Title = ze_search_text(new.Question), Options = ze_search_text(COALESCE(new.Options, '')),
                Answer = ze_search_text(new.Answer) WHERE Id = new.Id;
            DELETE FROM QuestionSearchGrams WHERE rowid = new.Id;
            INSERT INTO QuestionSearchGrams(rowid, Grams)
                SELECT Id, ze_title_grams(MatchTitle) FROM QuestionSearchText WHERE Id = new.Id;
         END;",
    )?;
    tx.execute_batch(
        "INSERT OR IGNORE INTO QuestionSearchText
            SELECT Id, ze_match_title(Question), ze_search_text(Question),
                   ze_search_text(COALESCE(Options, '')), ze_search_text(Answer)
            FROM AIResponses;
         INSERT OR REPLACE INTO QuestionSearchGrams(rowid, Grams)
            SELECT Id, ze_title_grams(MatchTitle) FROM QuestionSearchText;",
    )?;
    tx.commit()
}

#[derive(Default)]
pub(super) struct CandidateQuery {
    pub filter: &'static str,
    pub params: Vec<String>,
}

pub(super) fn candidate_query(conn: &Connection, title: &str) -> Result<CandidateQuery> {
    // Keep exhaustive results for small banks and very short queries.
    let large_bank = conn
        .query_row(
            "SELECT Id FROM QuestionSearchText LIMIT 1 OFFSET 200",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let grams = title_grams(title);
    if !large_bank || grams.is_empty() {
        return Ok(CandidateQuery::default());
    }

    // Exact titles always qualify. Rank the other titles by shared character pairs.
    let stride = grams.len().div_ceil(64);
    let expression = grams
        .iter()
        .step_by(stride)
        .cloned()
        .collect::<Vec<_>>()
        .join(" OR ");
    Ok(CandidateQuery {
        filter: "WHERE Id IN (
            SELECT Id FROM QuestionSearchText WHERE MatchTitle = ?1
            UNION
            SELECT rowid FROM (
                SELECT rowid FROM QuestionSearchGrams
                WHERE QuestionSearchGrams MATCH ?2 ORDER BY rank, rowid LIMIT 160
            )
        )",
        params: vec![title.to_owned(), expression],
    })
}

use super::conn::get_conn;
use super::query_match::extract_query_keywords;
use super::types::{map_ai_response_row, AIResponse, PaginatedAIResponses};
use rusqlite::params_from_iter;
use rusqlite::types::Value;

fn search_questions(
    conn: &Connection,
    keyword: &str,
    folder: Option<i64>,
    pending_only: bool,
    page: Option<(i64, i64)>,
    oldest_first: bool,
) -> Result<PaginatedAIResponses> {
    let normalized = normalize_search_text(keyword);
    let compact = compact_query_spacing(&normalized);
    let mut params = vec![Value::Text(compact)];
    let mut term_conditions = Vec::new();
    let mut title_conditions = Vec::new();
    let mut terms: Vec<_> = extract_query_keywords(&normalized).into_iter().collect();
    terms.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    if terms.is_empty() {
        terms.extend(normalized.split_whitespace().map(str::to_owned));
    }
    for term in terms.into_iter().take(32) {
        params.push(Value::Text(term));
        let index = params.len();
        title_conditions.push(format!("instr(s.Title, ?{index}) > 0"));
        term_conditions.push(format!(
            "(instr(s.Title, ?{index}) > 0 OR instr(s.Options, ?{index}) > 0 OR instr(s.Answer, ?{index}) > 0)"
        ));
    }
    let matches_terms = if term_conditions.is_empty() {
        "0".to_owned()
    } else {
        term_conditions.join(" AND ")
    };
    let title_matches = if title_conditions.is_empty() {
        "0".to_owned()
    } else {
        title_conditions.join(" AND ")
    };

    let mut cte = String::new();
    let scope = if pending_only {
        "COALESCE(ar.IsPendingCorrection, 0) = 1".to_owned()
    } else {
        match folder {
            Some(0) => "ar.FolderId = 0".to_owned(),
            Some(folder) => {
                params.push(Value::Integer(folder));
                cte = format!(
                    "WITH RECURSIVE folder_tree(Id) AS (
                    SELECT Id FROM Folders WHERE Id = ?{}
                    UNION SELECT f.Id FROM Folders f JOIN folder_tree t ON f.ParentId = t.Id
                )",
                    params.len()
                );
                "ar.FolderId IN (SELECT Id FROM folder_tree)".to_owned()
            }
            None => "1".to_owned(),
        }
    };
    let from = format!(
        "FROM QuestionSearchText s JOIN AIResponses ar ON ar.Id = s.Id
        WHERE ({scope}) AND (?1 = '' OR instr(s.Title, ?1) > 0 OR instr(s.Options, ?1) > 0
            OR instr(s.Answer, ?1) > 0 OR ({matches_terms}))"
    );
    let tx = conn.unchecked_transaction()?;
    let total = if page.is_some() {
        tx.query_row(
            &format!("{cte} SELECT count(*) {from}"),
            params_from_iter(&params),
            |row| row.get(0),
        )?
    } else {
        0
    };
    let select = format!(
        "{cte} SELECT ar.Id, ar.Question, ar.Options, ar.Answer, ar.QuestionType, ar.FolderId,
          (SELECT f.Name FROM Folders f WHERE f.Id = ar.FolderId), ar.CreateTime, ar.IsAi,
          COALESCE(ar.IsPendingCorrection, 0), COALESCE(ar.Importance, 0),
          COALESCE(ar.Mastery, 0), COALESCE(ar.Difficulty, 0)
          {from} ORDER BY CASE WHEN s.Title = ?1 THEN 0 WHEN instr(s.Title, ?1) > 0 THEN 1
            WHEN ({title_matches}) THEN 2 ELSE 3 END, ar.CreateTime {}, ar.Id DESC",
        if oldest_first { "ASC" } else { "DESC" },
    );
    let sql = if let Some((page, size)) = page {
        let size = size.clamp(1, 200);
        let offset = (page.max(1) - 1).saturating_mul(size);
        params.extend([Value::Integer(size), Value::Integer(offset)]);
        format!("{select} LIMIT ? OFFSET ?")
    } else {
        select
    };
    let items = {
        let mut stmt = tx.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(&params), map_ai_response_row)?;
        rows.collect::<Result<Vec<_>>>()?
    };
    tx.commit()?;
    Ok(PaginatedAIResponses {
        total: if page.is_some() {
            total
        } else {
            items.len() as i64
        },
        items,
    })
}

#[tauri::command]
pub async fn search_questions_fuzzy(
    keyword: String,
    folder_id: Option<i64>,
    pending_correction_only: Option<bool>,
) -> std::result::Result<Vec<AIResponse>, String> {
    tokio::task::spawn_blocking(move || {
        search_questions(
            &get_conn()?,
            &keyword,
            folder_id,
            pending_correction_only.unwrap_or(false),
            None,
            false,
        )
        .map(|page| page.items)
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn search_questions_page(
    keyword: String,
    folder_id: Option<i64>,
    pending_correction_only: bool,
    page: i64,
    page_size: i64,
    sort_order: Option<String>,
) -> std::result::Result<PaginatedAIResponses, String> {
    tokio::task::spawn_blocking(move || {
        search_questions(
            &get_conn()?,
            &keyword,
            folder_id,
            pending_correction_only,
            Some((page, page_size)),
            sort_order.as_deref() == Some("asc"),
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_existing_rows_and_keeps_search_in_sync() {
        let conn = Connection::open_in_memory().unwrap();
        register_functions(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE Folders (Id INTEGER PRIMARY KEY, Name TEXT, ParentId INTEGER);
             INSERT INTO Folders VALUES (0, '默认', 0), (1, '父', 0), (2, '子', 1);
             CREATE TABLE AIResponses (
                 Id INTEGER PRIMARY KEY, Question TEXT NOT NULL, Options TEXT, Answer TEXT NOT NULL,
                 FolderId INTEGER, QuestionType TEXT, CreateTime TEXT, IsAi INTEGER, IsPendingCorrection INTEGER,
                 Importance INTEGER, Mastery INTEGER, Difficulty INTEGER
             );
             INSERT INTO AIResponses VALUES (1, '中 国画（ ）？', NULL, '甲', 2, NULL, '2025-01-01', 0, 1, 0, 0, 0);
             INSERT INTO AIResponses VALUES (2, '其他题', NULL, '中国画()?', 2, NULL, '2025-02-01', 0, 0, 0, 0, 0);",
        ).unwrap();
        init_index(&conn).unwrap();
        init_index(&conn).unwrap();

        let first =
            search_questions(&conn, "中国画()?", Some(1), false, Some((1, 1)), false).unwrap();
        assert_eq!(first.total, 2);
        assert_eq!(first.items[0].id, 1);
        let second =
            search_questions(&conn, "中国画()?", Some(1), false, Some((2, 1)), false).unwrap();
        assert_eq!(second.items[0].id, 2);
        assert_eq!(
            search_questions(&conn, "中国画()?", None, true, None, false)
                .unwrap()
                .total,
            1
        );

        conn.execute_batch(
            "UPDATE AIResponses SET Question = '替换题', Answer = '乙' WHERE Id = 1;
             DELETE FROM AIResponses WHERE Id = 2;
             WITH RECURSIVE ids(n) AS (VALUES(2) UNION ALL SELECT n+1 FROM ids WHERE n < 500)
             INSERT INTO AIResponses SELECT n, '干扰题' || n, NULL, '丙', 2, NULL, '', 0, 0, 0, 0, 0 FROM ids;"
        ).unwrap();
        assert_eq!(
            search_questions(&conn, "中国画()?", None, false, None, false)
                .unwrap()
                .total,
            0
        );
        let query = candidate_query(&conn, "替换题").unwrap();
        assert!(!query.filter.is_empty());
        let sql = format!("SELECT Id FROM AIResponses {}", query.filter);
        assert_eq!(
            conn.query_row(&sql, params_from_iter(query.params), |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
