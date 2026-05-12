//! Lovcode core library: AI conversation search.
//!
//! See `docs/v0.40-rewrite-plan.md` for the design.
//!
//! Module skeleton (filled in over phase 1.2 / 1.3):
//! - `types`     — Conversation, Message, Source, SearchQuery, SearchResult
//! - `adapter`   — `SourceAdapter` trait + per-source modules
//! - `index`     — tantivy schema + writer
//! - `query`     — high-level search API
//! - `watcher`   — notify-based incremental reindex

pub mod types;
pub mod adapter;
pub mod index;
pub mod query;
pub mod watcher;
pub mod detail;
pub mod import;
