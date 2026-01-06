# Feature Proposal: Session Token Statistics & Cost Tracking

**Issue**: #11
**Status**: Research Complete
**Priority**: P1 (High)
**Effort**: ~5-8 days

## Overview

Add comprehensive token usage and cost tracking to Lovcode's chat history viewer, enabling users to:
- View token counts (input/output/cache) per session
- Track costs per session and project
- Monitor global usage statistics across all projects

## Research Summary

### Data Sources Available

1. **Claude Code JSONL Files** (Recommended)
   - Location: `~/.claude/projects/{project_id}/{session_id}.jsonl`
   - Contains `usage` and `cost` fields per API call
   - Supports offline analysis of historical data

2. **Claude Code Status Line API**
   - Provides real-time session statistics
   - Requires Claude Code CLI installation
   - Higher latency for batch queries

3. **OpenTelemetry Events**
   - Enterprise-grade monitoring
   - Overkill for desktop app use case

**Recommendation**: Parse JSONL files with optional fallback to Status Line API

## Technical Design

### Backend Changes (Rust)

**File**: `src-tauri/src/lib.rs`

```rust
// Extended data structures
#[derive(Debug, Serialize, Deserialize)]
pub struct Session {
    // ... existing fields ...
    pub usage: Option<SessionUsage>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SessionUsage {
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub total_cost_usd: f64,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawLine {
    // ... existing fields ...
    usage: Option<UsageData>,
    cost: Option<f64>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UsageData {
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
    cache_read_input_tokens: Option<u32>,
    cache_creation_input_tokens: Option<u32>,
}
```

**New Tauri Commands**:
- `get_project_usage(project_id: String) -> Result<ProjectUsage, String>`
- `get_global_usage() -> Result<GlobalUsage, String>`

### Frontend Changes (TypeScript)

**File**: `src/types/index.ts`

```typescript
export interface Session {
  // ... existing fields ...
  usage?: SessionUsage;
}

export interface SessionUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
  model?: string;
}

export interface ProjectUsage {
  project_id: string;
  total_sessions: number;
  total_cost_usd: number;
  total_tokens: number;
  breakdown: {
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
  };
}
```

## UI/UX Design

Following **Lovstudio Warm Academic Style (暖学术风格)**:

### 1. Session List Cards Enhancement

**Location**: `src/views/Chat/SessionList.tsx`

Add token/cost metadata below session title:
```
┌─────────────────────────────────────────────┐
│ Fix authentication bug in login flow       │
│ 💬 12 msgs  📊 15,234 tokens  💰 $0.0123  │
│                            2 hours ago →    │
└─────────────────────────────────────────────┘
```

**Implementation**:
```tsx
<div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
  <span>{session.message_count} msgs</span>
  {session.usage && (
    <>
      <span>{session.usage.total_input_tokens + session.usage.total_output_tokens} tokens</span>
      <span className="text-primary">${session.usage.total_cost_usd.toFixed(4)}</span>
    </>
  )}
</div>
```

### 2. Project Statistics Card

Add summary card in SessionList header showing:
- Total sessions count
- Total tokens consumed
- Total cost
- Token breakdown chart (input/output/cache)

### 3. Session Detail Cost Badge

Add cost badge in MessageView header:
```
┌──────────────────┐
│ Session Cost     │
│  $0.0123         │
│  15,234 tokens   │
└──────────────────┘
```

### 4. Global Usage View

New page: `src/views/Usage/GlobalUsageView.tsx`

Features:
- Overview cards (total cost, tokens, sessions, projects)
- Project-wise cost breakdown table
- Sortable by cost/tokens/sessions
- Export functionality (CSV/JSON)

## Implementation Phases

### Phase 1: Backend Data Parsing (P0)

**Duration**: 2-3 days

- [ ] Extend Rust data structures
- [ ] Parse JSONL `usage` fields in `list_sessions`
- [ ] Implement token accumulation logic
- [ ] Add `get_project_usage` command
- [ ] Add `get_global_usage` command
- [ ] Implement caching for performance

### Phase 2: Frontend Integration (P1)

**Duration**: 2-3 days

- [ ] Extend TypeScript types
- [ ] Update SessionList cards with token/cost
- [ ] Add project statistics card
- [ ] Update MessageView header
- [ ] Create GlobalUsageView page
- [ ] Add navigation menu item

### Phase 3: Advanced Features (P2)

**Duration**: 3-5 days (Optional)

- [ ] Export usage reports (CSV/JSON)
- [ ] Cost trend charts (using recharts)
- [ ] Budget alerts
- [ ] Model comparison analytics
- [ ] Cache efficiency visualization

## Technical Challenges & Solutions

### Challenge 1: JSONL Format Compatibility

**Issue**: Claude Code's internal format may change

**Solution**: Use optional fields with graceful degradation
```rust
usage: Option<UsageData>,  // Returns None if field missing
```

### Challenge 2: Historical Data

**Issue**: Old sessions may lack usage data

**Solution**:
- UI shows "N/A" when data unavailable
- Provide manual reindex trigger

### Challenge 3: Performance

**Issue**: Large projects (1000+ sessions) slow to parse

**Solution**:
```rust
// 1. Incremental parsing (only new/modified files)
// 2. Parallel processing with rayon
sessions.par_iter()
    .map(|s| parse_session_usage(s))
    .collect()
```

## References

### Claude Code Documentation
- [Costs](https://code.claude.com/docs/en/costs.md)
- [Status Line API](https://code.claude.com/docs/en/statusline.md)
- [Monitoring Usage](https://code.claude.com/docs/en/monitoring-usage.md)

### Related Projects
- [jhlee0409/claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer)

## Success Metrics

- Users can view per-session costs at a glance
- Project-level cost tracking enables budget management
- Cache token visibility helps optimize prompts
- Export functionality supports cost reporting

## Future Enhancements

- Real-time cost estimation during active sessions
- Cost predictions based on historical patterns
- Integration with team billing systems
- Multi-currency support
- Custom pricing overrides for enterprise deployments
