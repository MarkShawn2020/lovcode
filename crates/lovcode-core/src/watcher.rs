//! `notify`-driven incremental indexer.
//!
//! Run once-mode: index everything every adapter discovers.
//! Watch mode: re-parse + re-index files when they change.

use crate::adapter::SourceAdapter;
use crate::index::{add_conversation, LovcodeIndex};
use anyhow::Result;
use notify::{recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

/// One-shot full index of every conversation every adapter knows about.
pub fn index_all(idx: &LovcodeIndex, adapters: &[Box<dyn SourceAdapter>]) -> Result<usize> {
    let mut writer = idx.writer()?;
    let schema = idx.schema();
    let mut count = 0usize;

    for adapter in adapters {
        let paths = match adapter.discover() {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(adapter = adapter.id(), error = %e, "discover failed");
                continue;
            }
        };
        for path in paths {
            match adapter.parse(&path) {
                Ok(c) if !c.messages.is_empty() => {
                    if let Err(e) = add_conversation(&mut writer, schema, &c) {
                        tracing::warn!(path = %path.display(), error = %e, "index failed");
                    } else {
                        count += 1;
                    }
                }
                Ok(_) => {} // empty conversation, skip
                Err(e) => {
                    tracing::warn!(path = %path.display(), error = %e, "parse failed");
                }
            }
        }
    }

    writer.commit()?;
    Ok(count)
}

/// Watch adapter roots and reindex on change. Blocks indefinitely.
///
/// Debounce: collect events for 500ms, then batch-reparse touched files.
pub fn watch(idx: &LovcodeIndex, adapters: Vec<Box<dyn SourceAdapter>>) -> Result<()> {
    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher: RecommendedWatcher = recommended_watcher(tx)?;

    // Map every watched root to the adapter that owns it.
    let mut roots: Vec<(PathBuf, &dyn SourceAdapter)> = Vec::new();
    for a in &adapters {
        for r in a.watch_roots() {
            if !r.exists() {
                std::fs::create_dir_all(&r).ok();
            }
            if r.exists() {
                watcher.watch(&r, RecursiveMode::Recursive)?;
                roots.push((r, a.as_ref()));
            }
        }
    }

    let mut pending: Vec<(PathBuf, &dyn SourceAdapter)> = Vec::new();
    let mut last_flush = Instant::now();
    let debounce = Duration::from_millis(500);

    loop {
        match rx.recv_timeout(debounce) {
            Ok(Ok(event)) => {
                for path in event.paths {
                    if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                        continue;
                    }
                    if let Some(adapter) = roots.iter().find_map(|(r, a)| {
                        if path.starts_with(r) { Some(*a) } else { None }
                    }) {
                        pending.push((path, adapter));
                    }
                }
            }
            Ok(Err(e)) => tracing::warn!(error = %e, "watch error"),
            Err(_) => {} // timeout — fall through to flush
        }

        if !pending.is_empty() && last_flush.elapsed() >= debounce {
            flush(idx, &mut pending)?;
            last_flush = Instant::now();
        }
    }
}

fn flush(idx: &LovcodeIndex, pending: &mut Vec<(PathBuf, &dyn SourceAdapter)>) -> Result<()> {
    let mut writer = idx.writer()?;
    let schema = idx.schema();
    let mut seen = std::collections::HashSet::new();

    for (path, adapter) in pending.drain(..) {
        if !seen.insert(path.clone()) { continue; }
        match adapter.parse(&path) {
            Ok(c) if !c.messages.is_empty() => {
                let _ = add_conversation(&mut writer, schema, &c);
            }
            _ => {}
        }
    }
    writer.commit()?;
    Ok(())
}
