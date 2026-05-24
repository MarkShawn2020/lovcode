# OpenCode Repository Research Analysis

## Executive Summary

Due to access limitations with web fetching tools, I cannot directly access the OpenCode repository at https://github.com/anomalyco/opencode. However, I have conducted a comprehensive analysis of the **Lovcode codebase** to understand its current architecture, implementation patterns, and areas where we can apply learnings from similar projects.

This document provides:
1. Current state of Lovcode's skills/plugin handling
2. Analysis of template installation patterns used in Lovcode
3. Recommendations for fixing Skills installation issues
4. Proposed approaches for session tagging and search features
5. Code patterns and architectural insights for implementation

---

## Part 1: Current Lovcode Architecture Analysis

### 1.1 Skills Management System

#### Current Implementation Location
- **Frontend**: `/home/runner/work/lovcode/lovcode/src/views/Skills/`
  - `SkillsView.tsx` - Skills list display and browsing
  - `SkillDetailView.tsx` - Individual skill detail view
- **Backend**: `/home/runner/work/lovcode/lovcode/src-tauri/src/lib.rs` (lines 2097-2130)

#### Data Model (TypeScript)
```typescript
// From /home/runner/work/lovcode/lovcode/src/types/index.ts
export interface LocalSkill {
  name: string;
  path: string;
  description: string | null;
  content: string;
}
```

#### Backend Implementation (Rust)
```rust
// From src-tauri/src/lib.rs (lines 2097-2130)
fn list_local_skills() -> Result<Vec<LocalSkill>, String> {
    let skills_dir = get_claude_dir().join("skills");

    if !skills_dir.exists() {
        return Ok(vec![]);
    }

    let mut skills = Vec::new();

    for entry in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            let skill_name = path.file_name().unwrap().to_string_lossy().to_string();
            let skill_md = path.join("SKILL.md");

            if skill_md.exists() {
                let content = fs::read_to_string(&skill_md).unwrap_or_default();
                let (frontmatter, _, body) = parse_frontmatter(&content);

                skills.push(LocalSkill {
                    name: skill_name,
                    path: skill_md.to_string_lossy().to_string(),
                    description: frontmatter.get("description").cloned(),
                    content: body,
                });
            }
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}
```

#### Current Behavior
- Skills are loaded from `~/.claude/skills/` directory
- Each skill is a directory with a `SKILL.md` file
- Frontmatter parsing extracts metadata (description)
- Currently READ-ONLY - no installation logic implemented for skills

### 1.2 Template Installation System (Working Implementation)

#### Installation Functions Available
Lovcode implements sophisticated template installation for:
1. **Commands/Agents/Skills** - `install_command_template()` (line 3182)
2. **MCP Servers** - `install_mcp_template()` (line 3193)
3. **Hooks** - `install_hook_template()` (line 3331)
4. **Settings** - `install_setting_template()` (line 3376)
5. **Statuslines** - `install_statusline_template()` (line 3463)

#### Pattern: Command Template Installation

```rust
#[tauri::command]
fn install_command_template(name: String, content: String) -> Result<String, String> {
    let commands_dir = get_claude_dir().join("commands");
    fs::create_dir_all(&commands_dir).map_err(|e| e.to_string())?;

    let file_path = commands_dir.join(format!("{}.md", name));
    fs::write(&file_path, content).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}
```

**Key Points:**
- Simple file-based installation
- Creates directory if needed
- Writes template content to file
- Returns path on success

#### Pattern: MCP Template Installation (More Complex)

```rust
#[tauri::command]
fn install_mcp_template(name: String, config: String) -> Result<String, String> {
    let claude_json_path = get_claude_json_path();

    // Parse and extract MCP config
    let mcp_config: serde_json::Value = serde_json::from_str(&config)?;

    // Deep config extraction with automatic type inference
    let server_config = extract_server_config(mcp_config);

    // Read existing ~/.claude.json or create new
    let mut claude_json: serde_json::Value = if claude_json_path.exists() {
        let content = fs::read_to_string(&claude_json_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure mcpServers exists
    if !claude_json.get("mcpServers").is_some() {
        claude_json["mcpServers"] = serde_json::json!({});
    }

    // Infer type if not present
    let mut server_config = server_config;
    if server_config.get("type").is_none() {
        if let Some(url) = server_config.get("url").and_then(|v| v.as_str()) {
            let transport_type = if url.ends_with("/sse") {
                "sse"
            } else {
                "http"
            };
            server_config["type"] = serde_json::json!(transport_type);
        } else if server_config.get("command").is_some() {
            server_config["type"] = serde_json::json!("stdio");
        }
    }

    // Merge into config
    claude_json["mcpServers"][&name] = server_config;

    let output = serde_json::to_string_pretty(&claude_json)?;
    fs::write(&claude_json_path, output)?;

    Ok(format!("Installed MCP: {}", name))
}
```

**Key Insights:**
- Handles multiple config nesting levels
- Auto-detects server type from URL or command
- Merges with existing config
- Pretty-prints JSON output

#### Pattern: Hook Template Installation (Merge Strategy)

```rust
#[tauri::command]
fn install_hook_template(name: String, config: String) -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");

    let hook_config: serde_json::Value = serde_json::from_str(&config)?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure hooks exists
    if !settings.get("hooks").is_some() {
        settings["hooks"] = serde_json::json!({});
    }

    // Merge hook config
    if let Some(hook_obj) = hook_config.as_object() {
        for (event_type, handlers) in hook_obj {
            if let Some(handlers_arr) = handlers.as_array() {
                // Get existing handlers for this event type
                let existing = settings["hooks"]
                    .get(event_type)
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();

                // Merge (append new handlers)
                let mut merged: Vec<serde_json::Value> = existing;
                merged.extend(handlers_arr.clone());
                settings["hooks"][event_type] = serde_json::Value::Array(merged);
            }
        }
    }

    let output = serde_json::to_string_pretty(&settings)?;
    fs::write(&settings_path, output)?;

    Ok(format!("Installed hook: {}", name))
}
```

**Key Insights:**
- Appends to arrays instead of replacing
- Preserves existing hooks
- Handles missing parent structures

### 1.3 Marketplace Integration

#### Marketplace Components
- **View**: `/home/runner/work/lovcode/lovcode/src/views/Marketplace/MarketplaceView.tsx`
- **Detail**: `/home/runner/work/lovcode/lovcode/src/views/Marketplace/TemplateDetailView.tsx`

#### TemplateComponent Data Model
```typescript
export interface TemplateComponent {
  name: string;
  path: string;
  category: string;
  component_type: string;
  description: string | null;
  downloads: number | null;
  content: string | null;
  source_id?: string | null;
  source_name?: string | null;
  source_icon?: string | null;
  plugin_name?: string | null;
  author?: string | null;
}
```

#### Installation Logic (From TemplateDetailView.tsx)
```typescript
const handleInstall = async () => {
    if (!template.content) {
      setError("No content available for this template");
      return;
    }

    setInstalling(true);
    setError(null);

    try {
      switch (category) {
        case "commands":
        case "agents":
        case "skills":  // <-- Skills installation
          await invoke("install_command_template", {
            name: template.name,
            content: template.content,
          });
          break;
        case "mcps":
          await invoke("install_mcp_template", {
            name: template.name,
            config: template.content
          });
          break;
        case "hooks":
          await invoke("install_hook_template", {
            name: template.name,
            config: template.content
          });
          break;
        case "settings":
        case "output-styles":
          await invoke("install_setting_template", {
            config: template.content
          });
          break;
        case "statuslines":
          await invoke("install_statusline_template", {
            name: template.name,
            content: template.content
          });
          break;
      }
      setInstalled(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };
```

**Current Skills Installation:**
- Uses `install_command_template()` (treats skills like commands)
- Simply writes content to file
- No directory structure creation like commands (.md files)

---

## Part 2: Issues Identified and Solutions

### 2.1 Skills Installation Issue

#### Problem
Skills require a directory structure (`~/.claude/skills/{name}/SKILL.md`) but the current `install_command_template()` function only writes to a flat file.

#### Solution: Create Dedicated Skill Installation Function

**Rust Backend (add to lib.rs):**
```rust
#[tauri::command]
fn install_skill_template(name: String, content: String) -> Result<String, String> {
    // Create directory structure for skill
    let skills_dir = get_claude_dir().join("skills");
    let skill_dir = skills_dir.join(&name);

    // Create nested directories
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    // Write SKILL.md file
    let skill_file = skill_dir.join("SKILL.md");
    fs::write(&skill_file, content).map_err(|e| e.to_string())?;

    Ok(skill_file.to_string_lossy().to_string())
}
```

**Update tauri::generate_handler!:**
```rust
tauri::generate_handler![
    // ... existing handlers ...
    install_skill_template,  // Add this
    list_local_skills,
    // ... other handlers ...
]
```

**Update TypeScript (TemplateDetailView.tsx):**
```typescript
case "skills":
  await invoke("install_skill_template", {
    name: template.name,
    content: template.content,
  });
  break;
```

#### Benefits
1. Maintains proper directory structure for skills
2. Allows multiple files per skill (if needed in future)
3. Matches how skills are listed and read
4. Consistent with Claude Code expectations

---

## Part 3: Session Tagging and Search Features

### 3.1 Current Session Structure

From `src/types/index.ts`:
```typescript
export interface Session {
  id: string;
  project_id: string;
  project_path: string | null;
  summary: string | null;
  message_count: number;
  last_modified: number;
}

export interface SearchResult {
  uuid: string;
  content: string;
  role: string;
  project_id: string;
  project_path: string;
  session_id: string;
  session_summary: string | null;
  timestamp: string;
  score: number;
}
```

### 3.2 Proposed Tagging System

#### Option 1: Extended Session Model (Recommended)

**Backend Type (Rust):**
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionTag {
    pub session_id: String,
    pub tag: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionWithTags {
    pub id: String,
    pub project_id: String,
    pub project_path: Option<String>,
    pub summary: Option<String>,
    pub message_count: u32,
    pub last_modified: i64,
    pub tags: Vec<String>,  // NEW
}
```

**Frontend Type (TypeScript):**
```typescript
export interface SessionTag {
  session_id: string;
  tag: string;
  created_at: number;
}

export interface SessionWithTags extends Session {
  tags: string[];
}
```

#### Tauri Commands Needed

```rust
// Add tags
#[tauri::command]
fn add_session_tag(session_id: String, tag: String) -> Result<(), String> {
    // Store in session metadata or separate tags db
    // Consider: tags.json file per project or embedded in session metadata
}

// Remove tags
#[tauri::command]
fn remove_session_tag(session_id: String, tag: String) -> Result<(), String> {
    // Remove from storage
}

// List tags for session
#[tauri::command]
fn get_session_tags(session_id: String) -> Result<Vec<String>, String> {
    // Return tags for specific session
}

// List all tags in project
#[tauri::command]
fn get_project_tags(project_id: String) -> Result<Vec<String>, String> {
    // Return unique tags used in project
}

// Search by tags
#[tauri::command]
fn search_sessions_by_tags(
    project_id: String,
    tags: Vec<String>,
    match_all: bool  // true = AND, false = OR
) -> Result<Vec<Session>, String> {
    // Return sessions matching tag filter
}
```

### 3.3 Storage Strategy Comparison

#### Option A: Metadata File Per Project
**Pros:**
- Simple to implement
- Human-readable (JSON)
- Easy to backup/migrate

**Cons:**
- Separate file management
- Potential sync issues

**File Structure:**
```
~/.claude/
  projects/
    {project-id}/
      sessions.json      // existing
      tags.json          // NEW - maps session_id -> [tags]
```

#### Option B: Embedded in Session Metadata
**Pros:**
- Single source of truth
- Atomic updates
- Less file management

**Cons:**
- Requires modifying session storage format
- Migration complexity

**Recommended:** Option A (tags.json) for backward compatibility

### 3.4 Frontend Implementation Pattern

**React Hook for Tags:**
```typescript
export function useSessionTags(sessionId: string) {
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<string[]>("get_session_tags", {
        sessionId
      });
      setTags(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const addTag = useCallback(async (tag: string) => {
    try {
      await invoke("add_session_tag", { sessionId, tag });
      setTags(prev => [...new Set([...prev, tag])]);
    } catch (e) {
      setError(String(e));
    }
  }, [sessionId]);

  const removeTag = useCallback(async (tag: string) => {
    try {
      await invoke("remove_session_tag", { sessionId, tag });
      setTags(prev => prev.filter(t => t !== tag));
    } catch (e) {
      setError(String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  return { tags, loading, error, addTag, removeTag };
}
```

**UI Component for Tag Management:**
```typescript
interface SessionTagsProps {
  sessionId: string;
  onTagsChange?: (tags: string[]) => void;
}

export function SessionTags({ sessionId, onTagsChange }: SessionTagsProps) {
  const { tags, loading, addTag, removeTag } = useSessionTags(sessionId);
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const handleAddTag = async (tag: string) => {
    const normalizedTag = tag.toLowerCase().trim();
    if (normalizedTag && !tags.includes(normalizedTag)) {
      await addTag(normalizedTag);
      setInputValue("");
      onTagsChange?.([...tags, normalizedTag]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {tags.map(tag => (
          <span
            key={tag}
            className="px-2 py-1 bg-primary/10 text-primary rounded-lg text-sm flex items-center gap-1"
          >
            {tag}
            <button
              onClick={() => removeTag(tag)}
              className="hover:text-primary/70"
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleAddTag(inputValue);
            }
          }}
          placeholder="Add tag..."
          className="flex-1 px-2 py-1 border border-border rounded-lg text-sm"
        />
        <button
          onClick={() => handleAddTag(inputValue)}
          className="px-3 py-1 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90"
        >
          Add
        </button>
      </div>
    </div>
  );
}
```

---

## Part 4: Key Patterns and Architecture Insights

### 4.1 File-Based Configuration Pattern

**Pattern Used Throughout Lovcode:**
- Commands: `~/.claude/commands/{name}.md`
- Skills: `~/.claude/skills/{name}/SKILL.md`
- MCP: `~/.claude.json` (JSON config)
- Settings: `~/.claude/settings.json`
- Hooks: Stored in `settings.json`

**Key Learning:**
- File-based approach works well for user-editable content
- Markdown with frontmatter for metadata
- JSON for structured config merging
- Always preserve existing configs during installation

### 4.2 Installation Pattern Hierarchy

```
Simple Installation:
  Commands, Skills → Write file directly

Structured Installation:
  MCP, Hooks → Parse JSON, merge configs, write back

Config-Based:
  Settings → Deep merge JSON objects

Directory-Based:
  Statuslines → Create directory, make executable
```

### 4.3 Data Structure Patterns Observed

1. **Frontmatter Parsing**
   - Extracts YAML metadata from markdown files
   - Used for skills, commands, documents
   - Enables rich metadata without separate files

2. **Search Architecture**
   - Tantivy full-text search engine
   - Chinese tokenization support (Jieba)
   - SearchResult type includes relevance scores

3. **Type Inference**
   - MCP auto-detection of transport type
   - Graceful fallback values
   - Validation during merge

### 4.4 State Management Patterns

From `SessionList.tsx`:
```typescript
// Jotai atoms for persistent state
const [contextTab, setContextTab] = useAtom(sessionContextTabAtom);
const [selectMode, setSelectMode] = useAtom(sessionSelectModeAtom);
const [hideEmptySessions, setHideEmptySessions] = useAtom(hideEmptySessionsAtom);
const [userPromptsOnly, setUserPromptsOnly] = useAtom(userPromptsOnlyAtom);

// Temporary UI state
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [searching, setSearching] = useState(false);

// Cache invalidation with react-query
const { data: sessions = [], isLoading } = useInvokeQuery<Session[]>(
  ["sessions", projectId],
  "list_sessions",
  { projectId }
);
```

**Insight:** Combines Jotai (persistent) + useState (temporary) + react-query (cached)

---

## Part 5: Recommendations for Skills Installation Fix

### Step 1: Add Rust Backend Command
File: `/home/runner/work/lovcode/lovcode/src-tauri/src/lib.rs`

Add after line 3190 (after `install_command_template`):

```rust
#[tauri::command]
fn install_skill_template(name: String, content: String) -> Result<String, String> {
    // Create directory structure for skill
    let skills_dir = get_claude_dir().join("skills");
    let skill_dir = skills_dir.join(&name);

    // Create nested directories
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    // Write SKILL.md file in the skill directory
    let skill_file = skill_dir.join("SKILL.md");
    fs::write(&skill_file, content).map_err(|e| e.to_string())?;

    Ok(skill_file.to_string_lossy().to_string())
}
```

### Step 2: Register Command in Handler
Find: `tauri::generate_handler![]` (around line 6225)

Change `"skills"` case from:
```typescript
case "skills":
  await invoke("install_command_template", {
    name: template.name,
    content: template.content,
  });
```

To:
```typescript
case "skills":
  await invoke("install_skill_template", {
    name: template.name,
    content: template.content,
  });
```

### Step 3: Update TemplateDetailView
File: `/home/runner/work/lovcode/lovcode/src/views/Marketplace/TemplateDetailView.tsx`

In the `handleInstall` function (around line 73), update the skills case:

```typescript
case "skills":
  await invoke("install_skill_template", {
    name: template.name,
    content: template.content,
  });
  break;
```

---

## Part 6: Limitations and Next Steps

### What We Know from Lovcode
- Robust template installation system exists
- Multiple category support (commands, MCPs, hooks, settings, statuslines)
- File-based configuration pattern is proven
- Marketplace integration works well

### What We Cannot Determine About OpenCode
Due to web access limitations, I cannot directly analyze:
- OpenCode's specific skills/plugins architecture
- Their session tagging implementation
- Their marketplace integration approach
- Their data structure decisions

### Recommended Research Path
1. Clone OpenCode repository locally
2. Examine:
   - `/src` - Frontend implementation of skills
   - `/backend` (if Rust/Python) - Skills handling
   - `/docs` - Architecture documentation
   - Configuration files - What formats they use
3. Compare with Lovcode patterns
4. Identify best practices to adopt

---

## Conclusion

Lovcode's template installation system provides a solid foundation for implementing a Skills installation fix. The pattern is:

1. **Create directory structure** for the resource type
2. **Write template content** to appropriate file(s)
3. **Handle configuration merging** for JSON-based configs
4. **Provide uninstall capability** for reversibility
5. **Validate before installation** to prevent corrupt state

For session tagging, the recommended approach is:
- Extend Session type to include tags array
- Use separate `tags.json` file per project
- Implement Tauri commands for CRUD operations
- Add React hooks and UI components for tag management
- Integrate with existing search infrastructure

The Lovcode architecture is well-suited for these enhancements and follows established patterns from the broader Claude Code ecosystem.
