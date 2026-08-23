import assert from "node:assert/strict";
import test from "node:test";
import {
  SELECT_FILTER_THRESHOLD,
  selectOptionMatches,
  shouldEnableSelectFilter,
} from "../src/lib/selectFilter.ts";

test("enables input filtering only when a dropdown exceeds ten options", () => {
  assert.equal(SELECT_FILTER_THRESHOLD, 10);
  assert.equal(shouldEnableSelectFilter(10), false);
  assert.equal(shouldEnableSelectFilter(11), true);
});

test("matches dropdown options case-insensitively across multiple terms", () => {
  assert.equal(selectOptionMatches("Ataru（feature/search）", "ataru search"), true);
  assert.equal(selectOptionMatches("Claude App · Code", "claude code"), true);
  assert.equal(selectOptionMatches("Claude Web", "codex"), false);
});
