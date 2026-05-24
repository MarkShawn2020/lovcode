# Session Tagging and Advanced Search Implementation Specification

## Overview
This specification details how to implement session tagging and advanced filtering features in Lovcode, enabling users to organize and search conversations with custom labels.

## Current State

### Existing Session Model (TypeScript)
```typescript
export interface Session {
  id: string;
  project_id: string;
  project_path: string | null;
  summary: string | null;
  message_count: number;
  last_modified: number;
}
```

### Search Capabilities
- Full-text search using Tantivy search engine
- Chinese tokenization support
- Session-level summary search
- No tagging/labeling system

## Proposed Architecture

### Phase 1: Data Model Extension

#### Extended Session Type (TypeScript)
```typescript
export interface SessionTag {
  sessionId: string;
  tag: string;
  createdAt: number;
}

export interface SessionWithTags extends Session {
  tags: string[];
}

export interface TagStatistics {
  tag: string;
  count: number;
  lastUsed: number;
}
```

#### Tag Storage Format
**File:** `~/.claude/projects/{project-id}/tags.json`

```json
{
  "tags": [
    {
      "sessionId": "session-uuid-1",
      "tag": "bug-fix",
      "createdAt": 1704067200000
    },
    {
      "sessionId": "session-uuid-2",
      "tag": "feature-dev",
      "createdAt": 1704067200000
    }
  ]
}
```

**Benefits:**
- Per-project organization (matches existing structure)
- Simple JSON format (human-readable)
- No modification to session storage
- Easy to backup/migrate

### Phase 2: Backend Implementation (Rust)

**File:** `src-tauri/src/lib.rs`

#### Data Structure
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionTag {
    pub session_id: String,
    pub tag: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TagsFile {
    pub tags: Vec<SessionTag>,
}

#[derive(Debug, Serialize)]
pub struct TagStatistics {
    pub tag: String,
    pub count: usize,
    pub last_used: i64,
}
```

#### Helper Functions
```rust
fn get_tags_file_path(project_id: &str) -> PathBuf {
    get_claude_dir()
        .join("projects")
        .join(project_id)
        .join("tags.json")
}

fn load_tags_file(project_id: &str) -> Result<Vec<SessionTag>, String> {
    let path = get_tags_file_path(project_id);

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read tags file: {}", e))?;

    let tags_file: TagsFile = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid tags file format: {}", e))?;

    Ok(tags_file.tags)
}

fn save_tags_file(project_id: &str, tags: Vec<SessionTag>) -> Result<(), String> {
    let path = get_tags_file_path(project_id);

    // Ensure parent directory exists
    fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let tags_file = TagsFile { tags };
    let json = serde_json::to_string_pretty(&tags_file)
        .map_err(|e| format!("Failed to serialize tags: {}", e))?;

    fs::write(&path, json)
        .map_err(|e| format!("Failed to write tags file: {}", e))
}
```

#### Tauri Commands

```rust
/// Add a tag to a session
#[tauri::command]
fn add_session_tag(
    project_id: String,
    session_id: String,
    tag: String,
) -> Result<(), String> {
    // Validate inputs
    if tag.trim().is_empty() {
        return Err("Tag cannot be empty".to_string());
    }

    let normalized_tag = tag.trim().to_lowercase();

    // Load existing tags
    let mut tags = load_tags_file(&project_id)?;

    // Check if tag already exists for this session
    if tags.iter().any(|t| t.session_id == session_id && t.tag == normalized_tag) {
        return Ok(()); // Already exists, no-op
    }

    // Add new tag
    tags.push(SessionTag {
        session_id: session_id.clone(),
        tag: normalized_tag,
        created_at: chrono::Local::now().timestamp_millis(),
    });

    // Save updated tags
    save_tags_file(&project_id, tags)
}

/// Remove a tag from a session
#[tauri::command]
fn remove_session_tag(
    project_id: String,
    session_id: String,
    tag: String,
) -> Result<(), String> {
    let normalized_tag = tag.trim().to_lowercase();
    let mut tags = load_tags_file(&project_id)?;

    // Remove matching tag
    tags.retain(|t| !(t.session_id == session_id && t.tag == normalized_tag));

    save_tags_file(&project_id, tags)
}

/// Get all tags for a specific session
#[tauri::command]
fn get_session_tags(
    project_id: String,
    session_id: String,
) -> Result<Vec<String>, String> {
    let tags = load_tags_file(&project_id)?;

    Ok(tags
        .into_iter()
        .filter(|t| t.session_id == session_id)
        .map(|t| t.tag)
        .collect())
}

/// Get all unique tags used in a project
#[tauri::command]
fn get_project_tags(project_id: String) -> Result<Vec<TagStatistics>, String> {
    let tags = load_tags_file(&project_id)?;

    // Count occurrences and track last used
    let mut tag_map: HashMap<String, (usize, i64)> = HashMap::new();

    for tag in tags {
        let (count, last_used) = tag_map.entry(tag.tag.clone()).or_insert((0, 0));
        *count += 1;
        *last_used = (*last_used).max(tag.created_at);
    }

    Ok(tag_map
        .into_iter()
        .map(|(tag, (count, last_used))| TagStatistics {
            tag,
            count,
            last_used,
        })
        .collect())
}

/// Search sessions by tags
#[tauri::command]
fn search_sessions_by_tags(
    project_id: String,
    tags: Vec<String>,
    match_all: bool, // true = AND logic, false = OR logic
) -> Result<Vec<String>, String> {
    if tags.is_empty() {
        return Ok(vec![]);
    }

    let all_tags = load_tags_file(&project_id)?;
    let normalized_tags: Vec<String> = tags.iter().map(|t| t.trim().to_lowercase()).collect();

    // Group tags by session
    let mut session_tag_map: HashMap<String, Vec<String>> = HashMap::new();

    for tag_entry in all_tags {
        session_tag_map
            .entry(tag_entry.session_id.clone())
            .or_insert_with(Vec::new)
            .push(tag_entry.tag);
    }

    // Filter sessions based on tag matching logic
    let matching_sessions: Vec<String> = session_tag_map
        .into_iter()
        .filter(|(_, session_tags)| {
            if match_all {
                // All requested tags must be present (AND)
                normalized_tags.iter().all(|tag| session_tags.contains(tag))
            } else {
                // At least one requested tag must be present (OR)
                normalized_tags.iter().any(|tag| session_tags.contains(tag))
            }
        })
        .map(|(session_id, _)| session_id)
        .collect();

    Ok(matching_sessions)
}

/// Get tag suggestions based on partial input
#[tauri::command]
fn get_tag_suggestions(
    project_id: String,
    prefix: String,
) -> Result<Vec<String>, String> {
    let tags = load_tags_file(&project_id)?;
    let prefix_lower = prefix.trim().to_lowercase();

    // Get unique tags
    let mut unique_tags: Vec<String> = tags
        .into_iter()
        .map(|t| t.tag)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    // Filter by prefix
    unique_tags.retain(|tag| tag.starts_with(&prefix_lower));

    // Sort and limit to 10 suggestions
    unique_tags.sort();
    unique_tags.truncate(10);

    Ok(unique_tags)
}

/// Clear all tags for a deleted session (cleanup)
#[tauri::command]
fn clear_session_tags(project_id: String, session_id: String) -> Result<(), String> {
    let mut tags = load_tags_file(&project_id)?;
    tags.retain(|t| t.session_id != session_id);
    save_tags_file(&project_id, tags)
}
```

#### Handler Registration
Add to `tauri::generate_handler![]`:

```rust
tauri::generate_handler![
    // ... existing handlers ...

    // Session tagging
    add_session_tag,
    remove_session_tag,
    get_session_tags,
    get_project_tags,
    search_sessions_by_tags,
    get_tag_suggestions,
    clear_session_tags,

    // ... other handlers ...
]
```

### Phase 3: Frontend Implementation (TypeScript/React)

#### Custom Hook: useSessionTags

**File:** `src/hooks/useSessionTags.ts`

```typescript
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TagStatistics {
  tag: string;
  count: number;
  lastUsed: number;
}

export function useSessionTags(projectId: string, sessionId: string) {
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<string[]>("get_session_tags", {
        project_id: projectId,
        session_id: sessionId,
      });
      setTags(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionId]);

  const addTag = useCallback(
    async (tag: string) => {
      try {
        await invoke("add_session_tag", {
          project_id: projectId,
          session_id: sessionId,
          tag,
        });
        // Optimistically update UI
        setTags((prev) => [...new Set([...prev, tag.toLowerCase().trim()])]);
      } catch (e) {
        setError(String(e));
      }
    },
    [projectId, sessionId]
  );

  const removeTag = useCallback(
    async (tag: string) => {
      try {
        await invoke("remove_session_tag", {
          project_id: projectId,
          session_id: sessionId,
          tag,
        });
        // Optimistically update UI
        setTags((prev) => prev.filter((t) => t !== tag));
      } catch (e) {
        setError(String(e));
      }
    },
    [projectId, sessionId]
  );

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  return { tags, loading, error, addTag, removeTag, refresh: loadTags };
}

export function useProjectTags(projectId: string) {
  const [tags, setTags] = useState<TagStatistics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<TagStatistics[]>("get_project_tags", {
        project_id: projectId,
      });
      setTags(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  return { tags, loading, error, refresh: loadTags };
}

export function useTagSearch(projectId: string) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const getSuggestions = useCallback(
    async (prefix: string) => {
      if (!prefix.trim()) {
        setSuggestions([]);
        return;
      }

      setLoading(true);
      try {
        const result = await invoke<string[]>("get_tag_suggestions", {
          project_id: projectId,
          prefix,
        });
        setSuggestions(result);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  const searchByTags = useCallback(
    async (tags: string[], matchAll: boolean = false) => {
      try {
        const result = await invoke<string[]>("search_sessions_by_tags", {
          project_id: projectId,
          tags,
          match_all: matchAll,
        });
        return result;
      } catch {
        return [];
      }
    },
    [projectId]
  );

  return { suggestions, loading, getSuggestions, searchByTags };
}
```

#### Component: SessionTagInput

**File:** `src/components/SessionTagInput.tsx`

```typescript
import { useState, useRef, useEffect } from "react";
import { useSessionTags, useTagSearch } from "../hooks/useSessionTags";
import { X } from "lucide-react";

interface SessionTagInputProps {
  projectId: string;
  sessionId: string;
  onTagsChange?: (tags: string[]) => void;
}

export function SessionTagInput({
  projectId,
  sessionId,
  onTagsChange,
}: SessionTagInputProps) {
  const { tags, addTag, removeTag } = useSessionTags(projectId, sessionId);
  const { suggestions, getSuggestions } = useTagSearch(projectId);
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = async (value: string) => {
    setInputValue(value);
    if (value.trim()) {
      await getSuggestions(value);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleAddTag = async (tag: string) => {
    const normalizedTag = tag.toLowerCase().trim();
    if (normalizedTag && !tags.includes(normalizedTag)) {
      await addTag(normalizedTag);
      onTagsChange?.([...tags, normalizedTag]);
      setInputValue("");
      setShowSuggestions(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      handleAddTag(inputValue);
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="space-y-2">
      {/* Tag Pills */}
      <div className="flex gap-2 flex-wrap">
        {tags.map((tag) => (
          <span
            key={tag}
            className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm flex items-center gap-2 font-medium"
          >
            #{tag}
            <button
              onClick={() => {
                removeTag(tag);
                onTagsChange?.(tags.filter((t) => t !== tag));
              }}
              className="hover:text-primary/70 transition-colors"
              title="Remove tag"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      {/* Input with Suggestions */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyPress={handleKeyPress}
          onFocus={() => inputValue && setShowSuggestions(true)}
          placeholder="Add tag... (e.g., bug-fix, feature-dev)"
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card hover:border-primary/50 focus:border-primary focus:outline-none transition-colors"
        />

        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleAddTag(suggestion)}
                className="w-full text-left px-3 py-2 hover:bg-card-alt transition-colors text-sm text-ink first:rounded-t-lg last:rounded-b-lg"
              >
                #{suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Helper Text */}
      <p className="text-xs text-muted-foreground">
        Tags help organize and filter sessions. Press Enter to add.
      </p>
    </div>
  );
}
```

#### Component: SessionTagFilter

**File:** `src/components/SessionTagFilter.tsx`

```typescript
import { useState } from "react";
import { useProjectTags, useTagSearch } from "../hooks/useSessionTags";
import { X } from "lucide-react";

interface SessionTagFilterProps {
  projectId: string;
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  matchAll?: boolean;
  onMatchAllChange?: (matchAll: boolean) => void;
}

export function SessionTagFilter({
  projectId,
  selectedTags,
  onTagsChange,
  matchAll = false,
  onMatchAllChange,
}: SessionTagFilterProps) {
  const { tags: allTags } = useProjectTags(projectId);
  const [expanded, setExpanded] = useState(false);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          Filter by Tags
        </span>
        {selectedTags.length > 0 && (
          <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium">
            {selectedTags.length}
          </span>
        )}
      </div>

      {/* Selected Tags */}
      {selectedTags.length > 0 && (
        <div className="flex gap-2 flex-wrap p-2 bg-card-alt rounded-lg">
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-1 bg-primary/10 text-primary rounded text-xs flex items-center gap-1"
            >
              #{tag}
              <button
                onClick={() => toggleTag(tag)}
                className="hover:text-primary/70"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Match Logic Toggle */}
      {selectedTags.length > 1 && onMatchAllChange && (
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={!matchAll}
              onChange={() => onMatchAllChange(false)}
              className="w-3 h-3"
            />
            <span className="text-muted-foreground">Match any tag</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={matchAll}
              onChange={() => onMatchAllChange(true)}
              className="w-3 h-3"
            />
            <span className="text-muted-foreground">Match all tags</span>
          </label>
        </div>
      )}

      {/* Available Tags */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm text-muted-foreground hover:text-ink transition-colors"
      >
        {expanded ? "Hide" : "Show"} available tags ({allTags.length})
      </button>

      {expanded && allTags.length > 0 && (
        <div className="space-y-1 p-2 bg-card-alt rounded-lg max-h-60 overflow-y-auto">
          {allTags
            .sort((a, b) => b.count - a.count)
            .map((tag) => (
              <button
                key={tag.tag}
                onClick={() => toggleTag(tag.tag)}
                className={`w-full text-left px-2 py-1 rounded text-sm transition-colors flex items-center justify-between ${
                  selectedTags.includes(tag.tag)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <span>#{tag.tag}</span>
                <span className="text-xs opacity-60">{tag.count}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
```

#### Integration into SessionList

**File:** `src/views/Chat/SessionList.tsx`

Add to component:

```typescript
import { SessionTagInput } from "../../components/SessionTagInput";
import { SessionTagFilter } from "../../components/SessionTagFilter";

// Add state
const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
const [matchAllTags, setMatchAllTags] = useState(false);

// Add filtering logic
const { tags: searchByTagsFn } = useTagSearch(projectId);

useEffect(() => {
  const applyTagFilter = async () => {
    if (selectedTagFilters.length === 0) {
      // No filter, show all sessions
      return;
    }

    const matchingSessionIds = await searchByTagsFn(selectedTagFilters, matchAllTags);
    // Filter sessions to only show those with matching tags
    // setFilteredSessions(sessions.filter(s => matchingSessionIds.includes(s.id)));
  };

  applyTagFilter();
}, [selectedTagFilters, matchAllTags]);

// Add UI component before session list
return (
  <div>
    <SessionTagFilter
      projectId={projectId}
      selectedTags={selectedTagFilters}
      onTagsChange={setSelectedTagFilters}
      matchAll={matchAllTags}
      onMatchAllChange={setMatchAllTags}
    />

    {/* Existing session list */}
    {sessions.map(session => (
      <div key={session.id}>
        {/* Session content */}
        <SessionTagInput
          projectId={projectId}
          sessionId={session.id}
        />
      </div>
    ))}
  </div>
);
```

## Data Migration

### From No Tags to Tagged Sessions

```rust
/// Initialize tags file for existing project (one-time operation)
#[tauri::command]
fn initialize_project_tags(project_id: String) -> Result<(), String> {
    let path = get_tags_file_path(&project_id);

    if !path.exists() {
        save_tags_file(&project_id, vec![])?;
    }

    Ok(())
}
```

### Cleanup on Session Deletion

Update existing session deletion logic:
```rust
// When deleting a session, also clean up tags
#[tauri::command]
fn delete_session_with_tags(project_id: String, session_id: String) -> Result<(), String> {
    // Delete session
    delete_session(&project_id, &session_id)?;

    // Clean up tags
    clear_session_tags(project_id, session_id)?;

    Ok(())
}
```

## Search Integration

### Combined Text + Tag Search

```rust
#[tauri::command]
fn search_chats_with_tags(
    project_id: String,
    query: String,
    tags: Vec<String>,
    match_all: bool,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    // First, perform full-text search
    let mut results = search_chats(&query, limit)?;

    // If tags specified, filter by tags
    if !tags.is_empty() {
        let matching_session_ids = search_sessions_by_tags(
            project_id.clone(),
            tags,
            match_all,
        )?;

        results.retain(|r| matching_session_ids.contains(&r.session_id));
    }

    Ok(results)
}
```

## Performance Considerations

### Optimization Strategies

1. **Lazy Loading**: Load tags only when needed
2. **Caching**: Cache tag suggestions in memory
3. **Batch Operations**: Load all tags at once, not per-session
4. **Denormalization**: Consider storing tag counts in metadata

### File Size Impact
- Each tag: ~60 bytes (JSON overhead)
- Typical project: 1000 tags = ~60KB
- No performance impact for I/O

## Testing Strategy

### Backend Tests
```rust
#[cfg(test)]
mod tag_tests {
    #[test]
    fn test_add_session_tag() {
        // Create test tag file
        // Add tag
        // Verify in file
    }

    #[test]
    fn test_search_by_tags_and_logic() {
        // Add multiple tags
        // Search with AND logic
        // Verify correct sessions returned
    }

    #[test]
    fn test_tag_suggestions() {
        // Create tags with prefixes
        // Get suggestions for prefix
        // Verify correct matching
    }
}
```

### Frontend Tests
```typescript
describe("SessionTagInput", () => {
  test("should add tag on Enter", async () => {
    // Render component
    // Type tag
    // Press Enter
    // Verify tag added
  });

  test("should show suggestions", async () => {
    // Render component
    // Type partial tag
    // Verify suggestions appear
  });
});
```

## UI/UX Considerations

### Tag Display
- Show tags near session summary
- Use consistent color scheme (primary color)
- Sort tags alphabetically or by frequency

### Filtering
- Multi-select tag filter
- Toggle between AND/OR logic
- Show tag statistics (count)
- Clear filter button

### Autocomplete
- Suggest existing tags
- Case-insensitive matching
- Limit suggestions to 10
- Load on first keystroke

## Rollout Plan

### Phase 1: Backend Implementation
- [ ] Implement Rust commands
- [ ] Create tags.json structure
- [ ] Write comprehensive tests

### Phase 2: Frontend Implementation
- [ ] Create custom hooks
- [ ] Build tag input component
- [ ] Build filter component
- [ ] Integrate into SessionList

### Phase 3: Integration
- [ ] Connect to search
- [ ] Add to export functionality
- [ ] Update session deletion logic

### Phase 4: Release
- [ ] Documentation
- [ ] User guide
- [ ] Release notes

## Success Metrics

- Users can tag sessions within 2 clicks
- Tag filtering is instant (<100ms)
- Autocomplete suggestions appear within 100ms
- No noticeable performance impact on app
- Tags persist across sessions/restarts
