# OpenCode Research - Executive Summary

## Research Limitations

Due to restrictions on web fetching tools, I was unable to directly access the OpenCode repository at https://github.com/anomalyco/opencode. However, I have conducted an in-depth analysis of the **Lovcode codebase** to understand existing patterns and provide comprehensive implementation specifications for:

1. **Skills Installation System** - Fixing the broken marketplace skills installation
2. **Session Tagging System** - Adding advanced conversation organization
3. **Enhanced Search Features** - Building on existing full-text search capabilities

## Key Findings from Lovcode Analysis

### 1. Current Architecture Strengths

**Template Installation System:**
- Well-designed pattern for installing multiple template types
- Five different installation strategies: commands, MCPs, hooks, settings, statuslines
- Robust error handling and config merging
- Works with marketplace integration

**Existing Skills Implementation:**
- Properly reads and lists skills from `~/.claude/skills/{name}/SKILL.md`
- Parses frontmatter metadata correctly
- UI components ready to display skills
- **Gap**: Installation logic not implemented

**Search Infrastructure:**
- Tantivy full-text search engine with Chinese tokenization
- Relevance scoring on search results
- Session-level search capabilities
- Ready for tag-based filtering

### 2. Critical Issues Identified

**Skills Installation Bug:**
- Marketplace cannot install skills properly
- Root cause: `install_command_template()` creates `~/.claude/commands/{name}.md`
- Skills expect: `~/.claude/skills/{name}/SKILL.md`
- **Solution**: Create dedicated `install_skill_template()` function (20 lines of Rust)

**Missing Session Organization:**
- No tagging/labeling system for conversations
- Current search is content-only
- Users cannot categorize or batch-filter sessions
- **Solution**: Implement lightweight tags.json per project with Rust + React components

## Deliverables Created

### 1. **OPENCODE_RESEARCH.md** (Comprehensive Analysis)
- Detailed architecture overview of Lovcode
- Skills system deep-dive with code examples
- Template installation patterns analysis
- Marketplace integration architecture
- Session structure and search capabilities
- Pattern extraction from 5+ template types

### 2. **SKILLS_INSTALLATION_SPEC.md** (Implementation Guide)
- Root cause analysis
- Complete Rust backend implementation
- TypeScript/React frontend updates
- Error handling strategy
- Testing approach
- Backward compatibility considerations
- Rollout and rollback plans

**Key Changes:**
```rust
// Add this single function to lib.rs
#[tauri::command]
fn install_skill_template(name: String, content: String) -> Result<String, String> {
    let skills_dir = get_claude_dir().join("skills");
    let skill_dir = skills_dir.join(&name);
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    let skill_file = skill_dir.join("SKILL.md");
    fs::write(&skill_file, content).map_err(|e| e.to_string())?;
    Ok(skill_file.to_string_lossy().to_string())
}
```

### 3. **SESSION_TAGGING_SPEC.md** (Advanced Features)
- Session tag data model design
- Per-project tags.json storage strategy
- Complete Rust backend implementation (7 commands)
- Custom React hooks (useSessionTags, useProjectTags, useTagSearch)
- UI components (SessionTagInput, SessionTagFilter)
- Integration with existing SessionList
- Migration and cleanup strategies

**Key Data Structure:**
```json
~/.claude/projects/{project-id}/tags.json
{
  "tags": [
    {
      "sessionId": "uuid",
      "tag": "bug-fix",
      "createdAt": 1704067200000
    }
  ]
}
```

## Architecture Patterns Discovered

### 1. File-Based Configuration Pattern
All Claude Code ecosystem components use file-based config:
- **Markdown files**: Commands, Skills (human-editable)
- **JSON files**: MCPs, Settings, Hooks (structured config)
- **Directory hierarchy**: Maintains organization

**Insight for Skills:** Directory structure matters. Each skill needs its own directory to:
- Support future multi-file skills
- Maintain readability
- Enable easy discovery and deletion

### 2. Installation Strategy Hierarchy

```
SIMPLE: Direct file write
  → Commands, Skills

STRUCTURED: Parse + Merge
  → MCPs (auto-detect type), Hooks (append to arrays)

CONFIG: Deep merge
  → Settings (preserve existing keys)

SYSTEM: Permissions handling
  → Statuslines (set executable bit)
```

### 3. Storage Efficiency Patterns

**Session Tagging Approach (Recommended):**
- ✓ Uses separate tags.json (not modifying session storage)
- ✓ No database migration needed
- ✓ Human-readable format
- ✓ Per-project organization
- ✓ Easy backup/restore

## Implementation Roadmap

### Phase 1: Skills Installation (Days 1-2)
**Effort:** 1-2 developer-days
**Risk:** Low (isolated change, existing patterns)
**Impact:** High (fixes broken marketplace feature)

Files to modify:
1. `src-tauri/src/lib.rs` - Add 20 lines
2. `src/views/Marketplace/TemplateDetailView.tsx` - Update 4 lines

### Phase 2: Session Tagging (Weeks 1-2)
**Effort:** 3-5 developer-days
**Risk:** Medium (new data structure, migration)
**Impact:** High (major UX enhancement)

Files to create:
1. `src/hooks/useSessionTags.ts` - 150 lines
2. `src/components/SessionTagInput.tsx` - 150 lines
3. `src/components/SessionTagFilter.tsx` - 200 lines

Files to modify:
1. `src-tauri/src/lib.rs` - Add 200 lines
2. `src/views/Chat/SessionList.tsx` - Integrate components
3. `src/types/index.ts` - Add types

### Phase 3: Search Integration (Weeks 2-3)
**Effort:** 1-2 developer-days
**Risk:** Low (extends existing search)
**Impact:** Medium (improves discoverability)

Adds:
1. Combined text + tag search
2. Export with tag metadata
3. Tag-based session grouping

## What We Can Learn from OpenCode

### Areas of Interest (if OpenCode is similar project)
1. **How do they handle plugin/skill installation?**
   - Directory structure requirements
   - Validation before installation
   - Rollback mechanisms

2. **Session/Chat management:**
   - Do they implement conversation grouping?
   - How is conversation metadata stored?
   - Search and filtering approaches

3. **Marketplace architecture:**
   - Template discovery mechanism
   - Installation verification
   - Version management

4. **Data persistence:**
   - File vs database
   - Migration strategies
   - Backup/restore approaches

### Implementation Patterns to Verify
- [ ] Directory structure for skills/plugins
- [ ] Metadata storage format
- [ ] Installation error handling
- [ ] Tag/label storage strategy
- [ ] Search filtering approach
- [ ] Config merging logic

## Critical Dependencies

### For Skills Installation
- ✓ All dependencies already in project
- ✓ No new crates needed
- ✓ No breaking changes required

### For Session Tagging
- ✓ Chrono (already imported)
- ✓ Serde (already imported)
- ✓ React hooks (standard)
- ⚠ May want to add: `uuid` for tag IDs (optional)

## Rollout Strategy

### Low-Risk Approach
1. **Skills Installation First** (Day 1)
   - Quick win
   - Validates fix pattern
   - Unblocks marketplace

2. **Session Tagging Phase 2** (Week 1-2)
   - More complex
   - Comprehensive testing
   - User feedback loop

3. **Search Integration Phase 3** (Week 2-3)
   - Polish and refinement
   - Performance optimization

## Success Metrics

### Skills Installation
- ✓ Marketplace skills install to correct directory
- ✓ Installed skills appear in SkillsView
- ✓ No regression in other template types
- ✓ < 5% of users report installation issues

### Session Tagging
- ✓ Users adopt tagging (> 50% of sessions tagged within month)
- ✓ Tag filtering works instantly (< 100ms)
- ✓ Autocomplete appears within 100ms
- ✓ No performance degradation

## Next Steps

### For Lovcode Team
1. **Review specs** in order of dependencies
2. **Implement Skills Installation first** (highest priority, lowest risk)
3. **Gather feedback** before Session Tagging
4. **Iterate based on user needs**

### For OpenCode Research
1. **Clone repository locally**
2. **Examine architecture** using suggestions in this doc
3. **Document findings** in similar format
4. **Compare patterns** with Lovcode
5. **Extract best practices** for cross-project learning

## Document References

### Detailed Specifications Provided

1. **OPENCODE_RESEARCH.md**
   - Complete Lovcode architecture analysis
   - Code patterns and examples
   - Marketplace integration details
   - Design system compliance notes

2. **SKILLS_INSTALLATION_SPEC.md**
   - Root cause analysis
   - Implementation details (Rust + TypeScript)
   - Testing strategy
   - Error handling approach
   - Backward compatibility guide

3. **SESSION_TAGGING_SPEC.md**
   - Data model design
   - Backend implementation (7 commands)
   - Frontend hooks and components
   - Integration examples
   - Migration strategy

## Timeline Estimate

| Phase | Task | Duration | Risk |
|-------|------|----------|------|
| 1 | Skills Installation | 1-2 days | Low |
| 2 | Session Tagging Backend | 2-3 days | Medium |
| 3 | Session Tagging Frontend | 2-3 days | Medium |
| 4 | Search Integration | 1-2 days | Low |
| 5 | Testing & Polish | 2-3 days | Low |
| **Total** | **All Features** | **1-2 weeks** | **Low-Medium** |

## Conclusion

### Key Takeaways

1. **Lovcode has robust foundations** for both features
   - Template system works well
   - Search infrastructure is solid
   - UI component library is comprehensive

2. **Skills bug is easy to fix**
   - Single function needed
   - Well-understood pattern
   - Low risk of regression

3. **Session tagging is feasible**
   - Lightweight storage approach
   - Fits existing architecture
   - No database needed
   - Incremental implementation possible

4. **Both features follow existing patterns**
   - File-based config
   - Proper validation
   - Error handling
   - Tauri IPC patterns

### Recommendations

1. **Prioritize Skills Installation** (fixes broken feature)
2. **Plan Session Tagging** (major enhancement)
3. **Document learnings** from OpenCode (when available)
4. **Consider ecosystem compatibility** (Claude Code patterns)

---

## Contact & Questions

For detailed questions about any specification, refer to:
- Code examples in SKILLS_INSTALLATION_SPEC.md
- Architecture details in OPENCODE_RESEARCH.md
- Integration examples in SESSION_TAGGING_SPEC.md

All specifications include:
- Complete code samples
- Error handling
- Testing strategies
- Rollback procedures
- Performance considerations
