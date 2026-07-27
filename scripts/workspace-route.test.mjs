import assert from "node:assert/strict";
import test from "node:test";
import { updateWorkspaceConversationRoute } from "../src/lib/workspaceRoute.ts";

test("promotes a project overview route to a history conversation route", () => {
  const current = new URLSearchParams({
    view: "active",
    projectPath: "/Users/mark/Documents/Codex/2026-07-23/dui",
  });

  const next = updateWorkspaceConversationRoute(current, {
    projectId: "-Users-mark-Documents-Codex-2026-07-23-dui",
    projectPath: "/Users/mark/Documents/Codex/2026-07-23/dui",
    sessionId: "019f8d65-93d9-7e51-aac1-232d97b5e895",
  });

  assert.equal(next.get("view"), "active");
  assert.equal(next.get("projectId"), "-Users-mark-Documents-Codex-2026-07-23-dui");
  assert.equal(next.get("projectPath"), "/Users/mark/Documents/Codex/2026-07-23/dui");
  assert.equal(next.get("sessionId"), "019f8d65-93d9-7e51-aac1-232d97b5e895");
});

test("clears stale history and message targeting when selecting a runtime conversation", () => {
  const current = new URLSearchParams({
    projectId: "stale-project",
    projectPath: "/stale/project",
    sessionId: "stale-session",
    messageId: "stale-message",
    lineNumber: "42",
    roundIndex: "3",
    q: "stale query",
  });

  const next = updateWorkspaceConversationRoute(current, {
    projectPath: "/current/project",
    sessionId: "runtime-session",
  });

  assert.equal(next.get("projectId"), null);
  assert.equal(next.get("projectPath"), "/current/project");
  assert.equal(next.get("sessionId"), "runtime-session");
  assert.equal(next.get("messageId"), null);
  assert.equal(next.get("lineNumber"), null);
  assert.equal(next.get("roundIndex"), null);
  assert.equal(next.get("q"), null);
});
