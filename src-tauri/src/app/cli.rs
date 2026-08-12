use super::*;

#[derive(Debug, Eq, PartialEq)]
enum CliRequest {
    Version,
    Search {
        query: String,
        limit: usize,
        level: Option<ataru::sdk::SearchLevel>,
    },
    ReadSession {
        project_id: String,
        session_id: String,
    },
}

pub(crate) fn run_cli_if_requested() -> Option<i32> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let request = parse_cli_request(&args)?;

    Some(match request {
        Ok(CliRequest::Version) => {
            println!("ataru {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Ok(CliRequest::Search {
            query,
            limit,
            level,
        }) => {
            let result = if let Some(level) = level {
                ataru::api::ataru_keyword_search(ataru::sdk::SearchRequest {
                    query,
                    level,
                    mode: ataru::sdk::SearchMode::Keyword,
                    limit,
                    project_id: None,
                })
                .and_then(|response| {
                    serde_json::to_string(&response).map_err(|error| error.to_string())
                })
            } else {
                search_chats(query, Some(limit), None).and_then(|results| {
                    serde_json::to_string(&results).map_err(|error| error.to_string())
                })
            };
            match result {
                Ok(json) => {
                    println!("{json}");
                    0
                }
                Err(error) => {
                    eprintln!("Ataru search failed: {error}");
                    1
                }
            }
        }
        Ok(CliRequest::ReadSession {
            project_id,
            session_id,
        }) => {
            let result = read_session_messages(&project_id, &session_id)
                .map(|messages| {
                    messages
                        .into_iter()
                        .filter(|message| !message.is_meta)
                        .collect::<Vec<_>>()
                })
                .and_then(|messages| {
                    serde_json::to_string(&messages).map_err(|error| error.to_string())
                });
            match result {
                Ok(json) => {
                    println!("{json}");
                    0
                }
                Err(error) => {
                    eprintln!("Ataru session read failed: {error}");
                    1
                }
            }
        }
        Err(error) => {
            eprintln!("{error}");
            2
        }
    })
}

fn parse_cli_request(args: &[String]) -> Option<Result<CliRequest, String>> {
    let command = args.first()?.as_str();
    if matches!(command, "--version" | "-V") {
        return Some(Ok(CliRequest::Version));
    }
    if command != "search" {
        if command == "session" {
            return Some(parse_session_request(args));
        }
        return None;
    }

    let mut query_parts = Vec::new();
    let mut limit = 50usize;
    let mut level = None;
    let mut index = 1usize;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => {
                index += 1;
            }
            "--limit" => {
                let Some(value) = args.get(index + 1) else {
                    return Some(Err(
                        "Usage: ataru search <query> --json [--limit N]".to_string()
                    ));
                };
                match value.parse::<usize>() {
                    Ok(value) if (1..=200).contains(&value) => limit = value,
                    _ => {
                        return Some(Err(
                            "Ataru search limit must be between 1 and 200.".to_string()
                        ));
                    }
                }
                index += 2;
            }
            "--level" => {
                let Some(value) = args.get(index + 1) else {
                    return Some(Err(
                        "Usage: ataru search <query> --json [--limit N] [--level turn|run|session|project]"
                            .to_string(),
                    ));
                };
                level = match value.as_str() {
                    "turn" => Some(ataru::sdk::SearchLevel::Turn),
                    "run" | "round" => Some(ataru::sdk::SearchLevel::Run),
                    "session" => Some(ataru::sdk::SearchLevel::Session),
                    "project" => Some(ataru::sdk::SearchLevel::Project),
                    _ => {
                        return Some(Err(
                            "Ataru search level must be turn, run, session, or project."
                                .to_string(),
                        ));
                    }
                };
                index += 2;
            }
            value if value.starts_with('-') => {
                return Some(Err(format!("Unknown Ataru search option: {value}")));
            }
            value => {
                query_parts.push(value);
                index += 1;
            }
        }
    }

    let query = query_parts.join(" ").trim().to_string();
    if query.is_empty() {
        return Some(Err(
            "Usage: ataru search <query> --json [--limit N]".to_string()
        ));
    }
    if level.is_some() && limit > 100 {
        return Some(Err(
            "Ataru aggregated search limit must be between 1 and 100.".to_string(),
        ));
    }
    Some(Ok(CliRequest::Search {
        query,
        limit,
        level,
    }))
}

fn parse_session_request(args: &[String]) -> Result<CliRequest, String> {
    if args.get(1).map(String::as_str) != Some("read") {
        return Err(
            "Usage: ataru session read --project-id PROJECT_ID --session-id SESSION_ID --json"
                .to_string(),
        );
    }

    let mut project_id = None;
    let mut session_id = None;
    let mut index = 2usize;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => index += 1,
            "--project-id" => {
                let Some(value) = args.get(index + 1) else {
                    return Err(
                        "Usage: ataru session read --project-id PROJECT_ID --session-id SESSION_ID --json"
                            .to_string(),
                    );
                };
                if value.is_empty() {
                    return Err("Ataru session project id must not be empty.".to_string());
                }
                project_id = Some(value.clone());
                index += 2;
            }
            "--session-id" => {
                let Some(value) = args.get(index + 1) else {
                    return Err(
                        "Usage: ataru session read --project-id PROJECT_ID --session-id SESSION_ID --json"
                            .to_string(),
                    );
                };
                if value.is_empty() {
                    return Err("Ataru session id must not be empty.".to_string());
                }
                session_id = Some(value.clone());
                index += 2;
            }
            value => return Err(format!("Unknown Ataru session read option: {value}")),
        }
    }

    let Some(project_id) = project_id else {
        return Err("Ataru session read requires --project-id PROJECT_ID.".to_string());
    };
    let Some(session_id) = session_id else {
        return Err("Ataru session read requires --session-id SESSION_ID.".to_string());
    };

    Ok(CliRequest::ReadSession {
        project_id,
        session_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn parses_version_and_global_search_requests() {
        assert_eq!(
            parse_cli_request(&args(&["--version"])),
            Some(Ok(CliRequest::Version))
        );
        assert_eq!(
            parse_cli_request(&args(&[
                "search", "global", "session", "--json", "--limit", "80"
            ])),
            Some(Ok(CliRequest::Search {
                query: "global session".to_string(),
                limit: 80,
                level: None,
            }))
        );
        assert_eq!(
            parse_cli_request(&args(&[
                "search", "ranking", "--json", "--level", "project"
            ])),
            Some(Ok(CliRequest::Search {
                query: "ranking".to_string(),
                limit: 50,
                level: Some(ataru::sdk::SearchLevel::Project),
            }))
        );
        assert_eq!(
            parse_cli_request(&args(&[
                "session",
                "read",
                "--project-id",
                "-Users-mark-projects-ataru",
                "--session-id",
                "session-123",
                "--json",
            ])),
            Some(Ok(CliRequest::ReadSession {
                project_id: "-Users-mark-projects-ataru".to_string(),
                session_id: "session-123".to_string(),
            }))
        );
    }

    #[test]
    fn leaves_desktop_arguments_untouched_and_rejects_invalid_searches() {
        assert_eq!(parse_cli_request(&args(&["--some-tauri-argument"])), None);
        assert!(matches!(
            parse_cli_request(&args(&["search", "--json"])),
            Some(Err(_))
        ));
        assert!(matches!(
            parse_cli_request(&args(&["search", "query", "--limit", "0"])),
            Some(Err(_))
        ));
        assert!(matches!(
            parse_cli_request(&args(&[
                "search", "query", "--limit", "101", "--level", "session"
            ])),
            Some(Err(_))
        ));
        assert!(matches!(
            parse_cli_request(&args(&["search", "query", "--limit", "200"])),
            Some(Ok(CliRequest::Search { level: None, .. }))
        ));
        assert!(matches!(
            parse_cli_request(&args(&["session", "read", "--project-id", "project"])),
            Some(Err(_))
        ));
    }
}
