//! Conversation detail loader — re-parse from raw file using the id stored in the index.

use crate::adapter::builtin_adapters;
use crate::index::LovcodeIndex;
use crate::types::Conversation;
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use tantivy::query::TermQuery;
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::TantivyDocument;

pub fn get_conversation(idx: &LovcodeIndex, id: &str) -> Result<Conversation> {
    let reader = idx.reader()?;
    let searcher = reader.searcher();
    let schema = idx.schema();

    let term = tantivy::Term::from_field_text(schema.id, id);
    let query = TermQuery::new(term, IndexRecordOption::Basic);
    let hits = searcher.search(&query, &tantivy::collector::TopDocs::with_limit(1))?;
    let (_, addr) = hits.first().ok_or_else(|| anyhow!("not found: {id}"))?;
    let doc: TantivyDocument = searcher.doc(*addr)?;

    let source = doc
        .get_first(schema.source)
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("missing source field"))?
        .to_string();
    let raw_path: Option<PathBuf> = doc
        .get_first(schema.raw_path)
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    let Some(path) = raw_path else {
        return Err(anyhow!("conversation has no raw_path (transient?): {id}"));
    };

    let adapter = builtin_adapters()
        .into_iter()
        .find(|a| a.id() == source)
        .ok_or_else(|| anyhow!("unknown source adapter: {source}"))?;

    let conversations = adapter.parse_many(&path)?;
    conversations
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| anyhow!("conversation {id} not found in file {}", path.display()))
}
