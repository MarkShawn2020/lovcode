use crate::app::SearchResult;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub(crate) struct RankedSearchCandidate {
    pub result: SearchResult,
    pub lexical_score: Option<f32>,
    pub semantic_score: Option<f32>,
    pub fusion_score: f32,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SearchLevel {
    #[default]
    Turn,
    Run,
    Session,
    Project,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SearchMode {
    #[default]
    Auto,
    Keyword,
    Semantic,
    Hybrid,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub level: SearchLevel,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
    #[serde(default)]
    pub project_id: Option<String>,
}

fn default_search_limit() -> usize {
    40
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchSignals {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lexical: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<f32>,
    pub fusion: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchHit {
    pub id: String,
    pub level: SearchLevel,
    pub title: String,
    pub snippet: String,
    pub project_id: String,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_number: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    pub match_count: usize,
    pub session_count: usize,
    pub score: f32,
    pub signals: SearchSignals,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResponse {
    pub version: u32,
    pub query: String,
    pub level: SearchLevel,
    pub requested_mode: SearchMode,
    pub mode: SearchMode,
    pub semantic_available: bool,
    pub took_ms: u64,
    pub total: usize,
    pub hits: Vec<SearchHit>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

struct SearchHitAccumulator {
    hit: SearchHit,
    sessions: HashSet<String>,
}

pub(crate) fn aggregate_candidates(
    candidates: Vec<RankedSearchCandidate>,
    level: SearchLevel,
    limit: usize,
) -> Vec<SearchHit> {
    let mut grouped: HashMap<String, SearchHitAccumulator> = HashMap::new();

    for candidate in candidates {
        let result = &candidate.result;
        // Session-level semantic candidates use line 0 and round 0. They are
        // useful evidence for Session/Project recall, but are not atomic Turn
        // or Run records and must not appear at either level.
        if (level == SearchLevel::Turn && result.line_number == 0)
            || (level == SearchLevel::Run && result.round_index == 0)
        {
            continue;
        }
        let key = aggregation_key(
            level,
            candidate.result.session_id.as_str(),
            result.round_index,
            result,
        );
        let next_hit = search_hit_from_candidate(&candidate, level, key.clone());
        let session_id = result.session_id.clone();

        match grouped.get_mut(&key) {
            Some(group) => {
                let should_replace_evidence = next_hit.score > group.hit.score;
                group.hit.match_count += 1;
                group.sessions.insert(session_id);
                group.hit.session_count = group.sessions.len();
                group.hit.score = group.hit.score.max(next_hit.score);
                if should_replace_evidence {
                    group.hit.snippet = next_hit.snippet.clone();
                    group.hit.session_id = next_hit.session_id.clone();
                    group.hit.session_title = next_hit.session_title.clone();
                    group.hit.run_index = next_hit.run_index;
                    group.hit.run_prompt = next_hit.run_prompt.clone();
                    group.hit.message_id = next_hit.message_id.clone();
                    group.hit.line_number = next_hit.line_number;
                    group.hit.role = next_hit.role.clone();
                    group.hit.timestamp = next_hit.timestamp.clone();
                }
                merge_signal(&mut group.hit.signals.lexical, next_hit.signals.lexical);
                merge_signal(&mut group.hit.signals.semantic, next_hit.signals.semantic);
                group.hit.signals.fusion = group.hit.signals.fusion.max(next_hit.signals.fusion);
            }
            None => {
                let mut sessions = HashSet::new();
                sessions.insert(session_id);
                grouped.insert(
                    key,
                    SearchHitAccumulator {
                        hit: next_hit,
                        sessions,
                    },
                );
            }
        }
    }

    let mut hits = grouped
        .into_values()
        .map(|group| group.hit)
        .collect::<Vec<_>>();
    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.timestamp.cmp(&left.timestamp))
            .then_with(|| left.id.cmp(&right.id))
    });
    hits.truncate(limit.clamp(1, 100));
    hits
}

fn merge_signal(target: &mut Option<f32>, next: Option<f32>) {
    if let Some(next) = next {
        *target = Some(target.map(|current| current.max(next)).unwrap_or(next));
    }
}

fn aggregation_key(
    level: SearchLevel,
    session_id: &str,
    round_index: usize,
    result: &super::super::SearchResult,
) -> String {
    let project_scope = if result.project_id.is_empty() {
        result.project_path.trim_end_matches(['/', '\\'])
    } else {
        result.project_id.as_str()
    };
    match level {
        SearchLevel::Turn => format!(
            "message:{project_scope}:{session_id}:{}:{}",
            result.uuid, result.line_number
        ),
        SearchLevel::Run => format!("run:{project_scope}:{session_id}:{round_index}"),
        SearchLevel::Session => format!("session:{project_scope}:{session_id}"),
        SearchLevel::Project => format!("project:{project_scope}"),
    }
}

fn search_hit_from_candidate(
    candidate: &RankedSearchCandidate,
    level: SearchLevel,
    id: String,
) -> SearchHit {
    let result = &candidate.result;
    let session_title = result
        .title
        .clone()
        .or_else(|| result.summary.clone())
        .or_else(|| result.session_summary.clone())
        .or_else(|| result.last_prompt.clone())
        .filter(|value| !value.trim().is_empty());
    let title = match level {
        SearchLevel::Turn => String::new(),
        SearchLevel::Run => result
            .round_prompt
            .as_deref()
            .map(|value| truncate_text(value, 128))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("Run {}", result.round_index)),
        SearchLevel::Session => session_title
            .clone()
            .unwrap_or_else(|| format!("Session {}", short_id(&result.session_id))),
        SearchLevel::Project => project_name(&result.project_path)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Unknown project".to_string()),
    };
    let snippet = if result.content.trim().is_empty() && level != SearchLevel::Turn {
        result
            .round_prompt
            .as_deref()
            .or(result.summary.as_deref())
            .or(result.session_summary.as_deref())
            .or(result.last_prompt.as_deref())
            .unwrap_or("")
    } else {
        &result.content
    };

    SearchHit {
        id,
        level,
        title: normalize_text(&title, 160),
        snippet: normalize_text(snippet, 420),
        project_id: result.project_id.clone(),
        project_path: result.project_path.clone(),
        session_id: Some(result.session_id.clone()).filter(|value| !value.is_empty()),
        session_title,
        run_index: (result.round_index > 0).then_some(result.round_index),
        run_prompt: result
            .round_prompt
            .clone()
            .filter(|value| !value.trim().is_empty()),
        message_id: Some(result.uuid.clone()).filter(|value| !value.is_empty()),
        line_number: (result.line_number > 0).then_some(result.line_number),
        role: Some(result.role.clone()).filter(|value| !value.is_empty()),
        timestamp: Some(result.timestamp.clone()).filter(|value| !value.is_empty()),
        match_count: 1,
        session_count: 1,
        score: candidate.fusion_score,
        signals: SearchSignals {
            lexical: candidate.lexical_score,
            semantic: candidate.semantic_score,
            fusion: candidate.fusion_score,
        },
    }
}

fn normalize_text(value: &str, max_chars: usize) -> String {
    truncate_text(
        &value.split_whitespace().collect::<Vec<_>>().join(" "),
        max_chars,
    )
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let prefix = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn short_id(value: &str) -> String {
    value.chars().take(8).collect()
}

fn project_name(path: &str) -> Option<String> {
    path.trim_end_matches(['/', '\\'])
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .next_back()
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::SearchResult;

    fn result(session: &str, round: usize, uuid: &str, project: &str) -> SearchResult {
        SearchResult {
            uuid: uuid.to_string(),
            content: format!("matched content {uuid}"),
            role: "assistant".to_string(),
            line_number: round + 10,
            project_id: project.to_string(),
            project_path: format!("/tmp/{project}"),
            session_id: session.to_string(),
            session_summary: Some(format!("Session {session}")),
            title: Some(format!("Title {session}")),
            summary: None,
            last_prompt: None,
            round_index: round,
            round_prompt: Some(format!("Prompt {round}")),
            round_timestamp: None,
            timestamp: format!("2026-08-10T00:00:0{round}Z"),
            score: 1.0,
        }
    }

    fn candidate(result: SearchResult, score: f32) -> RankedSearchCandidate {
        RankedSearchCandidate {
            result,
            lexical_score: Some(score),
            semantic_score: None,
            fusion_score: score,
        }
    }

    #[test]
    fn aggregates_atomic_turns_and_runs_at_each_recall_level() {
        let candidates = vec![
            candidate(result("s1", 1, "m1", "p1"), 0.9),
            candidate(result("s1", 1, "m2", "p1"), 0.8),
            candidate(result("s2", 2, "m3", "p1"), 0.7),
        ];

        let turns = aggregate_candidates(candidates.clone(), SearchLevel::Turn, 20);
        assert_eq!(turns.len(), 3);
        assert!(turns.iter().all(|hit| hit.match_count == 1));

        let runs = aggregate_candidates(candidates.clone(), SearchLevel::Run, 20);
        assert_eq!(runs.len(), 2);
        assert_eq!(
            runs.iter()
                .find(|hit| hit.run_index == Some(1))
                .unwrap()
                .match_count,
            2
        );

        let sessions = aggregate_candidates(candidates.clone(), SearchLevel::Session, 20);
        assert_eq!(sessions.len(), 2);

        let projects = aggregate_candidates(candidates, SearchLevel::Project, 20);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].match_count, 3);
        assert_eq!(projects[0].session_count, 2);
    }

    #[test]
    fn session_and_turn_aggregation_keep_identical_session_ids_project_scoped() {
        let candidates = vec![
            candidate(result("same", 1, "same-message", "p1"), 0.9),
            candidate(result("same", 1, "same-message", "p2"), 0.8),
        ];

        let turns = aggregate_candidates(candidates.clone(), SearchLevel::Turn, 20);
        assert_eq!(turns.len(), 2);

        let runs = aggregate_candidates(candidates.clone(), SearchLevel::Run, 20);
        assert_eq!(runs.len(), 2);

        let sessions = aggregate_candidates(candidates, SearchLevel::Session, 20);
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn run_level_skips_candidates_without_a_user_prompt() {
        let candidates = vec![candidate(result("s1", 0, "m0", "p1"), 0.9)];

        let turns = aggregate_candidates(candidates.clone(), SearchLevel::Turn, 20);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].run_index, None);

        let runs = aggregate_candidates(candidates, SearchLevel::Run, 20);
        assert!(runs.is_empty());
    }
}
