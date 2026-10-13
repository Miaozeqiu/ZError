use crate::database::conn::get_conn;
use crate::database::forgetting::*;
use crate::database::types::*;
use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

pub fn map_study_subject_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StudySubject> {
    Ok(StudySubject {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        create_time: row.get(3)?,
        node_count: row.get(4)?,
        progress: 0.0,
    })
}

pub fn node_retention(mastery: i64, stage: i64, last_reviewed: Option<&str>) -> Option<f64> {
    let reviewed = last_reviewed.map(str::trim).filter(|value| !value.is_empty());
    if mastery == 0 && clamp_forgetting_stage(stage) == 0 && reviewed.is_none() {
        None
    } else {
        let (_lapsed_stage, _days, retention) =
            lapse_forgetting(stage, days_since_reviewed(reviewed));
        Some(retention)
    }
}

pub fn average_retention(scores: &[Option<f64>]) -> Option<f64> {
    if scores.is_empty() || scores.iter().all(|score| score.is_none()) {
        return None;
    }
    Some(scores.iter().map(|score| score.unwrap_or(0.0)).sum::<f64>() / scores.len() as f64)
}

pub fn rolled_node_retention(
    index: usize,
    items: &[(i64, i64, i64, Option<i64>, Option<String>)],
    children: &[Vec<usize>],
) -> Option<f64> {
    if children[index].is_empty() {
        return node_retention(items[index].1, items[index].2, items[index].4.as_deref());
    }
    let scores: Vec<Option<f64>> = children[index]
        .iter()
        .map(|child| rolled_node_retention(*child, items, children))
        .collect();
    average_retention(&scores)
}

pub fn load_subject_memory(
    conn: &Connection,
    subject_id: i64,
) -> Result<Vec<(i64, i64, i64, Option<i64>, Option<String>)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT Id, Mastery, COALESCE(ForgettingStage, 0), ParentId, LastReviewedAt
             FROM StudyGraphNodes WHERE SubjectId = ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1).unwrap_or(0),
                row.get::<_, i64>(2).unwrap_or(0),
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

pub fn progress_from_memory(items: &[(i64, i64, i64, Option<i64>, Option<String>)]) -> f64 {
    if items.is_empty() {
        return 0.0;
    }
    let id_to_index: HashMap<i64, usize> = items
        .iter()
        .enumerate()
        .map(|(index, item)| (item.0, index))
        .collect();
    let mut children = vec![Vec::new(); items.len()];
    let mut roots = Vec::new();
    for (index, item) in items.iter().enumerate() {
        match item.3.and_then(|parent| id_to_index.get(&parent).copied()) {
            Some(parent) if parent != index => children[parent].push(index),
            _ => roots.push(index),
        }
    }
    if roots.is_empty() {
        roots.extend(0..items.len());
    }
    let scores: Vec<Option<f64>> = roots
        .iter()
        .map(|index| rolled_node_retention(*index, items, &children))
        .collect();
    average_retention(&scores).unwrap_or(0.0).clamp(0.0, 1.0)
}

pub fn load_study_subject(conn: &Connection, subject_id: i64) -> Result<StudySubject, String> {
    let mut subject = conn
        .query_row(
            "SELECT s.Id, s.Name, s.Description, s.CreateTime,
                    COUNT(n.Id), 0
             FROM StudySubjects s
             LEFT JOIN StudyGraphNodes n ON n.SubjectId = s.Id
             WHERE s.Id = ?
             GROUP BY s.Id",
            [subject_id],
            map_study_subject_row,
        )
        .map_err(|_| "学习科目不存在".to_string())?;
    let memory = load_subject_memory(conn, subject_id)?;
    subject.node_count = memory.len() as i64;
    subject.progress = progress_from_memory(&memory);
    Ok(subject)
}

pub fn load_study_graph(conn: &Connection, subject_id: i64) -> Result<StudyGraphPayload, String> {
    let subject = load_study_subject(conn, subject_id)?;
    let mut node_stmt = conn
        .prepare(
            "SELECT Id, SubjectId, NodeKey, Name, Summary, Mastery, ParentId, SortOrder,
                    COALESCE(ForgettingStage, 0), LastReviewedAt
             FROM StudyGraphNodes WHERE SubjectId = ? ORDER BY SortOrder, Id",
        )
        .map_err(|e| format!("{}", e))?;
    let nodes = node_stmt
        .query_map([subject_id], |row| {
            let stored: i64 = row.get(5)?;
            let stage: i64 = row.get(8)?;
            let reviewed: Option<String> = row.get(9)?;
            Ok(StudyGraphNodeRow {
                id: row.get(0)?,
                subject_id: row.get(1)?,
                node_key: row.get(2)?,
                name: row.get(3)?,
                summary: row.get(4)?,
                mastery: effective_mastery(stored, stage, reviewed.as_deref()),
                parent_id: row.get(6)?,
                sort_order: row.get(7)?,
                forgetting_stage: clamp_forgetting_stage(stage),
                last_reviewed_at: reviewed,
            })
        })
        .map_err(|e| format!("{}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("{}", e))?;
    let mut edge_stmt = conn
        .prepare(
            "SELECT Id, SubjectId, FromId, ToId, Relation
             FROM StudyGraphEdges WHERE SubjectId = ? ORDER BY Id",
        )
        .map_err(|e| format!("{}", e))?;
    let edges = edge_stmt
        .query_map([subject_id], |row| {
            Ok(StudyGraphEdgeRow {
                id: row.get(0)?,
                subject_id: row.get(1)?,
                from_id: row.get(2)?,
                to_id: row.get(3)?,
                relation: row.get(4)?,
            })
        })
        .map_err(|e| format!("{}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("{}", e))?;
    Ok(StudyGraphPayload {
        subject,
        nodes,
        edges,
    })
}

#[tauri::command]
pub async fn list_study_subjects() -> Result<Vec<StudySubject>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT s.Id, s.Name, s.Description, s.CreateTime,
                    COUNT(n.Id), COALESCE(AVG(n.Mastery), 0)
             FROM StudySubjects s
             LEFT JOIN StudyGraphNodes n ON n.SubjectId = s.Id
             GROUP BY s.Id
             ORDER BY s.Id DESC",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([], map_study_subject_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        let mut item = row.map_err(|e| format!("{}", e))?;
        let memory = load_subject_memory(&conn, item.id)?;
        item.node_count = memory.len() as i64;
        item.progress = progress_from_memory(&memory);
        items.push(item);
    }
    Ok(items)
}

#[tauri::command]
pub async fn create_study_subject(name: String, description: Option<String>) -> Result<StudySubject, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("科目名称不能为空".to_string());
    }
    let description = description.unwrap_or_default();
    let conn = get_conn()?;
    conn.execute(
        "INSERT INTO StudySubjects (Name, Description, CreateTime) VALUES (?, ?, datetime('now'))",
        rusqlite::params![name, description],
    )
    .map_err(|e| format!("{}", e))?;
    let id = conn.last_insert_rowid();
    load_study_subject(&conn, id)
}

#[tauri::command]
pub async fn rename_study_subject(
    id: i64,
    name: Option<String>,
    description: Option<String>,
) -> Result<StudySubject, String> {
    let conn = get_conn()?;
    let current = load_study_subject(&conn, id)?;
    let next_name = name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(current.name);
    let next_description = description.unwrap_or(current.description);
    conn.execute(
        "UPDATE StudySubjects SET Name = ?, Description = ? WHERE Id = ?",
        rusqlite::params![next_name, next_description, id],
    )
    .map_err(|e| format!("{}", e))?;
    load_study_subject(&conn, id)
}

#[tauri::command]
pub async fn delete_study_subject(id: i64) -> Result<(), String> {
    let conn = get_conn()?;
    load_study_subject(&conn, id)?;
    conn.execute("DELETE FROM StudyGraphEdges WHERE SubjectId = ?", [id])
        .map_err(|e| format!("{}", e))?;
    delete_knowledge_links_for_subject(&conn, id)?;
    conn.execute("DELETE FROM StudyGraphNodes WHERE SubjectId = ?", [id])
        .map_err(|e| format!("{}", e))?;
    conn.execute("DELETE FROM StudyActivity WHERE SubjectId = ?", [id])
        .map_err(|e| format!("{}", e))?;
    conn.execute("DELETE FROM StudySubjects WHERE Id = ?", [id])
        .map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_study_graph(subject_id: i64) -> Result<StudyGraphPayload, String> {
    let conn = get_conn()?;
    load_study_graph(&conn, subject_id)
}

pub fn insert_study_nodes(
    conn: &Connection,
    subject_id: i64,
    nodes: &[StudyGraphNodeInput],
    start_order: i64,
    existing: &mut HashMap<String, i64>,
) -> Result<HashMap<String, i64>, String> {
    if nodes.len() > 60 {
        return Err("一次不要超过 60 个知识点".to_string());
    }
    let mut new_keys: HashMap<String, i64> = HashMap::new();
    let mut name_to_key: HashMap<String, String> = HashMap::new();
    let mut final_keys: Vec<String> = Vec::with_capacity(nodes.len());
    for (index, node) in nodes.iter().enumerate() {
        let name = node.name.trim().to_string();
        if name.is_empty() {
            final_keys.push(String::new());
            continue;
        }
        let base = node
            .key
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("n{}", start_order + index as i64 + 1));
        let mut key = base.clone();
        let mut suffix = 2;
        while existing.contains_key(&key) || new_keys.contains_key(&key) {
            key = format!("{}_{}", base, suffix);
            suffix += 1;
        }
        let mastery = clamp_mastery(node.mastery.unwrap_or(0));
        let summary = node.summary.clone().unwrap_or_default();
        conn.execute(
            "INSERT INTO StudyGraphNodes (SubjectId, NodeKey, Name, Summary, Mastery, ParentId, SortOrder, ForgettingStage, LastReviewedAt)
             VALUES (?, ?, ?, ?, ?, NULL, ?, 0, NULL)",
            rusqlite::params![subject_id, key, name, summary, mastery, start_order + index as i64],
        )
        .map_err(|e| format!("{}", e))?;
        let id = conn.last_insert_rowid();
        new_keys.insert(key.clone(), id);
        existing.insert(key.clone(), id);
        name_to_key.entry(name).or_insert_with(|| key.clone());
        final_keys.push(key);
    }
    for (index, node) in nodes.iter().enumerate() {
        let child_key = &final_keys[index];
        if child_key.is_empty() {
            continue;
        }
        let Some(parent_raw) = node
            .parent_key
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if parent_raw == *child_key {
            continue;
        }
        let parent_key = if existing.contains_key(&parent_raw) {
            parent_raw
        } else if let Some(mapped) = name_to_key.get(&parent_raw) {
            mapped.clone()
        } else {
            continue;
        };
        let Some(&child_id) = existing.get(child_key) else {
            continue;
        };
        let Some(&parent_id) = existing.get(&parent_key) else {
            continue;
        };
        conn.execute(
            "UPDATE StudyGraphNodes SET ParentId = ? WHERE Id = ?",
            rusqlite::params![parent_id, child_id],
        )
        .map_err(|e| format!("{}", e))?;
    }
    Ok(new_keys)
}

#[tauri::command]
pub async fn set_study_graph(
    subject_id: i64,
    nodes: Vec<StudyGraphNodeInput>,
    edges: Option<Vec<StudyGraphEdgeInput>>,
) -> Result<StudyGraphPayload, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    conn.execute("DELETE FROM StudyGraphEdges WHERE SubjectId = ?", [subject_id])
        .map_err(|e| format!("{}", e))?;
    delete_knowledge_links_for_subject(&conn, subject_id)?;
    conn.execute("DELETE FROM StudyGraphNodes WHERE SubjectId = ?", [subject_id])
        .map_err(|e| format!("{}", e))?;
    let key_to_id = insert_study_nodes(&conn, subject_id, &nodes, 0, &mut HashMap::new())?;
    if let Some(edges) = edges {
        for edge in edges {
            let from_id = *key_to_id
                .get(edge.from_key.trim())
                .ok_or_else(|| format!("边的起点「{}」不存在", edge.from_key))?;
            let to_id = *key_to_id
                .get(edge.to_key.trim())
                .ok_or_else(|| format!("边的终点「{}」不存在", edge.to_key))?;
            if from_id == to_id {
                continue;
            }
            let relation = edge.relation.unwrap_or_default();
            conn.execute(
                "INSERT INTO StudyGraphEdges (SubjectId, FromId, ToId, Relation) VALUES (?, ?, ?, ?)",
                rusqlite::params![subject_id, from_id, to_id, relation],
            )
            .map_err(|e| format!("{}", e))?;
        }
    }
    load_study_graph(&conn, subject_id)
}

#[tauri::command]
pub async fn patch_study_graph(
    subject_id: i64,
    add: Option<Vec<StudyGraphNodeInput>>,
    update: Option<Vec<StudyGraphNodePatch>>,
    remove_ids: Option<Vec<i64>>,
) -> Result<StudyGraphPayload, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    if let Some(ids) = remove_ids {
        for id in ids {
            conn.execute(
                "DELETE FROM StudyGraphEdges WHERE SubjectId = ? AND (FromId = ? OR ToId = ?)",
                rusqlite::params![subject_id, id, id],
            )
            .map_err(|e| format!("{}", e))?;
            conn.execute(
                "UPDATE StudyGraphNodes SET ParentId = NULL WHERE SubjectId = ? AND ParentId = ?",
                rusqlite::params![subject_id, id],
            )
            .map_err(|e| format!("{}", e))?;
            conn.execute(
                "DELETE FROM QuestionKnowledgeNodes WHERE NodeId = ?",
                [id],
            )
            .map_err(|e| format!("{}", e))?;
            conn.execute(
                "DELETE FROM StudyGraphNodes WHERE SubjectId = ? AND Id = ?",
                rusqlite::params![subject_id, id],
            )
            .map_err(|e| format!("{}", e))?;
        }
    }
    if let Some(items) = update {
        for item in items {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(1) FROM StudyGraphNodes WHERE Id = ? AND SubjectId = ?",
                    rusqlite::params![item.id, subject_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("{}", e))?;
            if exists == 0 {
                return Err(format!("知识点 {} 不在该科目中", item.id));
            }
            if let Some(name) = item.name {
                let name = name.trim().to_string();
                if name.is_empty() {
                    return Err("知识点名称不能为空".to_string());
                }
                conn.execute(
                    "UPDATE StudyGraphNodes SET Name = ? WHERE Id = ?",
                    rusqlite::params![name, item.id],
                )
                .map_err(|e| format!("{}", e))?;
            }
            if let Some(summary) = item.summary {
                conn.execute(
                    "UPDATE StudyGraphNodes SET Summary = ? WHERE Id = ?",
                    rusqlite::params![summary, item.id],
                )
                .map_err(|e| format!("{}", e))?;
            }
            if let Some(mastery) = item.mastery {
                conn.execute(
                    "UPDATE StudyGraphNodes SET Mastery = ? WHERE Id = ?",
                    rusqlite::params![clamp_mastery(mastery), item.id],
                )
                .map_err(|e| format!("{}", e))?;
            }
            if let Some(stage) = item.forgetting_stage {
                conn.execute(
                    "UPDATE StudyGraphNodes SET ForgettingStage = ? WHERE Id = ?",
                    rusqlite::params![clamp_forgetting_stage(stage), item.id],
                )
                .map_err(|e| format!("{}", e))?;
            }
            if let Some(reviewed) = item.last_reviewed_at {
                let reviewed = reviewed.trim().to_string();
                if reviewed.is_empty() {
                    conn.execute(
                        "UPDATE StudyGraphNodes SET LastReviewedAt = NULL WHERE Id = ?",
                        [item.id],
                    )
                    .map_err(|e| format!("{}", e))?;
                } else {
                    conn.execute(
                        "UPDATE StudyGraphNodes SET LastReviewedAt = ? WHERE Id = ?",
                        rusqlite::params![reviewed, item.id],
                    )
                    .map_err(|e| format!("{}", e))?;
                }
            }
            if let Some(parent_id) = item.parent_id {
                if parent_id == item.id {
                    return Err("知识点不能作为自己的父节点".to_string());
                }
                if parent_id > 0 {
                    let parent_ok: i64 = conn
                        .query_row(
                            "SELECT COUNT(1) FROM StudyGraphNodes WHERE Id = ? AND SubjectId = ?",
                            rusqlite::params![parent_id, subject_id],
                            |row| row.get(0),
                        )
                        .map_err(|e| format!("{}", e))?;
                    if parent_ok == 0 {
                        return Err(format!("父节点 {} 不在该科目中", parent_id));
                    }
                    conn.execute(
                        "UPDATE StudyGraphNodes SET ParentId = ? WHERE Id = ?",
                        rusqlite::params![parent_id, item.id],
                    )
                    .map_err(|e| format!("{}", e))?;
                } else {
                    conn.execute(
                        "UPDATE StudyGraphNodes SET ParentId = NULL WHERE Id = ?",
                        [item.id],
                    )
                    .map_err(|e| format!("{}", e))?;
                }
            }
        }
    }
    if let Some(items) = add {
        if !items.is_empty() {
            let max_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(SortOrder), -1) FROM StudyGraphNodes WHERE SubjectId = ?",
                    [subject_id],
                    |row| row.get(0),
                )
                .unwrap_or(-1);
            let mut existing: HashMap<String, i64> = HashMap::new();
            let mut key_stmt = conn
                .prepare("SELECT NodeKey, Name, Id FROM StudyGraphNodes WHERE SubjectId = ?")
                .map_err(|e| format!("{}", e))?;
            let rows = key_stmt
                .query_map([subject_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })
                .map_err(|e| format!("{}", e))?;
            for row in rows {
                let (key, name, id) = row.map_err(|e| format!("{}", e))?;
                existing.insert(key, id);
                let name = name.trim().to_string();
                if !name.is_empty() {
                    existing.entry(name).or_insert(id);
                }
            }
            insert_study_nodes(&conn, subject_id, &items, max_order + 1, &mut existing)?;
        }
    }
    load_study_graph(&conn, subject_id)
}

pub fn resolve_progress_node_id(
    conn: &Connection,
    subject_id: i64,
    update: &StudyProgressUpdate,
) -> Result<i64, String> {
    if let Some(id) = update.id.filter(|value| *value > 0) {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM StudyGraphNodes WHERE Id = ? AND SubjectId = ?",
                rusqlite::params![id, subject_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("{}", e))?;
        if exists == 0 {
            return Err(format!("知识点 {} 不在该科目中", id));
        }
        return Ok(id);
    }
    let name = update
        .name
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请提供 node_id 或 node_name".to_string())?;
    let mut stmt = conn
        .prepare("SELECT Id, Name FROM StudyGraphNodes WHERE SubjectId = ?")
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("{}", e))?;
    let mut exact = Vec::new();
    let mut fuzzy = Vec::new();
    for row in rows {
        let (id, node_name) = row.map_err(|e| format!("{}", e))?;
        if node_name == name {
            exact.push(id);
        } else if node_name.contains(&name) || name.contains(&node_name) {
            fuzzy.push(id);
        }
    }
    if exact.len() == 1 {
        return Ok(exact[0]);
    }
    if exact.len() > 1 {
        return Err(format!("有多个同名知识点「{}」", name));
    }
    if fuzzy.len() == 1 && name.chars().count() >= 4 {
        return Ok(fuzzy[0]);
    }
    if fuzzy.len() > 1 {
        return Err(format!("有多个知识点名称包含「{}」", name));
    }
    Err(format!("找不到知识点「{}」", name))
}

#[tauri::command]
pub async fn apply_study_progress(
    subject_id: i64,
    updates: Vec<StudyProgressUpdate>,
) -> Result<StudyGraphPayload, String> {
    if updates.is_empty() {
        return Err("没有要写入的掌握度".to_string());
    }
    if updates.len() > 24 {
        return Err("一次不要超过 24 个知识点".to_string());
    }
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let mut learned = Vec::new();
    let mut reviewed = Vec::new();
    for item in updates {
        let id = resolve_progress_node_id(&conn, subject_id, &item)?;
        let (prev_stage, prev_reviewed, name): (i64, Option<String>, String) = conn
            .query_row(
                "SELECT COALESCE(ForgettingStage, 0), LastReviewedAt, Name FROM StudyGraphNodes WHERE Id = ?",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or((0, None, String::new()));
        let now = Utc::now();
        let quality = parse_study_quality(item.quality.as_deref());
        let had_review = prev_reviewed
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some();
        let remembered = item.remembered.unwrap_or_else(|| {
            if item.quality.as_deref().map(str::trim).filter(|v| !v.is_empty()).is_some() {
                quality != "poor"
            } else {
                item.forgetting_stage
                    .map(|value| clamp_forgetting_stage(value) >= prev_stage)
                    .unwrap_or(true)
            }
        });
        let stage = next_forgetting_stage(
            prev_stage,
            prev_reviewed.as_deref(),
            remembered,
            &now.to_rfc3339(),
        );
        let historical = item.days_ago.filter(|days| *days > 0.05);
        let reviewed_at = item
            .last_reviewed_at
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                if item.quality.is_none() {
                    historical.map(|days| {
                        (now - Duration::milliseconds((days * 86_400_000.0).round() as i64))
                            .to_rfc3339()
                    })
                } else {
                    None
                }
            })
            .unwrap_or_else(|| reviewed_at_for_quality(stage, quality, now));
        let child_count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM StudyGraphNodes WHERE ParentId = ?",
                [id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if child_count > 0 {
            continue;
        }
        let mastery = item
            .mastery
            .map(clamp_mastery)
            .unwrap_or_else(|| mastery_for_stage(stage, Some(reviewed_at.as_str())));
        conn.execute(
            "UPDATE StudyGraphNodes
             SET Mastery = ?, ForgettingStage = ?, LastReviewedAt = ?
             WHERE Id = ?",
            rusqlite::params![mastery, stage, reviewed_at, id],
        )
        .map_err(|e| format!("{}", e))?;
        if name.is_empty() {
            continue;
        }
        let kind = item
            .kind
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .to_ascii_lowercase();
        if kind == "learn" || (!had_review && prev_stage <= 0) {
            learned.push(name);
        } else {
            reviewed.push(name);
        }
    }
    let learned = collapse_activity_names_to_parents(&conn, subject_id, &learned)?;
    let reviewed = collapse_activity_names_to_parents(&conn, subject_id, &reviewed)?;
    insert_study_activity(&conn, subject_id, "learn", &learned, 0, 0, None)?;
    insert_study_activity(&conn, subject_id, "review", &reviewed, 0, 0, None)?;
    load_study_graph(&conn, subject_id)
}

pub fn collapse_activity_names_to_parents(
    conn: &Connection,
    subject_id: i64,
    names: &[String],
) -> Result<Vec<String>, String> {
    if names.len() < 2 {
        return Ok(names.to_vec());
    }
    let mut stmt = conn
        .prepare("SELECT Id, Name, ParentId FROM StudyGraphNodes WHERE SubjectId = ?")
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    let mut name_of = HashMap::new();
    let mut children: HashMap<i64, Vec<String>> = HashMap::new();
    for row in rows {
        let (id, name, parent_id) = row.map_err(|e| format!("{}", e))?;
        let name = name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        name_of.insert(id, name.clone());
        if let Some(parent_id) = parent_id {
            children.entry(parent_id).or_default().push(name);
        }
    }
    let mut current: HashSet<String> = names
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    let mut changed = true;
    while changed {
        changed = false;
        for (parent_id, kids) in &children {
            let parent_name = match name_of.get(parent_id) {
                Some(name) if !name.is_empty() => name,
                _ => continue,
            };
            if kids.is_empty() || kids.iter().any(|kid| kid == parent_name) {
                continue;
            }
            if !kids.iter().all(|kid| current.contains(kid)) {
                continue;
            }
            for kid in kids {
                current.remove(kid);
            }
            current.insert(parent_name.clone());
            changed = true;
        }
    }
    let mut ordered = Vec::new();
    for item in names {
        let name = item.trim();
        if current.remove(name) {
            ordered.push(name.to_string());
        }
    }
    ordered.extend(current);
    Ok(ordered)
}

pub fn insert_study_activity(
    conn: &Connection,
    subject_id: i64,
    kind: &str,
    names: &[String],
    question_count: i64,
    correct_count: i64,
    create_time: Option<&str>,
) -> Result<(), String> {
    if kind != "practice" && names.is_empty() {
        return Ok(());
    }
    let payload = serde_json::to_string(names).unwrap_or_else(|_| "[]".to_string());
    let time = create_time
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    conn.execute(
        "INSERT INTO StudyActivity (SubjectId, Kind, Names, QuestionCount, CorrectCount, CreateTime)
         VALUES (?, ?, ?, ?, ?, ?)",
        rusqlite::params![subject_id, kind, payload, question_count, correct_count, time],
    )
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

pub fn record_practice_activity(conn: &Connection, question_id: i64, is_correct: bool) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT n.SubjectId, n.Name
             FROM QuestionKnowledgeNodes qkn
             JOIN StudyGraphNodes n ON n.Id = qkn.NodeId
             WHERE qkn.QuestionId = ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([question_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("{}", e))?;
    let mut by_subject: HashMap<i64, Vec<String>> = HashMap::new();
    for row in rows {
        let (subject_id, name) = row.map_err(|e| format!("{}", e))?;
        if !name.trim().is_empty() {
            by_subject.entry(subject_id).or_default().push(name);
        } else {
            by_subject.entry(subject_id).or_default();
        }
    }
    for (subject_id, names) in by_subject {
        insert_study_activity(
            conn,
            subject_id,
            "practice",
            &names,
            1,
            if is_correct { 1 } else { 0 },
            None,
        )?;
    }
    Ok(())
}

pub fn parse_activity_names(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_else(|_| {
        raw.split('、')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect()
    })
}

pub fn map_activity_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StudyActivity> {
    let raw: String = row.get(3)?;
    Ok(StudyActivity {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        kind: row.get(2)?,
        names: parse_activity_names(&raw),
        question_count: row.get(4)?,
        correct_count: row.get(5)?,
        create_time: row.get(6)?,
    })
}

pub fn backfill_study_activity(conn: &Connection, subject_id: i64) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM StudyActivity WHERE SubjectId = ?",
            [subject_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if count > 0 {
        return Ok(());
    }
    let mut nodes = conn
        .prepare(
            "SELECT Name, COALESCE(ForgettingStage, 0), LastReviewedAt
             FROM StudyGraphNodes
             WHERE SubjectId = ? AND LastReviewedAt IS NOT NULL AND TRIM(LastReviewedAt) != ''
             AND Id NOT IN (SELECT ParentId FROM StudyGraphNodes WHERE SubjectId = ? AND ParentId IS NOT NULL)",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = nodes
        .query_map(rusqlite::params![subject_id, subject_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    for row in rows {
        let (name, stage, reviewed) = row.map_err(|e| format!("{}", e))?;
        let kind = if stage <= 1 { "learn" } else { "review" };
        insert_study_activity(conn, subject_id, kind, &[name], 0, 0, Some(reviewed.as_str()))?;
    }
    let mut practice = conn
        .prepare(
            "SELECT p.IsCorrect, p.CreateTime, n.Name
             FROM QuestionPracticeHistory p
             JOIN QuestionKnowledgeNodes qkn ON qkn.QuestionId = p.QuestionId
             JOIN StudyGraphNodes n ON n.Id = qkn.NodeId
             WHERE n.SubjectId = ?
             ORDER BY p.Id",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = practice
        .query_map([subject_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    for row in rows {
        let (correct, time, name) = row.map_err(|e| format!("{}", e))?;
        insert_study_activity(
            conn,
            subject_id,
            "practice",
            &[name],
            1,
            if correct != 0 { 1 } else { 0 },
            Some(time.as_str()),
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_study_activity(subject_id: i64, limit: Option<i64>) -> Result<Vec<StudyActivity>, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    backfill_study_activity(&conn, subject_id)?;
    let cap = limit.unwrap_or(80).clamp(1, 5000);
    let mut stmt = conn
        .prepare(
            "SELECT Id, SubjectId, Kind, Names, QuestionCount, CorrectCount, CreateTime
             FROM StudyActivity
             WHERE SubjectId = ?
             ORDER BY datetime(CreateTime) DESC, Id DESC
             LIMIT ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![subject_id, cap], map_activity_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

pub fn activity_time_ms(raw: &str) -> Option<i64> {
    parse_reviewed_at(raw).map(|value| value.timestamp_millis())
}

#[tauri::command]
pub async fn list_study_activity_between(
    subject_id: i64,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<StudyActivity>, String> {
    if start_ms >= end_ms {
        return Ok(Vec::new());
    }
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let pad_start = start_ms.saturating_sub(86_400_000);
    let pad_end = end_ms.saturating_add(86_400_000);
    let from = DateTime::from_timestamp_millis(pad_start)
        .unwrap_or_else(Utc::now)
        .format("%Y-%m-%d")
        .to_string();
    let to = DateTime::from_timestamp_millis(pad_end)
        .unwrap_or_else(Utc::now)
        .format("%Y-%m-%d")
        .to_string();
    let mut stmt = conn
        .prepare(
            "SELECT Id, SubjectId, Kind, Names, QuestionCount, CorrectCount, CreateTime
             FROM StudyActivity
             WHERE SubjectId = ?
               AND substr(CreateTime, 1, 10) >= ?
               AND substr(CreateTime, 1, 10) <= ?
             ORDER BY datetime(CreateTime) DESC, Id DESC",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![subject_id, from, to], map_activity_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        let item = row.map_err(|e| format!("{}", e))?;
        let Some(ms) = activity_time_ms(&item.create_time) else {
            continue;
        };
        if ms >= start_ms && ms < end_ms {
            items.push(item);
        }
    }
    Ok(items)
}

#[tauri::command]
pub async fn list_study_heatmap(subject_id: i64) -> Result<Vec<StudyHeatmapPoint>, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    backfill_study_activity(&conn, subject_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT Names, CreateTime
             FROM StudyActivity
             WHERE SubjectId = ?
               AND Kind IN ('learn', 'review')
             ORDER BY datetime(CreateTime) DESC
             LIMIT 8000",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            let raw: String = row.get(0)?;
            Ok(StudyHeatmapPoint {
                names: parse_activity_names(&raw),
                create_time: row.get(1)?,
            })
        })
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

pub fn map_timeline_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StudyTimelineSummary> {
    Ok(StudyTimelineSummary {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        text: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        covered_through_id: row.get(5)?,
        activity_count: row.get(6)?,
        create_time: row.get(7)?,
    })
}

#[tauri::command]
pub async fn list_study_timeline_summaries(
    subject_id: i64,
    limit: Option<i64>,
) -> Result<Vec<StudyTimelineSummary>, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let cap = limit.unwrap_or(120).clamp(1, 500);
    let mut stmt = conn
        .prepare(
            "SELECT Id, SubjectId, Text, StartTime, EndTime, CoveredThroughId, ActivityCount, CreateTime
             FROM StudyTimelineSummary
             WHERE SubjectId = ?
             ORDER BY datetime(EndTime) DESC, Id DESC
             LIMIT ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![subject_id, cap], map_timeline_summary_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

#[tauri::command]
pub async fn get_study_timeline_summary_cursor(subject_id: i64) -> Result<i64, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let value: Option<i64> = conn
        .query_row(
            "SELECT CoveredThroughId FROM StudyTimelineSummary
             WHERE SubjectId = ?
             ORDER BY CoveredThroughId DESC, Id DESC
             LIMIT 1",
            [subject_id],
            |row| row.get(0),
        )
        .ok();
    Ok(value.unwrap_or(0))
}

#[tauri::command]
pub async fn list_unsummarized_study_activity(
    subject_id: i64,
    after_id: i64,
    limit: Option<i64>,
) -> Result<Vec<StudyActivity>, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let cap = limit.unwrap_or(200).clamp(1, 500);
    let mut stmt = conn
        .prepare(
            "SELECT Id, SubjectId, Kind, Names, QuestionCount, CorrectCount, CreateTime
             FROM StudyActivity
             WHERE SubjectId = ? AND Id > ?
             ORDER BY Id ASC
             LIMIT ?",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![subject_id, after_id.max(0), cap], map_activity_row)
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

#[tauri::command]
pub async fn insert_study_timeline_summary(
    subject_id: i64,
    text: String,
    start_time: String,
    end_time: String,
    covered_through_id: i64,
    activity_count: i64,
) -> Result<StudyTimelineSummary, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let clean = text.trim();
    if clean.is_empty() {
        return Err("摘要不能为空".into());
    }
    if covered_through_id <= 0 || activity_count <= 0 {
        return Err("摘要范围无效".into());
    }
    conn.execute(
        "INSERT INTO StudyTimelineSummary (SubjectId, Text, StartTime, EndTime, CoveredThroughId, ActivityCount, CreateTime)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        rusqlite::params![
            subject_id,
            clean,
            start_time,
            end_time,
            covered_through_id,
            activity_count.max(1),
        ],
    )
    .map_err(|e| format!("{}", e))?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT Id, SubjectId, Text, StartTime, EndTime, CoveredThroughId, ActivityCount, CreateTime
         FROM StudyTimelineSummary WHERE Id = ?",
        [id],
        map_timeline_summary_row,
    )
    .map_err(|e| format!("{}", e))
}

pub fn delete_knowledge_links_for_subject(conn: &Connection, subject_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM QuestionKnowledgeNodes WHERE NodeId IN (SELECT Id FROM StudyGraphNodes WHERE SubjectId = ?)",
        [subject_id],
    )
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

pub fn collect_node_subtree(conn: &Connection, subject_id: i64, roots: &[i64]) -> Result<HashSet<i64>, String> {
    let mut stmt = conn
        .prepare("SELECT Id, ParentId FROM StudyGraphNodes WHERE SubjectId = ?")
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?))
        })
        .map_err(|e| format!("{}", e))?;
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut ids = HashSet::new();
    for row in rows {
        let (id, parent) = row.map_err(|e| format!("{}", e))?;
        ids.insert(id);
        if let Some(parent_id) = parent {
            children.entry(parent_id).or_default().push(id);
        }
    }
    let mut set = HashSet::new();
    let mut stack: Vec<i64> = roots.iter().copied().filter(|id| ids.contains(id)).collect();
    while let Some(id) = stack.pop() {
        if set.insert(id) {
            if let Some(kids) = children.get(&id) {
                stack.extend(kids.iter().copied());
            }
        }
    }
    Ok(set)
}

pub fn unique_node_key(conn: &Connection, subject_id: i64, base: &str) -> Result<String, String> {
    let mut key = base.trim().to_string();
    if key.is_empty() {
        key = "n".to_string();
    }
    let mut suffix = 2;
    loop {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM StudyGraphNodes WHERE SubjectId = ? AND NodeKey = ?",
                rusqlite::params![subject_id, key],
                |row| row.get(0),
            )
            .map_err(|e| format!("{}", e))?;
        if exists == 0 {
            return Ok(key);
        }
        key = format!("{}_{}", base, suffix);
        suffix += 1;
    }
}

pub fn move_nodes_to_subject(
    conn: &Connection,
    from_subject: i64,
    to_subject: i64,
    node_ids: &HashSet<i64>,
) -> Result<i64, String> {
    if node_ids.is_empty() {
        return Ok(0);
    }
    let placeholders = node_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut params: Vec<i64> = vec![from_subject];
    params.extend(node_ids.iter().copied());
    let mut stmt = conn
        .prepare(&format!(
            "SELECT Id, NodeKey, ParentId FROM StudyGraphNodes WHERE SubjectId = ? AND Id IN ({placeholders})"
        ))
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    let mut moved = 0i64;
    for row in rows {
        let (id, key, parent) = row.map_err(|e| format!("{}", e))?;
        let next_key = unique_node_key(conn, to_subject, &key)?;
        let next_parent = parent.filter(|value| node_ids.contains(value));
        conn.execute(
            "UPDATE StudyGraphNodes SET SubjectId = ?, NodeKey = ?, ParentId = ? WHERE Id = ?",
            rusqlite::params![to_subject, next_key, next_parent, id],
        )
        .map_err(|e| format!("{}", e))?;
        moved += 1;
    }
    let mut edge_stmt = conn
        .prepare("SELECT Id, FromId, ToId FROM StudyGraphEdges WHERE SubjectId = ?")
        .map_err(|e| format!("{}", e))?;
    let edges = edge_stmt
        .query_map([from_subject], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })
        .map_err(|e| format!("{}", e))?;
    let mut drop_ids = Vec::new();
    let mut keep_ids = Vec::new();
    for row in edges {
        let (id, from, to) = row.map_err(|e| format!("{}", e))?;
        let from_moved = node_ids.contains(&from);
        let to_moved = node_ids.contains(&to);
        if from_moved && to_moved {
            keep_ids.push(id);
        } else if from_moved || to_moved {
            drop_ids.push(id);
        }
    }
    drop(edge_stmt);
    for id in drop_ids {
        conn.execute("DELETE FROM StudyGraphEdges WHERE Id = ?", [id])
            .map_err(|e| format!("{}", e))?;
    }
    for id in keep_ids {
        conn.execute(
            "UPDATE StudyGraphEdges SET SubjectId = ? WHERE Id = ?",
            rusqlite::params![to_subject, id],
        )
        .map_err(|e| format!("{}", e))?;
    }
    Ok(moved)
}

#[tauri::command]
pub async fn link_questions_to_node(question_ids: Vec<i64>, node_id: i64) -> Result<i64, String> {
    let conn = get_conn()?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM StudyGraphNodes WHERE Id = ?",
            [node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("{}", e))?;
    if exists == 0 {
        return Err("知识点不存在".to_string());
    }
    let mut linked = 0i64;
    for question_id in question_ids {
        if question_id <= 0 {
            continue;
        }
        conn.execute(
            "INSERT OR IGNORE INTO QuestionKnowledgeNodes (QuestionId, NodeId) VALUES (?, ?)",
            rusqlite::params![question_id, node_id],
        )
        .map_err(|e| format!("{}", e))?;
        linked += 1;
    }
    Ok(linked)
}

#[tauri::command]
pub async fn unlink_question_knowledge(question_id: i64, node_id: Option<i64>) -> Result<(), String> {
    let conn = get_conn()?;
    if let Some(node_id) = node_id {
        conn.execute(
            "DELETE FROM QuestionKnowledgeNodes WHERE QuestionId = ? AND NodeId = ?",
            rusqlite::params![question_id, node_id],
        )
        .map_err(|e| format!("{}", e))?;
    } else {
        conn.execute(
            "DELETE FROM QuestionKnowledgeNodes WHERE QuestionId = ?",
            [question_id],
        )
        .map_err(|e| format!("{}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_question_knowledge(question_ids: Vec<i64>) -> Result<Vec<QuestionKnowledgeLink>, String> {
    if question_ids.is_empty() {
        return Ok(vec![]);
    }
    let conn = get_conn()?;
    let placeholders = question_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut stmt = conn
        .prepare(&format!(
            "SELECT q.QuestionId, q.NodeId, n.Name, n.SubjectId, s.Name
             FROM QuestionKnowledgeNodes q
             JOIN StudyGraphNodes n ON n.Id = q.NodeId
             JOIN StudySubjects s ON s.Id = n.SubjectId
             WHERE q.QuestionId IN ({placeholders})"
        ))
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(question_ids.iter()), |row| {
            Ok(QuestionKnowledgeLink {
                question_id: row.get(0)?,
                node_id: row.get(1)?,
                node_name: row.get(2)?,
                subject_id: row.get(3)?,
                subject_name: row.get(4)?,
            })
        })
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(items)
}

#[tauri::command]
pub async fn list_node_questions(node_id: i64) -> Result<Vec<i64>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE subtree(Id) AS (
                SELECT Id FROM StudyGraphNodes WHERE Id = ?
                UNION ALL
                SELECT n.Id
                FROM StudyGraphNodes n
                JOIN subtree s ON n.ParentId = s.Id
                WHERE n.Id != s.Id
            )
            SELECT DISTINCT q.QuestionId
            FROM QuestionKnowledgeNodes q
            JOIN subtree s ON s.Id = q.NodeId
            ORDER BY q.QuestionId",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([node_id], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("{}", e))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(ids)
}

#[tauri::command]
pub async fn list_subject_questions(subject_id: i64) -> Result<Vec<i64>, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT q.QuestionId
             FROM QuestionKnowledgeNodes q
             JOIN StudyGraphNodes n ON n.Id = q.NodeId
             WHERE n.SubjectId = ?
             ORDER BY q.QuestionId DESC",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([subject_id], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("{}", e))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(ids)
}

#[tauri::command]
pub async fn merge_study_subjects(target_id: i64, source_ids: Vec<i64>) -> Result<StudySubject, String> {
    let conn = get_conn()?;
    load_study_subject(&conn, target_id)?;
    let mut sources = Vec::new();
    for id in source_ids {
        if id == target_id {
            continue;
        }
        load_study_subject(&conn, id)?;
        sources.push(id);
    }
    if sources.is_empty() {
        return Err("请提供要合并进来的其他科目".to_string());
    }
    for source_id in sources {
        let source = load_study_subject(&conn, source_id)?;
        let mut stmt = conn
            .prepare("SELECT Id FROM StudyGraphNodes WHERE SubjectId = ?")
            .map_err(|e| format!("{}", e))?;
        let ids = stmt
            .query_map([source_id], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("{}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("{}", e))?;
        let set: HashSet<i64> = ids.into_iter().collect();
        if !set.is_empty() {
            move_nodes_to_subject(&conn, source_id, target_id, &set)?;
            let wrapper_key = unique_node_key(&conn, target_id, &format!("merged_{}", source_id))?;
            let max_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(SortOrder), 0) FROM StudyGraphNodes WHERE SubjectId = ?",
                    [target_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO StudyGraphNodes (SubjectId, NodeKey, Name, Summary, Mastery, ParentId, SortOrder, ForgettingStage, LastReviewedAt)
                 VALUES (?, ?, ?, ?, 0, NULL, ?, 0, NULL)",
                rusqlite::params![target_id, wrapper_key, source.name, source.description, max_order + 1],
            )
            .map_err(|e| format!("{}", e))?;
            let wrapper_id = conn.last_insert_rowid();
            for id in &set {
                conn.execute(
                    "UPDATE StudyGraphNodes SET ParentId = ? WHERE Id = ? AND ParentId IS NULL",
                    rusqlite::params![wrapper_id, id],
                )
                .map_err(|e| format!("{}", e))?;
            }
        }
        conn.execute("DELETE FROM StudyGraphEdges WHERE SubjectId = ?", [source_id])
            .map_err(|e| format!("{}", e))?;
        conn.execute("DELETE FROM StudySubjects WHERE Id = ?", [source_id])
            .map_err(|e| format!("{}", e))?;
    }
    load_study_subject(&conn, target_id)
}

#[tauri::command]
pub async fn split_study_subject(
    subject_id: i64,
    parts: Vec<SplitSubjectPart>,
) -> Result<SplitSubjectResult, String> {
    if parts.is_empty() {
        return Err("请至少指定一个拆出的科目".to_string());
    }
    let conn = get_conn()?;
    load_study_subject(&conn, subject_id)?;
    let mut created = Vec::new();
    for part in parts {
        let name = part.name.trim().to_string();
        if name.is_empty() || part.node_ids.is_empty() {
            continue;
        }
        let moved = collect_node_subtree(&conn, subject_id, &part.node_ids)?;
        if moved.is_empty() {
            continue;
        }
        let next = create_study_subject_inner(
            &conn,
            &name,
            part.description.as_deref().unwrap_or(""),
        )?;
        move_nodes_to_subject(&conn, subject_id, next.id, &moved)?;
        created.push(load_study_subject(&conn, next.id)?);
    }
    if created.is_empty() {
        return Err("没有可拆出的知识点".to_string());
    }
    Ok(SplitSubjectResult {
        original: load_study_subject(&conn, subject_id)?,
        created,
    })
}

pub fn create_study_subject_inner(
    conn: &Connection,
    name: &str,
    description: &str,
) -> Result<StudySubject, String> {
    conn.execute(
        "INSERT INTO StudySubjects (Name, Description, CreateTime) VALUES (?, ?, datetime('now'))",
        rusqlite::params![name, description],
    )
    .map_err(|e| format!("{}", e))?;
    load_study_subject(conn, conn.last_insert_rowid())
}
