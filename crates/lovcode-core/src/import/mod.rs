//! Importers for third-party export formats. Converted output is written
//! as canonical `Conversation` JSON-lines under
//! `~/.lovcode/imports/<source>/`, ready for the matching `ImportedAdapter`.

pub mod chatgpt;
