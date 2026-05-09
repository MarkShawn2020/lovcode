use super::*;

// ============================================================================
// Search Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SearchResult {
    pub uuid: String,
    pub content: String,
    pub role: String,
    pub line_number: usize,
    pub project_id: String,
    pub project_path: String,
    pub session_id: String,
    pub session_summary: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub last_prompt: Option<String>,
    pub round_index: usize,
    pub round_prompt: Option<String>,
    pub round_timestamp: Option<String>,
    pub timestamp: String,
    pub score: f32,
}

#[tauri::command]
pub(crate) async fn build_search_index() -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _build_guard = SEARCH_INDEX_BUILD_LOCK.lock().map_err(|e| e.to_string())?;
        let index_dir = get_index_dir();
        let index_parent = index_dir
            .parent()
            .ok_or_else(|| "Search index path has no parent".to_string())?;
        let build_dir = index_parent.join("search-index-building");

        if build_dir.exists() {
            fs::remove_dir_all(&build_dir).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&build_dir).map_err(|e| e.to_string())?;

        let schema = create_schema();
        let index = Index::create_in_dir(&build_dir, schema.clone()).map_err(|e| e.to_string())?;

        // Register jieba tokenizer for Chinese support
        register_jieba_tokenizer(&index);

        let mut index_writer: IndexWriter = index
            .writer(50_000_000) // 50MB heap
            .map_err(|e| e.to_string())?;

        let uuid_field = schema.get_field("uuid").unwrap();
        let content_field = schema.get_field("content").unwrap();
        let title_field = schema.get_field("title").unwrap();
        let summary_field = schema.get_field("summary").unwrap();
        let last_prompt_field = schema.get_field("last_prompt").unwrap();
        let prompt_field = schema.get_field("prompt").unwrap();
        let user_field = schema.get_field("user").unwrap();
        let assistant_field = schema.get_field("assistant").unwrap();
        let project_field = schema.get_field("project").unwrap();
        let role_field = schema.get_field("role").unwrap();
        let project_id_field = schema.get_field("project_id").unwrap();
        let project_path_field = schema.get_field("project_path").unwrap();
        let session_id_field = schema.get_field("session_id").unwrap();
        let session_summary_field = schema.get_field("session_summary").unwrap();
        let timestamp_field = schema.get_field("timestamp").unwrap();
        let line_number_field = schema.get_field("line_number").unwrap();
        let round_index_field = schema.get_field("round_index").unwrap();
        let round_prompt_field = schema.get_field("round_prompt").unwrap();
        let round_timestamp_field = schema.get_field("round_timestamp").unwrap();

        let projects_dir = get_claude_dir().join("projects");
        let mut indexed_count = 0;

        // === Command stats collection ===
        let mut command_stats: HashMap<String, HashMap<String, usize>> = HashMap::new();
        let command_pattern = regex::Regex::new(r"<command-name>(/[^<]+)</command-name>")
            .map_err(|e| e.to_string())?;

        // Build alias -> canonical name mapping
        let mut alias_map: HashMap<String, String> = HashMap::new();
        let commands_dir = get_claude_dir().join("commands");

        fn scan_commands_for_aliases(dir: &std::path::Path, alias_map: &mut HashMap<String, String>, base_dir: &std::path::Path) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let path = entry.path();
                    if path.is_dir() {
                        scan_commands_for_aliases(&path, alias_map, base_dir);
                    } else if path.extension().map_or(false, |e| e == "md") {
                        let rel_path = path.strip_prefix(base_dir).unwrap_or(&path);
                        let canonical = rel_path
                            .with_extension("")
                            .to_string_lossy()
                            .replace('/', ":")
                            .replace('\\', ":");

                        if let Ok(content) = fs::read_to_string(&path) {
                            if content.starts_with("---") {
                                if let Some(end) = content[3..].find("---") {
                                    let fm = &content[3..3 + end];
                                    for line in fm.lines() {
                                        if line.starts_with("aliases:") {
                                            let aliases_str = line.trim_start_matches("aliases:").trim();
                                            for alias in aliases_str.split(',') {
                                                let alias = alias.trim()
                                                    .trim_matches('"')
                                                    .trim_matches('\'')
                                                    .trim_start_matches('/')
                                                    .to_string();
                                                if !alias.is_empty() {
                                                    alias_map.insert(alias, canonical.clone());
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if commands_dir.exists() {
            scan_commands_for_aliases(&commands_dir, &mut alias_map, &commands_dir);
        }
        // === End command stats setup ===

        if projects_dir.exists() {
            for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
                let project_entry = project_entry.map_err(|e| e.to_string())?;
                let project_path_buf = project_entry.path();

                if !project_path_buf.is_dir() {
                    continue;
                }

                let project_id = project_path_buf.file_name().unwrap().to_string_lossy().to_string();
                let display_path = decode_project_path(&project_id);

                for entry in fs::read_dir(&project_path_buf).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let path = entry.path();
                    let name = path.file_name().unwrap().to_string_lossy().to_string();

                    if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                        let session_id = name.trim_end_matches(".jsonl").to_string();
                        let session_head = read_session_head(&path, 0);
                        let session_title = session_head.title.unwrap_or_default();
                        let session_last_prompt = session_head.last_prompt.unwrap_or_default();
                        let file_content = fs::read_to_string(&path).unwrap_or_default();

                        let mut session_summary: Option<String> = session_head.summary;

                        // First pass: get summary
                        if session_summary.is_none() {
                            for line in file_content.lines() {
                                if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                                    if parsed.line_type.as_deref() == Some("summary") {
                                        session_summary = parsed.summary;
                                        break;
                                    }
                                }
                            }
                        }

                        // Second pass: index messages + collect command stats.
                        // A round starts at each real user prompt; tool results inherit
                        // the current round so searches can surface the actual turn.
                        let mut round_index = 0usize;
                        let mut round_prompt = String::new();
                        let mut round_timestamp = String::new();
                        for (line_idx, line) in file_content.lines().enumerate() {
                            if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                                let line_type = parsed.line_type.as_deref();

                                let is_msg_line = matches!(line_type, Some("user") | Some("assistant") | Some("message"));
                                if is_msg_line {
                                    if let Some(msg) = &parsed.message {
                                        let role = msg.role.clone().unwrap_or_default();
                                        if role == "user" || role == "assistant" {
                                            let (text_content, is_tool) = extract_content_with_meta(&msg.content);
                                            let is_meta = parsed.is_meta.unwrap_or(false);
                                            if !is_meta
                                                && !is_tool
                                                && role == "user"
                                                && !text_content.is_empty()
                                            {
                                                round_index += 1;
                                                round_prompt = text_content.clone();
                                                round_timestamp =
                                                    parsed.timestamp.clone().unwrap_or_default();
                                            }

                                            if !is_meta
                                                && !text_content.is_empty()
                                                && !(role == "assistant"
                                                    && is_no_response_placeholder(&text_content))
                                            {
                                                let prompt_text = if role == "user" {
                                                    text_content.clone()
                                                } else {
                                                    String::new()
                                                };
                                                let assistant_text = if role == "assistant" {
                                                    text_content.clone()
                                                } else {
                                                    String::new()
                                                };
                                                let summary_text = session_summary.clone().unwrap_or_default();

                                                index_writer.add_document(doc!(
                                                    uuid_field => parsed.uuid.clone().unwrap_or_default(),
                                                    content_field => text_content,
                                                    title_field => session_title.clone(),
                                                    summary_field => summary_text.clone(),
                                                    last_prompt_field => session_last_prompt.clone(),
                                                    prompt_field => prompt_text.clone(),
                                                    user_field => prompt_text,
                                                    assistant_field => assistant_text,
                                                    project_field => display_path.clone(),
                                                    role_field => role,
                                                    project_id_field => project_id.clone(),
                                                    project_path_field => display_path.clone(),
                                                    session_id_field => session_id.clone(),
                                                    session_summary_field => summary_text,
                                                    timestamp_field => parsed.timestamp.clone().unwrap_or_default(),
                                                    line_number_field => (line_idx + 1) as u64,
                                                    round_index_field => round_index as u64,
                                                    round_prompt_field => round_prompt.clone(),
                                                    round_timestamp_field => round_timestamp.clone(),
                                                )).map_err(|e| e.to_string())?;

                                                indexed_count += 1;
                                            }
                                        }
                                    }
                                }

                                // Collect command stats from any line containing <command-name>
                                // Skip queue-operation entries (internal logs, not actual command invocations)
                                if line.contains("<command-name>") && !line.contains("\"type\":\"queue-operation\"") {
                                    if let Some(ts_str) = &parsed.timestamp {
                                        if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                                            let week_key = ts.format("%Y-W%V").to_string();
                                            for cap in command_pattern.captures_iter(line) {
                                                if let Some(cmd_match) = cap.get(1) {
                                                    let raw_name = cmd_match.as_str().trim_start_matches('/').to_string();
                                                    let name = alias_map.get(&raw_name).cloned().unwrap_or(raw_name);
                                                    command_stats
                                                        .entry(name)
                                                        .or_default()
                                                        .entry(week_key.clone())
                                                        .and_modify(|c| *c += 1)
                                                        .or_insert(1);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        for codex_path in collect_codex_session_paths() {
            let Some(session) = build_codex_session(&codex_path) else {
                continue;
            };
            let messages = match parse_codex_rollout_messages(&codex_path) {
                Ok(messages) => messages,
                Err(_) => continue,
            };
            let project_path = session.project_path.clone().unwrap_or_default();
            let session_title = session.title.clone().unwrap_or_default();
            let session_last_prompt = session.last_prompt.clone().unwrap_or_default();
            let session_summary = session
                .title
                .clone()
                .or_else(|| session.last_prompt.clone())
                .unwrap_or_default();

            let mut round_index = 0usize;
            let mut round_prompt = String::new();
            let mut round_timestamp = String::new();

            for message in messages {
                if message.content.trim().is_empty() {
                    continue;
                }
                if message.role == "user" && !message.is_tool && !message.is_meta {
                    round_index += 1;
                    round_prompt = message.content.clone();
                    round_timestamp = message.timestamp.clone();
                }
                let prompt_text = if message.role == "user" {
                    message.content.clone()
                } else {
                    String::new()
                };
                let assistant_text = if message.role == "assistant" {
                    message.content.clone()
                } else {
                    String::new()
                };

                index_writer.add_document(doc!(
                    uuid_field => message.uuid,
                    content_field => message.content,
                    title_field => session_title.clone(),
                    summary_field => session_summary.clone(),
                    last_prompt_field => session_last_prompt.clone(),
                    prompt_field => prompt_text.clone(),
                    user_field => prompt_text,
                    assistant_field => assistant_text,
                    project_field => project_path.clone(),
                    role_field => message.role,
                    project_id_field => session.project_id.clone(),
                    project_path_field => project_path.clone(),
                    session_id_field => session.id.clone(),
                    session_summary_field => session_summary.clone(),
                    timestamp_field => message.timestamp,
                    line_number_field => message.line_number as u64,
                    round_index_field => round_index as u64,
                    round_prompt_field => round_prompt.clone(),
                    round_timestamp_field => round_timestamp.clone(),
                )).map_err(|e| e.to_string())?;

                indexed_count += 1;
            }
        }

        index_writer.commit().map_err(|e| e.to_string())?;

        let mut guard = SEARCH_INDEX.lock().map_err(|e| e.to_string())?;
        if index_dir.exists() {
            fs::remove_dir_all(&index_dir).map_err(|e| e.to_string())?;
        }
        fs::rename(&build_dir, &index_dir).map_err(|e| e.to_string())?;
        let index = Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?;
        register_jieba_tokenizer(&index);

        // Store search index in global state
        *guard = Some(SearchIndex { index, schema });

        // Write command stats to file
        let stats_path = get_command_stats_path();
        if let Some(parent) = stats_path.parent() {
            fs::create_dir_all(parent).ok();
        }
        let stats_json = serde_json::json!({
            "updated_at": chrono::Utc::now().timestamp(),
            "commands": command_stats,
        });
        fs::write(&stats_path, serde_json::to_string_pretty(&stats_json).unwrap_or_default()).ok();

        Ok(indexed_count)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn tokenize_search_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for ch in query.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        if ch == '\\' {
            current.push(ch);
            escaped = true;
            continue;
        }

        if matches!(ch, '"' | '\'') {
            current.push(ch);
            quote = match quote {
                Some(open) if open == ch => None,
                None => Some(ch),
                other => other,
            };
            continue;
        }

        if quote.is_none() && matches!(ch, '(' | ')') {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            tokens.push(ch.to_string());
            continue;
        }

        if ch.is_whitespace() && quote.is_none() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn split_search_qualifier(token: &str) -> Option<(&str, &str)> {
    let colon = token.find(':')?;
    if colon == 0 || colon + 1 >= token.len() {
        return None;
    }

    let field = &token[..colon];
    if !field
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }

    Some((field, &token[colon + 1..]))
}

fn normalize_scope_name(scope: &str) -> String {
    scope
        .chars()
        .filter(|ch| *ch != '_' && *ch != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

fn canonical_search_field(scope: &str, schema: &Schema) -> Option<&'static str> {
    let field = match normalize_scope_name(scope).as_str() {
        "content" | "body" | "message" | "messages" | "text" => "content",
        "title" | "name" => "title",
        "summary" => "summary",
        "lastprompt" | "latestprompt" => "last_prompt",
        "round" | "roundprompt" | "turn" | "turnprompt" => "round_prompt",
        "prompt" | "prompts" | "user" | "userprompt" | "userprompts" | "question" => "prompt",
        "ai" | "assistant" | "answer" | "response" | "reply" => "assistant",
        "project" | "projectpath" | "path" | "cwd" | "directory" => "project",
        "id" | "session" | "sessionid" => "session_id",
        "uuid" => "uuid",
        "role" => "role",
        _ => return None,
    };

    schema.get_field(field).ok().map(|_| field)
}

fn push_unique_scope(scopes: &mut Vec<&'static str>, scope: &'static str) {
    if !scopes.contains(&scope) {
        scopes.push(scope);
    }
}

fn normalize_query_operator(token: &str) -> Option<&'static str> {
    match token {
        "AND" | "&&" => Some("AND"),
        "OR" | "|" | "||" => Some("OR"),
        "NOT" => Some("NOT"),
        _ => None,
    }
}

fn split_occur_prefix(token: &str) -> (&str, &str) {
    match token.as_bytes().first().copied() {
        Some(b'+') | Some(b'-') if token.len() > 1 => (&token[..1], &token[1..]),
        _ => ("", token),
    }
}

fn scoped_group_token(token: &str, schema: &Schema) -> Option<(String, &'static str)> {
    let (occur, value) = split_occur_prefix(token);
    let field = value.strip_suffix(':')?;
    canonical_search_field(field, schema).map(|scope| (occur.to_string(), scope))
}

fn peel_grouping(token: &str) -> (String, &str, String) {
    let mut start = 0;
    let mut end = token.len();
    let mut prefix = String::new();
    let mut suffix = String::new();

    while start < end && token[start..end].starts_with('(') {
        prefix.push('(');
        start += 1;
    }

    while start < end && token[start..end].ends_with(')') {
        suffix.push(')');
        end -= 1;
    }

    (prefix, &token[start..end], suffix)
}

fn expand_token_for_scopes(token: &str, scopes: &[&'static str]) -> String {
    let (prefix, core, suffix) = peel_grouping(token);
    if core.is_empty() {
        return token.to_string();
    }

    if let Some(operator) = normalize_query_operator(core) {
        return format!("{prefix}{operator}{suffix}");
    }

    if scopes.is_empty() {
        return token.to_string();
    }

    if matches!(core, "+" | "-") {
        return token.to_string();
    }

    let (occur, value) = split_occur_prefix(core);

    if scopes.len() == 1 {
        return format!("{prefix}{occur}{}:{value}{suffix}", scopes[0]);
    }

    let clauses = scopes
        .iter()
        .map(|scope| format!("{scope}:{value}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    format!("{prefix}{occur}({clauses}){suffix}")
}

fn normalize_search_token(
    token: &str,
    default_scopes: &[&'static str],
    schema: &Schema,
) -> Option<String> {
    let (prefix, core, suffix) = peel_grouping(token);
    if core.is_empty() {
        return Some(token.to_string());
    }

    if matches!(core, "+" | "-") {
        return Some(token.to_string());
    }

    let (occur, value) = split_occur_prefix(core);

    if let Some((field, value)) = split_search_qualifier(value) {
        if normalize_scope_name(field) == "in" {
            return None;
        }
        if let Some(canonical) = canonical_search_field(field, schema) {
            return Some(format!("{prefix}{occur}{canonical}:{value}{suffix}"));
        }
    }

    Some(expand_token_for_scopes(token, default_scopes))
}

fn normalize_search_tokens(
    tokens: &[String],
    index: &mut usize,
    default_scopes: &[&'static str],
    schema: &Schema,
) -> Vec<String> {
    let mut normalized = Vec::new();

    while *index < tokens.len() {
        let token = &tokens[*index];
        if token == ")" {
            *index += 1;
            break;
        }

        if let Some((occur, scope)) = scoped_group_token(token, schema) {
            if tokens.get(*index + 1).map(String::as_str) == Some("(") {
                *index += 2;
                let group_scopes = [scope];
                let inner = normalize_search_tokens(tokens, index, &group_scopes, schema);
                normalized.push(format!("{occur}({})", inner.join(" ")));
                continue;
            }
        }

        if token == "(" {
            *index += 1;
            let inner = normalize_search_tokens(tokens, index, default_scopes, schema);
            normalized.push(format!("({})", inner.join(" ")));
            continue;
        }

        if let Some(value) = normalize_search_token(token, default_scopes, schema) {
            normalized.push(value);
        }
        *index += 1;
    }

    normalized
}

fn normalize_scoped_search_query(query: &str, schema: &Schema) -> String {
    let tokens = tokenize_search_query(query);
    let mut default_scopes = Vec::new();

    for token in &tokens {
        let Some((field, value)) = split_search_qualifier(token) else {
            continue;
        };
        if normalize_scope_name(field) != "in" {
            continue;
        }

        for scope in value.split(',') {
            if let Some(canonical) = canonical_search_field(scope.trim(), schema) {
                push_unique_scope(&mut default_scopes, canonical);
            }
        }
    }

    let mut index = 0;
    let normalized =
        normalize_search_tokens(&tokens, &mut index, &default_scopes, schema).join(" ");

    if normalized.trim().is_empty() {
        query.trim().to_string()
    } else {
        normalized
    }
}

#[tauri::command]
pub(crate) fn search_chats(
    query: String,
    limit: Option<usize>,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let max_results = limit.unwrap_or(50);

    // Try to get index from global state or load from disk
    let mut guard = SEARCH_INDEX.lock().map_err(|e| e.to_string())?;

    if guard.is_none() {
        let index_dir = get_index_dir();
        if !index_dir.exists() {
            return Err("Search index not built. Please build index first.".to_string());
        }

        let index = Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?;
        let schema = index.schema();
        // Register jieba tokenizer for Chinese support
        register_jieba_tokenizer(&index);
        *guard = Some(SearchIndex { index, schema });
    }

    let search_index = guard.as_ref().unwrap();
    let reader = search_index
        .index
        .reader_builder()
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()
        .map_err(|e: tantivy::TantivyError| e.to_string())?;

    let searcher = reader.searcher();

    let default_fields = [
        "content",
        "session_summary",
        "title",
        "summary",
        "last_prompt",
        "round_prompt",
    ]
    .iter()
    .filter_map(|name| search_index.schema.get_field(name).ok())
    .collect::<Vec<_>>();

    let normalized_query = normalize_scoped_search_query(&query, &search_index.schema);
    let mut query_parser = QueryParser::for_index(&search_index.index, default_fields);
    query_parser.set_conjunction_by_default();
    if let Ok(title_field) = search_index.schema.get_field("title") {
        query_parser.set_field_boost(title_field, 2.0);
    }
    if let Ok(prompt_field) = search_index.schema.get_field("prompt") {
        query_parser.set_field_boost(prompt_field, 1.4);
    }
    if let Ok(round_prompt_field) = search_index.schema.get_field("round_prompt") {
        query_parser.set_field_boost(round_prompt_field, 1.2);
    }
    let parsed_query = query_parser
        .parse_query(&normalized_query)
        .map_err(|e| e.to_string())?;

    let top_docs = searcher
        .search(&parsed_query, &TopDocs::with_limit(max_results))
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();

    for (score, doc_address) in top_docs {
        let retrieved_doc: tantivy::TantivyDocument =
            searcher.doc(doc_address).map_err(|e| e.to_string())?;

        let get_text = |field_name: &str| -> String {
            search_index
                .schema
                .get_field(field_name)
                .ok()
                .and_then(|field| retrieved_doc.get_first(field))
                .and_then(|v| TantivyValue::as_str(&v))
                .unwrap_or("")
                .to_string()
        };
        let get_u64 = |field_name: &str| -> u64 {
            search_index
                .schema
                .get_field(field_name)
                .ok()
                .and_then(|field| retrieved_doc.get_first(field))
                .and_then(|v| TantivyValue::as_u64(&v))
                .unwrap_or(0)
        };

        let doc_project_id = get_text("project_id");

        // Filter by project_id if specified
        if let Some(ref filter_id) = project_id {
            if &doc_project_id != filter_id {
                continue;
            }
        }

        let summary = get_text("session_summary");
        let title = get_text("title");
        let scoped_summary = get_text("summary");
        let last_prompt = get_text("last_prompt");
        let round_prompt = get_text("round_prompt");
        let round_timestamp = get_text("round_timestamp");

        results.push(SearchResult {
            uuid: get_text("uuid"),
            content: get_text("content"),
            role: get_text("role"),
            line_number: get_u64("line_number") as usize,
            project_id: doc_project_id,
            project_path: get_text("project_path"),
            session_id: get_text("session_id"),
            session_summary: if summary.is_empty() {
                None
            } else {
                Some(summary)
            },
            title: if title.is_empty() { None } else { Some(title) },
            summary: if scoped_summary.is_empty() {
                None
            } else {
                Some(scoped_summary)
            },
            last_prompt: if last_prompt.is_empty() {
                None
            } else {
                Some(last_prompt)
            },
            round_index: get_u64("round_index") as usize,
            round_prompt: if round_prompt.is_empty() {
                None
            } else {
                Some(round_prompt)
            },
            round_timestamp: if round_timestamp.is_empty() {
                None
            } else {
                Some(round_timestamp)
            },
            timestamp: get_text("timestamp"),
            score,
        });
    }

    Ok(results)
}

pub(crate) fn summarize_tool_input(name: &str, input: &serde_json::Value) -> String {
    let obj = match input.as_object() {
        Some(o) => o,
        None => return String::new(),
    };
    let first_string = |keys: &[&str]| -> String {
        for key in keys {
            if let Some(v) = obj.get(*key).and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    return v.to_string();
                }
            }
        }
        String::new()
    };

    match name {
        "Read" | "Write" => obj
            .get("file_path")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("path").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string(),
        "Edit" | "MultiEdit" => {
            let path = obj
                .get("file_path")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("path").and_then(|v| v.as_str()))
                .unwrap_or("");
            let old = obj.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
            if old.is_empty() {
                path.to_string()
            } else {
                format!(
                    "{} ({}...)",
                    path,
                    &old.chars().take(40).collect::<String>()
                )
            }
        }
        "Bash" | "exec_command" => obj
            .get("command")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("cmd").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string(),
        "Grep" => obj
            .get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Glob" => obj
            .get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Task" => first_string(&["description", "subject", "prompt"]),
        "WebFetch" => obj
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "WebSearch" => obj
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "ToolSearch" => first_string(&["query"]),
        "Skill" => {
            let skill = first_string(&["skill", "name"]);
            let args = first_string(&["args", "prompt", "description"]);
            if skill.is_empty() {
                args
            } else if args.is_empty() {
                skill
            } else {
                format!("{} {}", skill, args)
            }
        }
        "Agent" => first_string(&["description", "subagent_type", "prompt"]),
        "TaskCreate" => first_string(&["subject", "activeForm", "description"]),
        "TaskUpdate" => {
            let id = first_string(&["taskId", "id"]);
            let status = first_string(&["status"]);
            match (id.is_empty(), status.is_empty()) {
                (false, false) => format!("{} -> {}", id, status),
                (false, true) => id,
                (true, false) => status,
                (true, true) => String::new(),
            }
        }
        "TaskList" => "tasks".to_string(),
        "TaskStop" => first_string(&["taskId", "id", "reason"]),
        "TodoWrite" | "TaskRead" => first_string(&["description", "subject", "prompt"]),
        "AskUserQuestion" => first_string(&["question", "header", "description"]),
        _ => {
            // Try common field names
            for key in &[
                "skill",
                "name",
                "subject",
                "title",
                "file_path",
                "path",
                "command",
                "query",
                "pattern",
                "url",
                "description",
                "prompt",
                "args",
            ] {
                if let Some(v) = obj.get(*key).and_then(|v| v.as_str()) {
                    return v.to_string();
                }
            }
            String::new()
        }
    }
}

pub(crate) fn truncate_chars(text: String, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text;
    }
    let mut out = text.chars().take(max_chars).collect::<String>();
    out.push_str("\n... truncated ...");
    out
}

pub(crate) fn json_preview(value: &serde_json::Value, max_chars: usize) -> String {
    let text = match value {
        serde_json::Value::String(s) => s.clone(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    };
    truncate_chars(text, max_chars)
}

pub(crate) fn tool_action_text(name: &str) -> &str {
    match name {
        "Read" => "Read",
        "Write" => "Wrote",
        "Edit" | "MultiEdit" => "Edited",
        "Bash" | "exec_command" => "Ran",
        "Grep" | "Glob" | "WebSearch" => "Searched",
        "WebFetch" => "Fetched",
        "ToolSearch" => "Searched tools",
        "Skill" => "Used skill",
        "Agent" => "Started agent",
        "TaskCreate" => "Created task",
        "TaskUpdate" => "Updated task",
        "TaskList" => "Listed tasks",
        "TaskStop" => "Stopped task",
        "TodoWrite" | "Task" | "TaskRead" => "Updated tasks",
        "AskUserQuestion" => "Asked user",
        "EnterPlanMode" => "Entered plan mode",
        "ExitPlanMode" => "Exited plan mode",
        "ScheduleWakeup" => "Scheduled wakeup",
        "Monitor" => "Started monitor",
        _ => name,
    }
}

pub(crate) fn content_blocks_to_text(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            ContentBlock::ToolUse { name, summary, .. } => {
                let action = tool_action_text(name);
                let trimmed = summary.trim();
                if trimmed.is_empty() {
                    Some(action.to_string())
                } else {
                    Some(format!("{} {}", action, trimmed))
                }
            }
            ContentBlock::ToolResult { content, .. } => {
                let trimmed = content.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            ContentBlock::Thinking { thinking } => {
                let trimmed = thinking.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn summarize_tool_result_item(value: &serde_json::Value) -> Option<String> {
    let obj = value.as_object()?;
    match obj.get("type").and_then(|v| v.as_str()) {
        Some("text") => obj
            .get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        Some("tool_reference") => obj
            .get("tool_name")
            .and_then(|v| v.as_str())
            .map(|name| format!("tool_reference: {}", name)),
        Some("image") => Some("[image result]".to_string()),
        Some(other) => Some(format!("{}: {}", other, json_preview(value, 800))),
        None => Some(json_preview(value, 800)),
    }
}

pub(crate) fn tool_result_raw_preview(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(_) => None,
        serde_json::Value::Array(arr) => {
            let lines = arr
                .iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    match obj.get("type").and_then(|v| v.as_str()) {
                        Some("text") => None,
                        Some("image") => Some("[image result: base64 omitted]".to_string()),
                        _ => summarize_tool_result_item(item),
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if lines.trim().is_empty() {
                None
            } else {
                Some(lines)
            }
        }
        serde_json::Value::Object(_) => Some(json_preview(value, 6000)),
        _ => None,
    }
}

pub(crate) fn extract_tool_result_images(
    value: &serde_json::Value,
) -> Option<Vec<ToolResultImage>> {
    let serde_json::Value::Array(arr) = value else {
        return None;
    };

    let images = arr
        .iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            if obj.get("type").and_then(|v| v.as_str()) != Some("image") {
                return None;
            }

            let source = obj.get("source")?.as_object()?;
            if source.get("type").and_then(|v| v.as_str()) != Some("base64") {
                return None;
            }

            let data = source.get("data").and_then(|v| v.as_str())?.to_string();
            if data.is_empty() {
                return None;
            }

            let media_type = source
                .get("media_type")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("media_type").and_then(|v| v.as_str()))
                .filter(|s| s.starts_with("image/"))
                .unwrap_or("image/png")
                .to_string();
            let original_size = source
                .get("originalSize")
                .and_then(|v| v.as_u64())
                .or_else(|| source.get("original_size").and_then(|v| v.as_u64()))
                .or_else(|| obj.get("originalSize").and_then(|v| v.as_u64()))
                .or_else(|| obj.get("original_size").and_then(|v| v.as_u64()));

            Some(ToolResultImage {
                media_type,
                data,
                original_size,
            })
        })
        .collect::<Vec<_>>();

    if images.is_empty() {
        None
    } else {
        Some(images)
    }
}

pub(crate) fn extract_tool_result_content(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(summarize_tool_result_item)
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(_) => json_preview(value, 1200),
        _ => String::new(),
    }
}

pub(crate) fn extract_content_blocks(
    value: &Option<serde_json::Value>,
) -> Option<Vec<ContentBlock>> {
    let arr = match value {
        Some(serde_json::Value::Array(arr)) => arr,
        Some(serde_json::Value::String(s)) => {
            return Some(vec![ContentBlock::Text { text: s.clone() }]);
        }
        _ => return None,
    };

    let blocks: Vec<ContentBlock> = arr
        .iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            let block_type = obj.get("type").and_then(|v| v.as_str())?;
            match block_type {
                "text" | "input_text" | "output_text" => {
                    let text = obj.get("text").and_then(|v| v.as_str())?.to_string();
                    if text.is_empty() {
                        None
                    } else {
                        Some(ContentBlock::Text { text })
                    }
                }
                "tool_use" => {
                    let id = obj
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = obj
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input = obj.get("input").cloned().unwrap_or(serde_json::Value::Null);
                    let summary = summarize_tool_input(&name, &input);
                    let input = if input.is_null() {
                        None
                    } else {
                        Some(json_preview(&input, 6000))
                    };
                    Some(ContentBlock::ToolUse {
                        id,
                        name,
                        summary,
                        input,
                    })
                }
                "tool_result" => {
                    let tool_use_id = obj
                        .get("tool_use_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let content = obj
                        .get("content")
                        .map(|v| extract_tool_result_content(v))
                        .unwrap_or_default();
                    let images = obj.get("content").and_then(extract_tool_result_images);
                    let raw = obj.get("content").and_then(tool_result_raw_preview);
                    let raw = raw.filter(|s| {
                        let trimmed = s.trim();
                        !trimmed.is_empty() && trimmed != content.trim()
                    });
                    Some(ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                        images,
                        raw,
                    })
                }
                "thinking" => {
                    let thinking = obj
                        .get("thinking")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if thinking.is_empty() {
                        None
                    } else {
                        Some(ContentBlock::Thinking { thinking })
                    }
                }
                _ => None,
            }
        })
        .collect();

    if blocks.is_empty() {
        None
    } else {
        Some(blocks)
    }
}

pub(crate) fn extract_content_with_meta(value: &Option<serde_json::Value>) -> (String, bool) {
    match value {
        Some(serde_json::Value::String(s)) => (s.clone(), false),
        Some(serde_json::Value::Array(arr)) => {
            // Check if array contains tool_use or tool_result
            let has_tool = arr.iter().any(|item| {
                if let Some(obj) = item.as_object() {
                    let t = obj.get("type").and_then(|v| v.as_str());
                    return t == Some("tool_use") || t == Some("tool_result");
                }
                false
            });

            let text = arr
                .iter()
                .filter_map(|item| {
                    if let Some(obj) = item.as_object() {
                        if matches!(
                            obj.get("type").and_then(|v| v.as_str()),
                            Some("text") | Some("input_text") | Some("output_text")
                        ) {
                            return obj.get("text").and_then(|v| v.as_str()).map(String::from);
                        }
                    }
                    None
                })
                .collect::<Vec<_>>()
                .join("\n");

            (text, has_tool)
        }
        _ => (String::new(), false),
    }
}
