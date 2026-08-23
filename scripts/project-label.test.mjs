import assert from "node:assert/strict";
import test from "node:test";
import { projectLabel } from "../src/lib/projectLabel.ts";

test("shows the project and branch for an in-repository worktree", () => {
  assert.equal(
    projectLabel("/Users/mark/projects/ataru/.worktrees/3jht5", "ataru-worktree"),
    "ataru（3jht5）",
  );
});

test("shows the project and branch for an external worktree", () => {
  assert.equal(
    projectLabel(
      "/Users/mark/emdash/worktrees/lovstudio/emdash/easy-towns-joke-leyko",
      "emdash-worktree",
    ),
    "emdash（easy-towns-joke-leyko）",
  );
});

test("keeps a regular project label unchanged", () => {
  assert.equal(projectLabel("/Users/mark/projects/ataru", "ataru"), "ataru");
});

test("falls back to the project id when the path is unavailable", () => {
  assert.equal(projectLabel(null, "-Users-mark-projects-ataru"), "-Users-mark-projects-ataru");
});
