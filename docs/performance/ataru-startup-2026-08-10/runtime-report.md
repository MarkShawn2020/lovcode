# Ataru foreground open and reload responsiveness

Verdict: `partially_verified`

Safety: `read_only_plan; no process termination or file deletion performed`

## Scope

- **platform_family:** desktop
- **runtime:** Tauri 2 + React 19 + WKWebView on macOS 26.6
- **workload:** Foreground main-window reload in pnpm tauri dev with an already-ready Tantivy chat index
- **host_adapter:** macOS ps, sample, Accessibility and screenshot
- **runtime_adapter:** Tauri IPC, Tokio blocking pool, React external store and WKWebView
- **build:** debug binary from HEAD d4ce0de plus the dirty working-tree patch
- **profile_scope:** All app-optimizer module profiles loaded; language zh-CN and timezone Asia/Shanghai; no retained optimization preferences

## Evidence ledger

| Stage | Kind | Metric | Value | Source |
| --- | --- | --- | ---: | --- |
| before | measurement | before-indexed-session-count | 2200 sessions | search index manifest summary — The pre-change ready index represented 655739 messages and 9335769619 source bytes. |
| after | measurement | after-indexed-session-count | 2201 sessions | search index manifest summary — The live corpus grew during the work to 656300 messages and 9360440931 source bytes, so CPU comparisons are directional rather than strict paired A/B. |
| before | code_fact | main-webview-status-consumers | 3 mounted consumers | React call sites — AtaruSearchPage, GlobalChatSearch and StatusBar each mounted an independent status request, event listener and build poller; the search overlay added a fourth consumer in its own WebView. |
| after | code_fact | main-webview-status-store | 1 shared stores per WebView | post-fix React external store — All hook consumers in one JavaScript context now share one initial request, one Tauri event listener and one polling timer. |
| before | inference | cold-status-request-amplification | 3 synchronous status requests per main WebView mount | React ownership graph and Tauri command call chain — Each request could deserialize the 1.7 MB manifest, open Tantivy and recursively size the index before returning. |
| before | measurement | ui-main-thread-index-status-samples | 100 1 ms native samples | macOS sample call graph — Two synchronous get_search_index_status invocations occupied 61 and 39 main-thread samples; 80 samples were in manifest loading and 18 in Tantivy open paths. |
| after | acceptance | ui-main-thread-index-status-samples | 0 1 ms native samples | two post-fix macOS sample call graphs — Neither repeated 8-second trace contained current_search_index_status, manifest loading or Tantivy opening on the UI main thread; the remaining metadata check ran on a Tokio blocking worker. |
| after | measurement | after-ready-ui-capture-time | 1 seconds after reload trigger | foreground screenshot — The application shell, search input, recent queries and Index ready state were visible in the one-second capture. |
| after | measurement | after-index-integrity-state | ready application state | live status bar and manifest metadata — Both final reloads retained Index ready, did not create search-index-building, and left the manifest timestamp unchanged at 1786373226. |

## Before/after comparisons

| Metric | Before | After | Delta | Change | Evidence quality | Contract note |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| ui-main-thread-index-status-samples | 100 1 ms native samples | 0 1 ms native samples | n/a | n/a | directional_evidence | The post-change corpus was 0.3 percent larger and the trace windows were longer, so the helper must suppress an exact percentage delta. |

## Reclamation plan

No resource cleanup plan was supplied.

## Ranked hypotheses

- **P0 · synchronous-index-status-io:** Independent mount-time index status consumers amplified ready-state verification into repeated manifest, Tantivy and directory I/O on the Tauri UI main thread.
  - Supports: main-webview-status-consumers, cold-status-request-amplification, ui-main-thread-index-status-samples
  - Falsifier: A pre-change native trace shows get_search_index_status returning without manifest or Tantivy work on the main thread, or the root surface mounts only one status consumer.
- **P1 · residual-development-load:** Residual CPU after the first paint is dominated by development-mode module loading and existing session/project streaming rather than search-index status hydration.
  - Supports: after-ready-ui-capture-time, after-index-integrity-state, ui-main-thread-index-status-samples
  - Falsifier: A post-fix main-thread trace again places manifest loading or Tantivy opening below get_search_index_status, or a packaged release reproduces the same delayed module-serving workload.

## Correctness and release gates

- **passed · TypeScript typecheck:** Correctness gate only; completed without diagnostics. (`pnpm exec tsc --noEmit --pretty false`)
- **passed · Rust formatting:** Formatting gate only; completed without differences. (`cargo fmt --all -- --check`)
- **passed · Live Tauri dev compilation and relaunch:** The existing development runtime compiled the Rust patch, launched the patched binary and served the patched React code. (`pnpm tauri dev watcher, target/debug/lovcode`)
- **passed · Search index safety readback:** Index ready remained visible, the manifest was not rewritten and no build directory appeared. (`two final live foreground reloads`)
- **not_run · Packaged release startup trial:** The repository explicitly says not to run pnpm build or equivalent while pnpm tauri dev is active. (`repository AGENTS.md build constraint`)

## Evidence gaps

- No packaged release startup trace was collected; this prevents a verified terminal status for a desktop optimization.
- The live chat corpus grew from 2200 to 2201 sessions during the work, so CPU figures are directional and are not reported as an exact A/B delta.
- No direct input-latency distribution or field telemetry exists; the one-second visual readback is a lab observation, not RUM.
- Development-mode Vite module serving and session/project streaming still create residual background CPU after first paint and require a separate workload if they remain user-visible in a packaged build.

## Warnings

- ui-main-thread-index-status-samples: comparison quality is directional_evidence; exact delta suppressed
