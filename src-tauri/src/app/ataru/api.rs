use super::ai::{fuse_ranked_results, query_prefers_semantic_search, resolve_search_mode};
use super::sdk::{aggregate_candidates, SearchMode, SearchRequest, SearchResponse};
use crate::app::{get_semantic_search_status, search_chats, semantic_search_chats, SearchResult};
use std::time::{Duration, Instant};

const ATARU_SEARCH_CONTRACT_VERSION: u32 = 2;
const SEMANTIC_STATUS_TIMEOUT: Duration = Duration::from_millis(100);
const SEMANTIC_SEARCH_TIMEOUT: Duration = Duration::from_millis(650);

async fn run_lexical_search(
    query: String,
    fetch_limit: usize,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || search_chats(query, Some(fetch_limit), project_id))
        .await
        .map_err(|error| format!("ATARU_INTERNAL: Keyword search task failed. {error}"))?
        .map_err(stabilize_lexical_error)
}

fn stabilize_lexical_error(error: String) -> String {
    if error.starts_with("ATARU_") {
        return error;
    }

    let normalized = error.to_ascii_lowercase();
    let code = if normalized.contains("not built")
        || normalized.contains("schema is outdated")
        || normalized.contains("index path")
    {
        "ATARU_INDEX_UNAVAILABLE"
    } else if normalized.contains("syntax error")
        || normalized.contains("query parser")
        || normalized.contains("field does not exist")
    {
        "ATARU_BAD_REQUEST"
    } else {
        "ATARU_INTERNAL"
    };
    format!("{code}: Keyword search failed. {error}")
}

fn resolve_effective_mode_from_outcomes(
    planned_mode: SearchMode,
    lexical_was_run: bool,
    lexical_succeeded: bool,
    lexical_has_results: bool,
    semantic_was_run: bool,
    semantic_succeeded: bool,
    semantic_has_results: bool,
) -> SearchMode {
    if semantic_has_results {
        if lexical_has_results && planned_mode == SearchMode::Hybrid {
            SearchMode::Hybrid
        } else {
            SearchMode::Semantic
        }
    } else if lexical_was_run && lexical_succeeded {
        SearchMode::Keyword
    } else if semantic_was_run && semantic_succeeded {
        SearchMode::Semantic
    } else {
        planned_mode
    }
}

pub(crate) fn ataru_keyword_search(request: SearchRequest) -> Result<SearchResponse, String> {
    let started = Instant::now();
    let query = request.query.trim().to_string();
    if query.is_empty() {
        return Err("ATARU_EMPTY_QUERY: Search query cannot be empty.".to_string());
    }

    let limit = request.limit.clamp(1, 100);
    let fetch_limit = limit.saturating_mul(8).clamp(80, 600);
    let lexical = search_chats(query.clone(), Some(fetch_limit), request.project_id)
        .map_err(stabilize_lexical_error)?;
    let hits = aggregate_candidates(
        fuse_ranked_results(lexical, Vec::<SearchResult>::new()),
        request.level,
        limit,
    );

    Ok(SearchResponse {
        version: ATARU_SEARCH_CONTRACT_VERSION,
        query,
        level: request.level,
        requested_mode: request.mode,
        mode: SearchMode::Keyword,
        semantic_available: false,
        took_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        total: hits.len(),
        hits,
        warnings: Vec::new(),
    })
}

#[tauri::command]
pub(crate) async fn ataru_search(request: SearchRequest) -> Result<SearchResponse, String> {
    let started = Instant::now();
    let query = request.query.trim().to_string();
    if query.is_empty() {
        return Err("ATARU_EMPTY_QUERY: Search query cannot be empty.".to_string());
    }

    let limit = request.limit.clamp(1, 100);
    let needs_semantic_status = matches!(request.mode, SearchMode::Semantic | SearchMode::Hybrid)
        || (request.mode == SearchMode::Auto && query_prefers_semantic_search(&query));
    let semantic_available = if needs_semantic_status {
        tokio::time::timeout(SEMANTIC_STATUS_TIMEOUT, get_semantic_search_status())
            .await
            .ok()
            .and_then(Result::ok)
            .map(|status| status.configured && status.ready)
            .unwrap_or(false)
    } else {
        false
    };
    let mode = resolve_search_mode(request.mode, &query, semantic_available);
    let fetch_limit = limit.saturating_mul(8).clamp(80, 600);
    let mut warnings = Vec::new();

    if needs_semantic_status && !semantic_available {
        warnings.push(
            "ATARU_SEMANTIC_FALLBACK: Semantic recall is not ready; keyword results are shown."
                .to_string(),
        );
    }

    let mut lexical_was_run = matches!(mode, SearchMode::Keyword | SearchMode::Hybrid);
    let lexical_task = lexical_was_run.then(|| {
        let lexical_query = query.clone();
        let project_id = request.project_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            search_chats(lexical_query, Some(fetch_limit), project_id)
        })
    });

    let semantic_was_run = matches!(mode, SearchMode::Semantic | SearchMode::Hybrid);
    let semantic_outcome = if semantic_was_run {
        Some(
            match tokio::time::timeout(
                SEMANTIC_SEARCH_TIMEOUT,
                semantic_search_chats(
                    query.clone(),
                    Some(fetch_limit.min(200)),
                    request.project_id.clone(),
                ),
            )
            .await
            {
                Ok(outcome) => outcome,
                Err(_) => Err(
                    "ATARU_TIMEOUT: Semantic recall exceeded the 650 ms response budget."
                        .to_string(),
                ),
            },
        )
    } else {
        None
    };

    let lexical_outcome = match lexical_task {
        Some(task) => Some(
            task.await
                .map_err(|error| format!("ATARU_INTERNAL: Keyword search task failed. {error}"))
                .and_then(|result| result.map_err(stabilize_lexical_error)),
        ),
        None => None,
    };

    let mut lexical = Vec::new();
    let mut lexical_error = None;
    if let Some(outcome) = lexical_outcome {
        match outcome {
            Ok(results) => lexical = results,
            Err(error) => lexical_error = Some(error),
        }
    }

    let mut semantic = Vec::new();
    let mut semantic_error = None;
    if let Some(outcome) = semantic_outcome {
        match outcome {
            Ok(results) => semantic = results,
            Err(error) => semantic_error = Some(error),
        }
    }

    if semantic.is_empty() && matches!(mode, SearchMode::Semantic) {
        lexical_was_run = true;
        match run_lexical_search(query.clone(), fetch_limit, request.project_id.clone()).await {
            Ok(results) => {
                lexical = results;
                lexical_error = None;
            }
            Err(error) => lexical_error = Some(error),
        }
    }

    if let Some(error) = semantic_error.as_deref() {
        warnings.push(format!(
            "ATARU_SEMANTIC_FALLBACK: Semantic recall was unavailable; keyword fallback was used. {error}"
        ));
    } else if semantic_was_run && semantic.is_empty() {
        warnings.push(
            "ATARU_SEMANTIC_FALLBACK: Semantic recall returned no matching records; keyword fallback was used."
                .to_string(),
        );
    }

    if lexical_error.is_some() && semantic_error.is_some() {
        return Err(
            "ATARU_INTERNAL: Keyword and semantic recall were both unavailable.".to_string(),
        );
    }

    if let Some(error) = lexical_error.as_deref() {
        if semantic_was_run && semantic_error.is_none() {
            warnings.push(format!(
                "ATARU_KEYWORD_FALLBACK: Keyword recall was unavailable; semantic recall remained available. {error}"
            ));
        } else {
            return Err(error.to_string());
        }
    }

    let effective_mode = resolve_effective_mode_from_outcomes(
        mode,
        lexical_was_run,
        lexical_error.is_none(),
        !lexical.is_empty(),
        semantic_was_run,
        semantic_error.is_none(),
        !semantic.is_empty(),
    );
    let candidates = fuse_ranked_results(
        lexical,
        if matches!(effective_mode, SearchMode::Semantic | SearchMode::Hybrid) {
            semantic
        } else {
            Vec::<SearchResult>::new()
        },
    );
    let hits = aggregate_candidates(candidates, request.level, limit);

    Ok(SearchResponse {
        version: ATARU_SEARCH_CONTRACT_VERSION,
        query,
        level: request.level,
        requested_mode: request.mode,
        mode: effective_mode,
        semantic_available,
        took_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        total: hits.len(),
        hits,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_mode_reflects_each_healthy_recall_path() {
        assert_eq!(
            resolve_effective_mode_from_outcomes(
                SearchMode::Hybrid,
                true,
                true,
                true,
                true,
                true,
                true,
            ),
            SearchMode::Hybrid
        );
        assert_eq!(
            resolve_effective_mode_from_outcomes(
                SearchMode::Semantic,
                true,
                true,
                false,
                true,
                false,
                false,
            ),
            SearchMode::Keyword
        );
        assert_eq!(
            resolve_effective_mode_from_outcomes(
                SearchMode::Hybrid,
                true,
                false,
                false,
                true,
                true,
                false,
            ),
            SearchMode::Semantic
        );
    }

    #[test]
    fn lexical_errors_are_exposed_through_stable_ataru_codes() {
        assert!(
            stabilize_lexical_error("Search index not built".to_string())
                .starts_with("ATARU_INDEX_UNAVAILABLE:")
        );
        assert!(
            stabilize_lexical_error("Syntax Error".to_string()).starts_with("ATARU_BAD_REQUEST:")
        );
    }
}
