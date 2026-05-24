# Quick Start Implementation Guide

## Skills Installation Fix - 5 Minute Implementation

### Step 1: Add Rust Command (2 minutes)

**File:** `/home/runner/work/lovcode/lovcode/src-tauri/src/lib.rs`

**Find line:** ~3190 (after `install_command_template` function)

**Add this code:**
```rust
/// Install a skill template to ~/.claude/skills/{name}/SKILL.md
#[tauri::command]
fn install_skill_template(name: String, content: String) -> Result<String, String> {
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }

    let skills_dir = get_claude_dir().join("skills");
    let skill_dir = skills_dir.join(&name);

    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    let skill_file = skill_dir.join("SKILL.md");
    fs::write(&skill_file, content)
        .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    Ok(skill_file.to_string_lossy().to_string())
}
```

### Step 2: Register Handler (1 minute)

**File:** Same file, find `tauri::generate_handler![]` (~line 6225)

**Add this line in the handler list:**
```rust
install_skill_template,  // NEW - add this
```

### Step 3: Update Frontend (1 minute)

**File:** `/home/runner/work/lovcode/lovcode/src/views/Marketplace/TemplateDetailView.tsx`

**Find:** The switch statement in `handleInstall` function (around line 73)

**Change this:**
```typescript
case "skills":
  await invoke("install_command_template", {
    name: template.name,
    content: template.content,
  });
  break;
```

**To this:**
```typescript
case "skills":
  await invoke("install_skill_template", {
    name: template.name,
    content: template.content,
  });
  break;
```

### Step 4: Test (1 minute)

```bash
# Build and test
pnpm tauri dev

# Steps to test:
# 1. Go to Marketplace → Skills
# 2. Find a skill template
# 3. Click "Install"
# 4. Go to Settings → Skills
# 5. Verify skill appears in list
```

**Done!** Skills installation now works correctly.

---

## Session Tagging - Implementation Order

### For Implementation Team:
1. **Review** SESSION_TAGGING_SPEC.md first
2. **Implement Rust backend** (300 lines, 2-3 days)
3. **Create React hooks** (150 lines, 1 day)
4. **Build UI components** (350 lines, 1-2 days)
5. **Integrate into SessionList** (100 lines, 1 day)

### Key Files to Create:
```
src/hooks/useSessionTags.ts          (150 lines)
src/components/SessionTagInput.tsx   (150 lines)
src/components/SessionTagFilter.tsx  (200 lines)
```

### Key Files to Modify:
```
src-tauri/src/lib.rs                           (+200 lines)
src/views/Chat/SessionList.tsx                 (+100 lines)
src/types/index.ts                             (+20 lines)
```

---

## Architecture Comparison Quick Reference

### Skills Installation Pattern

| Aspect | Command | Skill |
|--------|---------|-------|
| **Location** | `~/.claude/commands/{name}.md` | `~/.claude/skills/{name}/SKILL.md` |
| **Type** | Flat file | Directory structure |
| **Installation** | `install_command_template()` | `install_skill_template()` |
| **Why Different** | Commands are single files | Skills may need future expansion |

### Search Pattern Comparison

| Feature | Current | With Tags |
|---------|---------|-----------|
| **Search Type** | Full-text content | Full-text + tags |
| **Storage** | Session metadata | Separate tags.json |
| **Filter Logic** | Tantivy query | AND/OR on tag arrays |
| **Performance** | ~50ms | ~10ms (tags) |

### Template Installation Patterns Summary

```
Commands/Skills/Agents
├─ Write content to file
├─ Single directory level
└─ No config parsing

MCPs
├─ Parse JSON
├─ Auto-detect type
├─ Merge into ~/.claude.json
└─ Handle nesting levels

Hooks
├─ Parse JSON
├─ Array append logic
├─ Merge into settings.json
└─ Preserve existing hooks

Settings
├─ Deep merge JSON
├─ Preserve keys
└─ Write to settings.json

Statuslines
├─ Write shell script
├─ Create directory
├─ Set executable bit
└─ Store in ~/.lovstudio/
```

---

## Testing Checklist

### Skills Installation Testing

- [ ] Marketplace loads skills templates
- [ ] Install button appears
- [ ] Install succeeds with no errors
- [ ] Installed skill appears in Settings → Skills
- [ ] Skill content displays correctly in detail view
- [ ] Multiple skills can be installed
- [ ] No regression in command/agent installation
- [ ] Directory structure matches expectations

### Session Tagging Testing

- [ ] Can add tag to session
- [ ] Can remove tag from session
- [ ] Tags persist after app restart
- [ ] Tag autocomplete works
- [ ] Filter by single tag works
- [ ] Filter by multiple tags (AND/OR) works
- [ ] Tag statistics display correctly
- [ ] Clearing filters resets view
- [ ] Search + tags filter works together

---

## Common Issues & Solutions

### Skills Still Not Found After Install

**Symptom:** Install succeeds but skill doesn't appear in list

**Check:**
1. Directory created at `~/.claude/skills/{name}/`?
2. File exists at `~/.claude/skills/{name}/SKILL.md`?
3. Restart app and list again

**Fix:**
```bash
ls -la ~/.claude/skills/
# Should see: {skill-name}/SKILL.md
```

### Tag Filter Not Working

**Symptom:** Selected tags but sessions not filtered

**Check:**
1. tags.json exists at `~/.claude/projects/{id}/tags.json`?
2. Tags added to correct project_id?
3. Check browser console for errors

**Fix:**
```rust
// In Rust backend
fn debug_tags(project_id: String) {
    if let Ok(tags) = load_tags_file(&project_id) {
        eprintln!("Loaded {} tags", tags.len());
    }
}
```

### Performance Issues After Adding Many Tags

**Symptom:** UI sluggish, suggestions slow

**Solution:**
1. Cache tag suggestions in React state
2. Debounce autocomplete input
3. Lazy-load tags on demand
4. Consider tag pagination

---

## File Locations Reference

### Lovcode Source Structure
```
lovcode/
├── src/                          # React frontend
│   ├── views/
│   │   ├── Skills/               # Skills UI
│   │   ├── Marketplace/          # Template installation
│   │   └── Chat/                 # Chat & sessions
│   ├── components/               # Reusable components
│   ├── hooks/                    # Custom hooks
│   ├── types/index.ts            # Type definitions
│   └── store/                    # Jotai atoms
│
├── src-tauri/                    # Rust backend
│   └── src/
│       ├── lib.rs               # All Tauri commands
│       ├── pty_manager.rs       # Terminal management
│       └── workspace_store.rs   # Workspace storage
│
└── docs/                         # Documentation
```

### User Data Directories
```
~/.claude/
├── commands/                     # Command files
├── skills/                       # Skill directories
├── settings.json                 # Settings config
├── .claude.json                  # MCP config
└── projects/
    └── {project-id}/
        └── tags.json             # NEW: Session tags

~/.lovstudio/
└── lovcode/
    └── statusline/               # Statusline scripts
```

---

## Integration Points

### Skills Installation Flow
```
Marketplace → TemplateDetailView
  ↓
  invoke("install_skill_template", {...})
  ↓
  [Tauri IPC]
  ↓
  Rust: install_skill_template()
  ↓
  Create ~/.claude/skills/{name}/SKILL.md
  ↓
  Return success
  ↓
  Frontend: setInstalled(true)
  ↓
  SkillsView: list_local_skills() picks it up
```

### Session Tagging Flow
```
SessionList → SessionTagInput
  ↓
  invoke("add_session_tag", {...})
  ↓
  [Tauri IPC]
  ↓
  Rust: add_session_tag()
  ↓
  Load tags.json
  ↓
  Add new tag
  ↓
  Save tags.json
  ↓
  Frontend: Update UI
  ↓
  Re-render with new tags
```

---

## Performance Benchmarks to Track

### Skills Installation
- Time to create directory: < 1ms
- Time to write SKILL.md: < 10ms
- Total latency: < 50ms
- No impact on app responsiveness

### Session Tagging
- Add tag: < 20ms
- Get suggestions: < 50ms
- Filter sessions: < 100ms
- Load all tags for project: < 50ms

---

## Debugging Tips

### Enable Debug Logging

**Rust:**
```rust
eprintln!("DEBUG: Installing skill: {}", name);
eprintln!("DEBUG: Skill dir: {:?}", skill_dir);
eprintln!("DEBUG: Skill file: {:?}", skill_file);
```

**TypeScript:**
```typescript
console.log("Installing skill:", template.name);
console.log("Response:", response);
console.log("Updated installed:", installed);
```

### Check File Permissions

```bash
# Should see drwx (readable, writable)
ls -ld ~/.claude/skills/

# Should see -rw- (readable, writable)
ls -l ~/.claude/skills/{skill-name}/SKILL.md
```

### Verify JSON Structure

```bash
# Check tags.json format
cat ~/.claude/projects/{id}/tags.json | jq .

# Should output valid JSON structure
```

---

## Reference Commands

### Development
```bash
# Start dev server
pnpm tauri dev

# Build for distribution
pnpm tauri build

# Type check
pnpm tsc --noEmit

# Run tests
pnpm test
```

### Debugging
```bash
# View console logs
# Press F12 in app window

# Check file system
ls -la ~/.claude/

# Test Tauri command
# Use browser dev tools console
await invoke("list_local_skills")
```

---

## Success Checklist

### Skills Installation Complete When:
- [ ] New `install_skill_template()` command works
- [ ] Marketplace skills install to correct location
- [ ] Installed skills appear in Settings → Skills
- [ ] All tests pass
- [ ] No regressions in other features
- [ ] Documentation updated

### Session Tagging Complete When:
- [ ] Tags can be added/removed from sessions
- [ ] Tags filter sessions correctly
- [ ] Tag autocomplete works
- [ ] Tags persist across restarts
- [ ] Tag statistics display
- [ ] Search integrates with tags
- [ ] Performance benchmarks met
- [ ] All tests pass
- [ ] User documentation ready

---

## Next Steps After Implementation

1. **Update CHANGELOG.md** with new features
2. **Create user documentation** for tagging feature
3. **Add keyboard shortcuts** for power users
4. **Monitor performance** in production
5. **Gather user feedback** on tag naming
6. **Plan tag export** for backups
7. **Consider tag templates** for common workflows

---

## Related Documents

- **OPENCODE_RESEARCH.md** - Full architecture analysis
- **SKILLS_INSTALLATION_SPEC.md** - Detailed implementation
- **SESSION_TAGGING_SPEC.md** - Complete tagging spec
- **RESEARCH_SUMMARY.md** - Executive overview

---

## Quick Links

| Document | Purpose | Length |
|----------|---------|--------|
| OPENCODE_RESEARCH.md | Architecture deep-dive | 500+ lines |
| SKILLS_INSTALLATION_SPEC.md | Skills feature spec | 400+ lines |
| SESSION_TAGGING_SPEC.md | Tagging feature spec | 700+ lines |
| RESEARCH_SUMMARY.md | Executive summary | 300+ lines |
| QUICK_START_GUIDE.md | This file | Quick ref |

---

## Questions?

Refer to the detailed specification documents for:
- Complete code examples
- Error handling strategies
- Testing procedures
- Migration paths
- Performance considerations
- Rollback procedures

Each document is self-contained and includes comprehensive implementation guidance.
