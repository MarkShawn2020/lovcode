use super::*;

#[derive(Debug, Eq, PartialEq)]
enum CliRequest {
    Version,
    Search { query: String, limit: usize },
}

pub(crate) fn run_cli_if_requested() -> Option<i32> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let request = parse_cli_request(&args)?;

    Some(match request {
        Ok(CliRequest::Version) => {
            println!("lovcode {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Ok(CliRequest::Search { query, limit }) => {
            match search_chats(query, Some(limit), None).and_then(|results| {
                serde_json::to_string(&results).map_err(|error| error.to_string())
            }) {
                Ok(json) => {
                    println!("{json}");
                    0
                }
                Err(error) => {
                    eprintln!("Lovcode search failed: {error}");
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
        return None;
    }

    let mut query_parts = Vec::new();
    let mut limit = 50usize;
    let mut index = 1usize;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => {
                index += 1;
            }
            "--limit" => {
                let Some(value) = args.get(index + 1) else {
                    return Some(Err(
                        "Usage: lovcode search <query> --json [--limit N]".to_string()
                    ));
                };
                match value.parse::<usize>() {
                    Ok(value) if (1..=200).contains(&value) => limit = value,
                    _ => {
                        return Some(Err(
                            "Lovcode search limit must be between 1 and 200.".to_string()
                        ));
                    }
                }
                index += 2;
            }
            value if value.starts_with('-') => {
                return Some(Err(format!("Unknown Lovcode search option: {value}")));
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
            "Usage: lovcode search <query> --json [--limit N]".to_string()
        ));
    }
    Some(Ok(CliRequest::Search { query, limit }))
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
    }
}
