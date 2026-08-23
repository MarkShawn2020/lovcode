import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_PROJECTS_FILTER,
  ALL_SOURCES_FILTER,
  filterSessions,
  getProjectFilterOptions,
} from "../src/lib/sessionFilters.ts";

const sessions = [
  {
    id: "codex-session",
    project_id: "ataru-worktree",
    project_path: "/Users/mark/projects/ataru/.worktrees/3jht5",
    title: "修复会话列表",
    summary: null,
    source: "codex",
  },
  {
    id: "claude-session",
    project_id: "yoda-main",
    project_path: "/Users/mark/lovstudio/coding/yoda",
    title: "检查运行时",
    summary: null,
    source: "cli",
  },
];

test("combines project, source, and keyword filters", () => {
  const results = filterSessions(sessions, {
    query: "会话",
    projectId: "ataru-worktree",
    source: "codex",
  });
  assert.deepEqual(results.map((session) => session.id), ["codex-session"]);
});

test("uses source labels in keyword filtering", () => {
  const results = filterSessions(sessions, {
    query: "Claude Code",
    projectId: ALL_PROJECTS_FILTER,
    source: ALL_SOURCES_FILTER,
  });
  assert.deepEqual(results.map((session) => session.id), ["claude-session"]);
});

test("builds distinct project options with worktree-aware labels", () => {
  assert.deepEqual(getProjectFilterOptions(sessions), [
    { value: "ataru-worktree", label: "ataru（3jht5）" },
    { value: "yoda-main", label: "yoda" },
  ]);
});
