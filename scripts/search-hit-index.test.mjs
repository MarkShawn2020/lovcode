import assert from "node:assert/strict";
import test from "node:test";
import {
  searchHitIndexAsJson,
  searchHitIndexesAsJson,
} from "../src/modules/ui/ataru-search/utils.ts";

const baseHit = {
  id: "message:-Users-mark-projects-ataru:session-1:message-2:42",
  level: "turn",
  title: "",
  snippet: "Search result evidence",
  projectId: "-Users-mark-projects-ataru",
  projectPath: "/Users/mark/projects/ataru",
  sessionId: "session-1",
  runIndex: 7,
  messageId: "message-2",
  lineNumber: 42,
  role: "assistant",
  matchCount: 1,
  sessionCount: 1,
  score: 1,
  signals: { fusion: 1 },
};

test("copies the stable identifiers an Agent needs to inspect a Turn hit", () => {
  assert.deepEqual(JSON.parse(searchHitIndexAsJson(baseHit)), {
    schema: "ataru-search-hit/v1",
    operation: "inspect_search_hit",
    target: {
      id: baseHit.id,
      level: "turn",
      projectId: "-Users-mark-projects-ataru",
      projectPath: "/Users/mark/projects/ataru",
      sessionId: "session-1",
      runIndex: 7,
      messageId: "message-2",
      lineNumber: 42,
    },
  });
});

test("omits unavailable locators instead of copying ambiguous empty values", () => {
  const projectHit = {
    ...baseHit,
    id: "project:-Users-mark-projects-ataru",
    level: "project",
    sessionId: undefined,
    runIndex: undefined,
    messageId: undefined,
    lineNumber: undefined,
  };

  assert.deepEqual(JSON.parse(searchHitIndexAsJson(projectHit)), {
    schema: "ataru-search-hit/v1",
    operation: "inspect_search_hit",
    target: {
      id: "project:-Users-mark-projects-ataru",
      level: "project",
      projectId: "-Users-mark-projects-ataru",
      projectPath: "/Users/mark/projects/ataru",
    },
  });
});

test("copies every displayed hit in its current order for Agent follow-up", () => {
  const projectHit = {
    ...baseHit,
    id: "project:-Users-mark-projects-ataru",
    level: "project",
    sessionId: undefined,
    runIndex: undefined,
    messageId: undefined,
    lineNumber: undefined,
  };

  const payload = JSON.parse(searchHitIndexesAsJson(
    [projectHit, baseHit],
    "copy all indexes",
  ));

  assert.equal(payload.schema, "ataru-search-hits/v1");
  assert.equal(payload.operation, "inspect_search_hits");
  assert.equal(payload.query, "copy all indexes");
  assert.equal(payload.count, 2);
  assert.deepEqual(
    payload.targets.map((target) => target.id),
    [projectHit.id, baseHit.id],
  );
  assert.equal(payload.targets[1].lineNumber, 42);
});
