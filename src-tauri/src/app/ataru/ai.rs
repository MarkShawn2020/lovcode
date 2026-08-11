use super::sdk::{RankedSearchCandidate, SearchMode};
use crate::app::SearchResult;
use std::collections::HashMap;

const RRF_K: f32 = 60.0;

pub(crate) fn query_prefers_semantic_search(query: &str) -> bool {
    let trimmed = query.trim();
    if trimmed.is_empty()
        || trimmed.contains(':')
        || trimmed.contains('"')
        || trimmed.contains('\'')
        || trimmed.contains(" AND ")
        || trimmed.contains(" OR ")
        || trimmed.starts_with('-')
    {
        return false;
    }

    let word_count = trimmed.split_whitespace().count();
    let cjk_count = trimmed
        .chars()
        .filter(|ch| matches!(*ch, '\u{3400}'..='\u{9fff}'))
        .count();
    let normalized = trimmed.to_lowercase();
    let question_like = [
        "how",
        "why",
        "what",
        "where",
        "when",
        "which",
        "怎么",
        "为什么",
        "什么",
        "哪里",
        "如何",
        "哪次",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));

    question_like || word_count >= 6 || cjk_count >= 10
}

pub(crate) fn resolve_search_mode(
    requested: SearchMode,
    query: &str,
    semantic_available: bool,
) -> SearchMode {
    match requested {
        SearchMode::Auto if semantic_available && query_prefers_semantic_search(query) => {
            SearchMode::Hybrid
        }
        SearchMode::Auto => SearchMode::Keyword,
        SearchMode::Semantic | SearchMode::Hybrid if !semantic_available => SearchMode::Keyword,
        explicit => explicit,
    }
}

pub(crate) fn fuse_ranked_results(
    lexical: Vec<SearchResult>,
    semantic: Vec<SearchResult>,
) -> Vec<RankedSearchCandidate> {
    let mut candidates: HashMap<String, RankedSearchCandidate> = HashMap::new();

    for (rank, result) in lexical.into_iter().enumerate() {
        let score = 1.0 / (RRF_K + rank as f32 + 1.0);
        let key = result_key(&result);
        let lexical_score = result.score;
        candidates
            .entry(key)
            .and_modify(|candidate| {
                candidate.fusion_score += score;
                candidate.lexical_score = Some(
                    candidate
                        .lexical_score
                        .map(|current| current.max(lexical_score))
                        .unwrap_or(lexical_score),
                );
            })
            .or_insert(RankedSearchCandidate {
                result,
                lexical_score: Some(lexical_score),
                semantic_score: None,
                fusion_score: score,
            });
    }

    for (rank, result) in semantic.into_iter().enumerate() {
        let score = 0.9 / (RRF_K + rank as f32 + 1.0);
        let key = result_key(&result);
        let semantic_score = result.score;
        candidates
            .entry(key)
            .and_modify(|candidate| {
                candidate.fusion_score += score;
                candidate.semantic_score = Some(
                    candidate
                        .semantic_score
                        .map(|current| current.max(semantic_score))
                        .unwrap_or(semantic_score),
                );
            })
            .or_insert(RankedSearchCandidate {
                result,
                lexical_score: None,
                semantic_score: Some(semantic_score),
                fusion_score: score,
            });
    }

    let mut ranked = candidates.into_values().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .fusion_score
            .partial_cmp(&left.fusion_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.result.timestamp.cmp(&left.result.timestamp))
            .then_with(|| left.result.session_id.cmp(&right.result.session_id))
    });
    ranked
}

fn result_key(result: &SearchResult) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        project_scope(result),
        result.session_id,
        result.uuid,
        result.line_number,
        result.round_index
    )
}

fn project_scope(result: &SearchResult) -> &str {
    if result.project_id.is_empty() {
        result.project_path.trim_end_matches(['/', '\\'])
    } else {
        &result.project_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(uuid: &str, score: f32) -> SearchResult {
        SearchResult {
            uuid: uuid.to_string(),
            content: uuid.to_string(),
            role: "assistant".to_string(),
            line_number: 4,
            project_id: "project".to_string(),
            project_path: "/tmp/project".to_string(),
            session_id: "session".to_string(),
            session_summary: None,
            title: None,
            summary: None,
            last_prompt: None,
            round_index: 1,
            round_prompt: None,
            round_timestamp: None,
            timestamp: "2026-08-10T00:00:00Z".to_string(),
            score,
        }
    }

    #[test]
    fn auto_mode_keeps_scoped_queries_lexical_and_uses_hybrid_for_questions() {
        assert_eq!(
            resolve_search_mode(SearchMode::Auto, "project:yoda status", true),
            SearchMode::Keyword
        );
        assert_eq!(
            resolve_search_mode(SearchMode::Auto, "为什么那次发布后搜索结果不完整", true),
            SearchMode::Hybrid
        );
        assert_eq!(
            resolve_search_mode(SearchMode::Hybrid, "natural language", false),
            SearchMode::Keyword
        );
    }

    #[test]
    fn reciprocal_rank_fusion_merges_the_same_message_and_keeps_signals() {
        let fused = fuse_ranked_results(vec![result("same", 8.0)], vec![result("same", 0.82)]);
        assert_eq!(fused.len(), 1);
        assert_eq!(fused[0].lexical_score, Some(8.0));
        assert_eq!(fused[0].semantic_score, Some(0.82));
        assert!(fused[0].fusion_score > 1.0 / 61.0);
    }

    #[test]
    fn reciprocal_rank_fusion_keeps_identical_message_ids_from_different_projects() {
        let first = result("same", 8.0);
        let mut second = result("same", 0.82);
        second.project_id = "another-project".to_string();
        second.project_path = "/tmp/another-project".to_string();

        let fused = fuse_ranked_results(vec![first], vec![second]);
        assert_eq!(fused.len(), 2);
    }
}
