//! High-level search API on top of `index`.

use crate::index::{collect_top_docs, IndexSchema, LovcodeIndex};
use crate::types::{SearchQuery, SearchResult};
use anyhow::Result;
use chrono::{DateTime, TimeZone, Utc};
use tantivy::schema::Value;
use tantivy::TantivyDocument;

const DEFAULT_LIMIT: usize = 50;
const SNIPPET_CHARS: usize = 200;

pub fn search(idx: &LovcodeIndex, q: &SearchQuery) -> Result<Vec<SearchResult>> {
    let reader = idx.reader()?;
    let parser = idx.query_parser();
    let schema = idx.schema();
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT);

    // Filtering by source/project/date happens post-hit (KISS). For 10k-100k
    // conversations this is fine; we revisit if it bites.
    let hits = collect_top_docs(&reader, &parser, &q.q, limit * 4)?;
    let searcher = reader.searcher();

    let mut out = Vec::with_capacity(limit);
    for (score, addr) in hits {
        let doc: TantivyDocument = searcher.doc(addr)?;
        let r = doc_to_result(&doc, schema, score, &q.q);
        if !passes_filter(&r, q) {
            continue;
        }
        out.push(r);
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

fn passes_filter(r: &SearchResult, q: &SearchQuery) -> bool {
    if let Some(src) = &q.source {
        if &r.source != src { return false; }
    }
    if let Some(proj) = &q.project {
        match &r.project {
            Some(p) if p.contains(proj) => {}
            _ => return false,
        }
    }
    if let Some(since) = q.since {
        match r.timestamp {
            Some(t) if t >= since => {}
            _ => return false,
        }
    }
    if let Some(until) = q.until {
        match r.timestamp {
            Some(t) if t <= until => {}
            _ => return false,
        }
    }
    true
}

fn doc_to_result(d: &TantivyDocument, s: &IndexSchema, score: f32, query: &str) -> SearchResult {
    let id = text(d, s.id).unwrap_or_default();
    let source = text(d, s.source).unwrap_or_default();
    let project = text(d, s.project);
    let title = text(d, s.title);
    let body = text(d, s.body).unwrap_or_default();
    let updated = i64_val(d, s.updated_at)
        .and_then(|t| Utc.timestamp_opt(t, 0).single());
    let snippet = make_snippet(&body, query);

    SearchResult {
        conversation_id: id,
        source,
        project,
        title,
        snippet,
        score,
        timestamp: updated,
    }
}

fn text(d: &TantivyDocument, f: tantivy::schema::Field) -> Option<String> {
    d.get_first(f).and_then(|v| v.as_str().map(String::from))
}

fn i64_val(d: &TantivyDocument, f: tantivy::schema::Field) -> Option<i64> {
    d.get_first(f).and_then(|v| v.as_i64())
}

/// Crude snippet: window around first query term occurrence.
fn make_snippet(body: &str, query: &str) -> String {
    let needle = query.split_whitespace().next().unwrap_or("").to_lowercase();
    if needle.is_empty() {
        return body.chars().take(SNIPPET_CHARS).collect();
    }
    let lower = body.to_lowercase();
    let Some(byte_pos) = lower.find(&needle) else {
        return body.chars().take(SNIPPET_CHARS).collect();
    };
    let mut start_char = 0usize;
    for (i, _) in body.char_indices() {
        if i >= byte_pos.saturating_sub(80) {
            start_char = i;
            break;
        }
    }
    let slice: String = body[start_char..].chars().take(SNIPPET_CHARS).collect();
    let prefix = if start_char > 0 { "…" } else { "" };
    let suffix = if start_char + slice.len() < body.len() { "…" } else { "" };
    format!("{prefix}{slice}{suffix}")
}

/// Convenience helper used by CLI / MCP / Tauri.
pub fn search_text(idx: &LovcodeIndex, q: &str, limit: usize) -> Result<Vec<SearchResult>> {
    search(idx, &SearchQuery {
        q: q.to_string(),
        limit: Some(limit),
        ..Default::default()
    })
}

/// Parse simple `--since 7d` style.
pub fn parse_since(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    if s.is_empty() { return None; }
    if let Some(n_str) = s.strip_suffix('d') {
        if let Ok(n) = n_str.parse::<i64>() {
            return Some(Utc::now() - chrono::Duration::days(n));
        }
    }
    if let Some(n_str) = s.strip_suffix('h') {
        if let Ok(n) = n_str.parse::<i64>() {
            return Some(Utc::now() - chrono::Duration::hours(n));
        }
    }
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}
