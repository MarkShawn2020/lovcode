//! HTTP server — axum. Used by the web UI and external clients.

use anyhow::Result;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use axum::routing::get;
use axum::Router;
use clap::Args as ClapArgs;
use lovcode_core::adapter::builtin_adapters;
use lovcode_core::detail;
use lovcode_core::index::LovcodeIndex;
use lovcode_core::query;
use lovcode_core::types::{Conversation, SearchQuery, SearchResult};
use serde::Deserialize;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

#[derive(ClapArgs)]
pub struct Args {
    #[arg(long, default_value_t = 7878)]
    pub port: u16,

    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    /// Allow CORS from any origin (off by default).
    #[arg(long)]
    pub cors: bool,
}

#[derive(Clone)]
struct AppState {
    index: Arc<LovcodeIndex>,
}

pub fn run(index_dir: &Path, args: Args) -> Result<()> {
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(serve(index_dir, args))
}

async fn serve(index_dir: &Path, args: Args) -> Result<()> {
    let index = Arc::new(LovcodeIndex::open_or_create(index_dir)?);
    let state = AppState { index };

    let mut router = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/sources", get(list_sources))
        .route("/search", get(do_search))
        .route("/conversation/{id}", get(get_conversation))
        .with_state(state);

    if args.cors {
        router = router.layer(CorsLayer::permissive());
    }

    let host: IpAddr = args.host.parse()?;
    let addr = SocketAddr::new(host, args.port);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    eprintln!("lovcode serving on http://{addr}");
    axum::serve(listener, router).await?;
    Ok(())
}

#[derive(Deserialize)]
struct SearchParams {
    q: String,
    source: Option<String>,
    project: Option<String>,
    since: Option<String>,
    limit: Option<usize>,
}

async fn do_search(
    State(s): State<AppState>,
    Query(p): Query<SearchParams>,
) -> Result<Json<Vec<SearchResult>>, (StatusCode, String)> {
    let q = SearchQuery {
        q: p.q,
        source: p.source,
        project: p.project,
        since: p.since.as_deref().and_then(query::parse_since),
        until: None,
        role: None,
        limit: p.limit,
    };
    let r = query::search(&s.index, &q).map_err(internal)?;
    Ok(Json(r))
}

async fn get_conversation(
    State(s): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Conversation>, (StatusCode, String)> {
    detail::get_conversation(&s.index, &id)
        .map(Json)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))
}

async fn list_sources() -> Json<Vec<serde_json::Value>> {
    let out = builtin_adapters()
        .iter()
        .map(|a| {
            let count = a.discover().map(|v| v.len()).unwrap_or(0);
            serde_json::json!({
                "id": a.id(),
                "name": a.name(),
                "count": count,
            })
        })
        .collect();
    Json(out)
}

fn internal(e: anyhow::Error) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
