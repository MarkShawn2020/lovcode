//! Ataru's versioned recall boundary.
//!
//! The existing history parsers and indexes remain the compatibility core for
//! now. This module gives UI, CLI and future external consumers one stable
//! search contract while the legacy `search.rs` implementation is split behind
//! it incrementally.

mod ai;
pub(crate) mod api;
pub(crate) mod sdk;
