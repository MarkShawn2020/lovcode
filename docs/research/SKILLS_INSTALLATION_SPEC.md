# Skills Installation Implementation Specification

## Overview
This document provides detailed technical specifications for fixing the Skills installation functionality in Lovcode, based on analysis of the existing template installation system.

## Current State Issues

### Problem 1: Directory Structure Mismatch
**Current Behavior:**
- `install_command_template()` writes to: `~/.claude/commands/{name}.md`
- Skills are read from: `~/.claude/skills/{name}/SKILL.md`

**Impact:**
- Marketplace skills cannot be properly installed
- Skills installation fails silently or creates malformed entries

### Problem 2: Missing Skill-Specific Logic
**Root Cause:**
- Skills treated as flat files like commands
- No consideration for directory structure requirements
- No skill-specific metadata handling

## Solution: Implement Dedicated Skill Installation

### Phase 1: Backend Implementation (Rust)

**File:** `src-tauri/src/lib.rs`

**Location to Add:** After `install_command_template()` function (around line 3190)

```rust
/// Install a skill template to ~/.claude/skills/{name}/SKILL.md
#[tauri::command]
fn install_skill_template(name: String, content: String) -> Result<String, String> {
    // Validate skill name - should be a valid directory name
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }

    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("Skill name contains invalid characters".to_string());
    }

    // Create directory structure: ~/.claude/skills/{name}/
    let skills_dir = get_claude_dir().join("skills");
    let skill_dir = skills_dir.join(&name);

    // Create nested directories (equivalent to mkdir -p)
    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    // Write SKILL.md file in the skill directory
    let skill_file = skill_dir.join("SKILL.md");
    fs::write(&skill_file, content)
        .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    Ok(skill_file.to_string_lossy().to_string())
}

/// Uninstall a skill by removing its directory
#[tauri::command]
fn uninstall_skill(name: String) -> Result<String, String> {
    // Validate name
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }

    let skills_dir = get_claude_dir().join("skills");
    let skill_dir = skills_dir.join(&name);

    // Check if skill directory exists
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    // Remove entire skill directory
    fs::remove_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to remove skill: {}", e))?;

    Ok(format!("Uninstalled skill: {}", name))
}

/// Check if a skill is already installed
#[tauri::command]
fn check_skill_installed(name: String) -> bool {
    let skills_dir = get_claude_dir().join("skills");
    let skill_dir = skills_dir.join(&name);
    let skill_file = skill_dir.join("SKILL.md");

    skill_file.exists()
}
```

### Phase 2: Update Handler Registration

**File:** `src-tauri/src/lib.rs`

**Location:** Find `tauri::generate_handler![]` macro (around line 6225)

**Add to handler list:**
```rust
tauri::generate_handler![
    // ... existing handlers ...

    // Skills management
    list_local_skills,
    install_skill_template,      // NEW
    uninstall_skill,             // NEW
    check_skill_installed,       // NEW

    // ... rest of handlers ...
]
```

### Phase 3: Frontend Implementation (TypeScript/React)

**File:** `src/views/Marketplace/TemplateDetailView.tsx`

**Update 1: Extend Component State**

Add state for tracking skill installation status:
```typescript
const [installed, setInstalled] = useState(false);
const [uninstalling, setUninstalling] = useState(false);

useEffect(() => {
  if (category === "skills") {
    invoke<boolean>("check_skill_installed", { name: template.name }).then(setInstalled);
  }
}, [category, template.name]);
```

**Update 2: Add Uninstall Handler**

```typescript
const handleUninstall = async () => {
  if (category !== "skills") return;

  setUninstalling(true);
  setError(null);

  try {
    await invoke("uninstall_skill", { name: template.name });
    setInstalled(false);
  } catch (e) {
    setError(String(e));
  } finally {
    setUninstalling(false);
  }
};
```

**Update 3: Modify Install Switch Statement**

Replace the existing skills case:
```typescript
// BEFORE:
case "skills":
  await invoke("install_command_template", {
    name: template.name,
    content: template.content,
  });
  break;

// AFTER:
case "skills":
  await invoke("install_skill_template", {
    name: template.name,
    content: template.content,
  });
  break;
```

**Update 4: Add UI Elements**

Update the button area to show uninstall option for skills:
```typescript
{installed && category === "skills" ? (
  <button
    onClick={handleUninstall}
    disabled={uninstalling}
    className="px-4 py-2 rounded-lg font-medium transition-colors bg-red-500/10 text-red-600 hover:bg-red-500/20"
  >
    {uninstalling ? "Uninstalling..." : "Uninstall"}
  </button>
) : (
  <button
    onClick={handleInstall}
    disabled={installing || installed}
    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
      installed
        ? "bg-green-500/20 text-green-600"
        : installing
          ? "bg-card-alt text-muted-foreground"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
    }`}
  >
    {installed ? "✓ Installed" : installing ? "Installing..." : "Install"}
  </button>
)}
```

## Data Flow Diagram

```
Marketplace Template Selection
              ↓
        TemplateDetailView
              ↓
       handleInstall()
              ↓
   invoke("install_skill_template", {
     name: string,
     content: string
   })
              ↓
      [Tauri IPC Bridge]
              ↓
   Rust Backend: install_skill_template()
              ↓
   1. Validate name
   2. Create ~/.claude/skills/{name}/
   3. Write SKILL.md
   4. Return path or error
              ↓
   Frontend: Catch response/error
              ↓
   Update UI (setInstalled = true)
              ↓
   Show success/error message
```

## Error Handling Strategy

### Backend Validation
```rust
// Input validation
- Empty name → return error
- Invalid characters in name → return error
- Directory creation failure → return descriptive error
- File write failure → return descriptive error

// Directory state checks
- Parent directory doesn't exist → create automatically
- Skill already exists → overwrite (with warning in UI)
- Permission denied → propagate OS error
```

### Frontend Error Handling
```typescript
try {
  await invoke("install_skill_template", {
    name: template.name,
    content: template.content,
  });
  setInstalled(true);
} catch (e) {
  // Set error to be displayed in UI
  setError(String(e));
  // Could also distinguish error types:
  if (e.includes("invalid characters")) {
    setError("Invalid skill name - use alphanumeric, dash, underscore only");
  } else if (e.includes("permission")) {
    setError("Permission denied - check ~/.claude directory permissions");
  }
}
```

## Testing Strategy

### Unit Tests (Rust)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_install_skill_creates_directory() {
        let temp_dir = TempDir::new().unwrap();
        // Mock get_claude_dir() to return temp_dir

        let result = install_skill_template(
            "test_skill".to_string(),
            "# Test Skill Content".to_string(),
        );

        assert!(result.is_ok());
        let skill_path = temp_dir.path().join("skills/test_skill/SKILL.md");
        assert!(skill_path.exists());
    }

    #[test]
    fn test_install_skill_rejects_invalid_names() {
        let result = install_skill_template(
            "invalid/name".to_string(),
            "content".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_uninstall_skill_removes_directory() {
        // Create test skill, then uninstall
        // Verify directory is removed
    }
}
```

### Integration Tests (Full Flow)

```typescript
// Frontend + Backend test
describe("Skills Installation", () => {
  test("should install skill from marketplace template", async () => {
    const template: TemplateComponent = {
      name: "test-skill",
      content: "# Test",
      category: "skills",
      // ... other fields
    };

    // Simulate installation
    await invoke("install_skill_template", {
      name: template.name,
      content: template.content,
    });

    // Verify skill appears in list
    const skills = await invoke<LocalSkill[]>("list_local_skills");
    expect(skills.some(s => s.name === "test-skill")).toBe(true);
  });

  test("should uninstall skill", async () => {
    // Install first
    await invoke("install_skill_template", {
      name: "test-skill",
      content: "# Test",
    });

    // Then uninstall
    await invoke("uninstall_skill", { name: "test-skill" });

    // Verify removed
    const skills = await invoke<LocalSkill[]>("list_local_skills");
    expect(skills.some(s => s.name === "test-skill")).toBe(false);
  });
});
```

## Backward Compatibility

### Migration Path
If existing installations have skills in wrong location:

```rust
#[tauri::command]
fn migrate_skills() -> Result<Vec<String>, String> {
    // Find any .md files in ~/.claude/skills/
    // Move them to ~/.claude/skills/{name}/SKILL.md
    // Return list of migrated skill names

    let skills_dir = get_claude_dir().join("skills");
    let mut migrated = Vec::new();

    for entry in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        // If file is .md at root level
        if path.is_file() && path.extension().map(|e| e == "md").unwrap_or(false) {
            let file_name = path.file_stem().unwrap().to_string_lossy().to_string();
            let new_dir = skills_dir.join(&file_name);
            fs::create_dir_all(&new_dir).ok();

            let new_path = new_dir.join("SKILL.md");
            fs::rename(&path, &new_path).ok();

            migrated.push(file_name);
        }
    }

    Ok(migrated)
}
```

## Configuration Files Impact

No new config files required. Uses existing:
- `~/.claude/skills/` - Directory structure unchanged
- `~/.claude/settings.json` - No changes needed
- `~/.claude.json` - No changes needed

## Performance Considerations

- **Directory creation**: O(1) operation, minimal overhead
- **File writing**: Depends on content size, typically <100KB per skill
- **No database**: Filesystem-based, leverages existing file listing

## Security Considerations

1. **Path Traversal Prevention**
   ```rust
   // Validate no "/" or "\" in skill name
   if name.contains('/') || name.contains('\\') || name.contains('\0') {
       return Err("Invalid characters in skill name".to_string());
   }
   ```

2. **File Permissions**
   - Keep parent directory permissions intact
   - New files inherit parent directory permissions
   - No execute bits set for .md files

3. **Content Validation**
   - No validation of markdown content
   - Trust marketplace source (handled at catalog level)

## Rollout Plan

### Phase 1: Implementation (Days 1-2)
- [ ] Implement backend commands
- [ ] Update handler registration
- [ ] Update frontend components
- [ ] Write unit tests

### Phase 2: Testing (Days 3-4)
- [ ] Run full test suite
- [ ] Manual testing of installation flow
- [ ] Test error cases
- [ ] Test with real marketplace data

### Phase 3: Release (Day 5)
- [ ] Create PR with changes
- [ ] Code review
- [ ] Merge and release in next version

## Rollback Plan

If issues discovered:
1. Revert to previous version (no data loss)
2. Installed skills remain in filesystem
3. Manual cleanup if needed: `rm -rf ~/.claude/skills/{problematic-skill}`

## Success Criteria

- [ ] Marketplace skills install to correct directory structure
- [ ] Skill appears in SkillsView after installation
- [ ] Uninstall removes skill completely
- [ ] Error handling shows user-friendly messages
- [ ] No regression in other template types
