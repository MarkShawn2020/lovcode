//! Tantivy-backed conversation index.
//!
//! Schema: one document per `Conversation`, with full-text searchable
//! title + body (all messages concatenated). CJK tokenization via jieba.

use crate::types::Conversation;
use anyhow::{Context, Result};
use jieba_rs::Jieba;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, Schema, FAST, INDEXED, STORED, STRING, TEXT};
use tantivy::tokenizer::{TextAnalyzer, Token, TokenStream, Tokenizer};
use tantivy::{Index, IndexReader, IndexWriter, TantivyDocument};

const CJK_TOKENIZER: &str = "cjk_jieba";
const WRITER_HEAP_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone)]
pub struct LovcodeIndex {
    index: Index,
    schema: IndexSchema,
}

#[derive(Clone)]
pub struct IndexSchema {
    pub schema: Schema,
    pub id: Field,
    pub source: Field,
    pub project: Field,
    pub title: Field,
    pub body: Field,
    pub created_at: Field,
    pub updated_at: Field,
    pub raw_path: Field,
}

impl LovcodeIndex {
    /// Open an existing index at `path`, or create it if missing.
    pub fn open_or_create(path: &Path) -> Result<Self> {
        std::fs::create_dir_all(path).context("create index dir")?;
        let schema = build_schema();
        let index = if Index::exists(&tantivy::directory::MmapDirectory::open(path)?)? {
            Index::open_in_dir(path)?
        } else {
            Index::create_in_dir(path, schema.schema.clone())?
        };
        index.tokenizers().register(CJK_TOKENIZER, cjk_tokenizer());
        Ok(Self { index, schema })
    }

    pub fn schema(&self) -> &IndexSchema { &self.schema }

    pub fn writer(&self) -> Result<IndexWriter> {
        Ok(self.index.writer(WRITER_HEAP_BYTES)?)
    }

    pub fn reader(&self) -> Result<IndexReader> {
        Ok(self.index.reader()?)
    }

    pub fn query_parser(&self) -> QueryParser {
        QueryParser::for_index(
            &self.index,
            vec![self.schema.title, self.schema.body, self.schema.project],
        )
    }

    pub fn raw(&self) -> &Index { &self.index }
}

pub fn build_schema() -> IndexSchema {
    let mut b = Schema::builder();

    let id = b.add_text_field("id", STRING | STORED);
    let source = b.add_text_field("source", STRING | STORED);
    let project = b.add_text_field(
        "project",
        tantivy::schema::TextOptions::default()
            .set_stored()
            .set_indexing_options(
                tantivy::schema::TextFieldIndexing::default()
                    .set_tokenizer(CJK_TOKENIZER)
                    .set_index_option(tantivy::schema::IndexRecordOption::WithFreqsAndPositions),
            ),
    );
    let title = b.add_text_field(
        "title",
        tantivy::schema::TextOptions::default()
            .set_stored()
            .set_indexing_options(
                tantivy::schema::TextFieldIndexing::default()
                    .set_tokenizer(CJK_TOKENIZER)
                    .set_index_option(tantivy::schema::IndexRecordOption::WithFreqsAndPositions),
            ),
    );
    let body = b.add_text_field(
        "body",
        tantivy::schema::TextOptions::default()
            .set_stored()
            .set_indexing_options(
                tantivy::schema::TextFieldIndexing::default()
                    .set_tokenizer(CJK_TOKENIZER)
                    .set_index_option(tantivy::schema::IndexRecordOption::WithFreqsAndPositions),
            ),
    );
    let created_at = b.add_i64_field("created_at", INDEXED | STORED | FAST);
    let updated_at = b.add_i64_field("updated_at", INDEXED | STORED | FAST);
    let raw_path = b.add_text_field("raw_path", STORED);

    let _ = TEXT; // silence unused import in some toolchains

    IndexSchema {
        schema: b.build(),
        id, source, project, title, body, created_at, updated_at, raw_path,
    }
}

/// Index (or re-index) one Conversation. Caller commits.
pub fn add_conversation(writer: &mut IndexWriter, s: &IndexSchema, c: &Conversation) -> Result<()> {
    // Replace existing entry with same id.
    writer.delete_term(tantivy::Term::from_field_text(s.id, &c.id));

    let body = c
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let title = c.title.clone().unwrap_or_else(|| {
        c.messages
            .iter()
            .find(|m| matches!(m.role, crate::types::Role::User))
            .map(|m| first_n_chars(&m.content, 80))
            .unwrap_or_default()
    });

    let mut d = TantivyDocument::default();
    d.add_text(s.id, &c.id);
    d.add_text(s.source, &c.source);
    if let Some(p) = &c.project { d.add_text(s.project, p); }
    d.add_text(s.title, &title);
    d.add_text(s.body, &body);
    if let Some(t) = c.created_at { d.add_i64(s.created_at, t.timestamp()); }
    if let Some(t) = c.updated_at { d.add_i64(s.updated_at, t.timestamp()); }
    if let Some(p) = &c.raw_path { d.add_text(s.raw_path, p); }

    writer.add_document(d)?;
    Ok(())
}

fn first_n_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

// ─── CJK tokenizer ───────────────────────────────────────────────────────────

fn cjk_tokenizer() -> TextAnalyzer {
    TextAnalyzer::from(JiebaTokenizer)
}

#[derive(Clone)]
struct JiebaTokenizer;

static JIEBA: OnceLock<Jieba> = OnceLock::new();

impl Tokenizer for JiebaTokenizer {
    type TokenStream<'a> = JiebaTokenStream;
    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        let jieba = JIEBA.get_or_init(Jieba::new);
        let words = jieba.cut(text, true);
        let mut offset = 0usize;
        let tokens = words
            .into_iter()
            .map(|w| {
                let start = offset;
                offset += w.len();
                let lower = w.to_lowercase();
                Token {
                    offset_from: start,
                    offset_to: offset,
                    position: 0,
                    text: lower,
                    position_length: 1,
                }
            })
            .filter(|t| !t.text.trim().is_empty())
            .collect::<Vec<_>>();
        let mut numbered = Vec::with_capacity(tokens.len());
        for (i, mut t) in tokens.into_iter().enumerate() {
            t.position = i;
            numbered.push(t);
        }
        JiebaTokenStream { tokens: numbered, cursor: 0, token: Token::default() }
    }
}

pub struct JiebaTokenStream {
    tokens: Vec<Token>,
    cursor: usize,
    token: Token,
}

impl TokenStream for JiebaTokenStream {
    fn advance(&mut self) -> bool {
        if self.cursor >= self.tokens.len() {
            return false;
        }
        self.token = self.tokens[self.cursor].clone();
        self.cursor += 1;
        true
    }
    fn token(&self) -> &Token { &self.token }
    fn token_mut(&mut self) -> &mut Token { &mut self.token }
}

/// Default on-disk index location.
pub fn default_index_dir() -> PathBuf {
    if let Ok(p) = std::env::var("LOVCODE_INDEX_DIR") {
        return PathBuf::from(p);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovcode")
        .join("index")
}

/// Snapshot top-doc collector for `query`.
pub fn collect_top_docs(
    reader: &IndexReader,
    parser: &QueryParser,
    q: &str,
    limit: usize,
) -> Result<Vec<(f32, tantivy::DocAddress)>> {
    let searcher = reader.searcher();
    let parsed = parser
        .parse_query(q)
        .with_context(|| format!("parse query: {q}"))?;
    Ok(searcher.search(&parsed, &TopDocs::with_limit(limit))?)
}
