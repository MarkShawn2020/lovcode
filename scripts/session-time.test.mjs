import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRelativeSessionTime,
  formatSessionTime,
  normalizeSessionTimeFormat,
} from "../src/lib/sessionTime.ts";

const now = Date.UTC(2026, 7, 22, 8, 0, 0);

test("relative time is the default display preference", () => {
  assert.equal(normalizeSessionTimeFormat(null), "relative");
  assert.equal(normalizeSessionTimeFormat("unexpected"), "relative");
  assert.equal(normalizeSessionTimeFormat("absolute"), "absolute");
});

test("formats recent session activity as relative time", () => {
  assert.equal(formatRelativeSessionTime(now / 1000 - 20, now), "刚刚");
  assert.equal(formatRelativeSessionTime(now / 1000 - 5 * 60, now), "5分钟前");
  assert.equal(formatRelativeSessionTime(now / 1000 - 3 * 60 * 60, now), "3小时前");
  assert.equal(formatRelativeSessionTime(now / 1000 - 24 * 60 * 60, now), "昨天");
});

test("can switch back to an absolute session time", () => {
  const localTimestamp = new Date(2026, 7, 22, 16, 0).getTime() / 1000;
  assert.match(formatSessionTime(localTimestamp, "absolute", now), /08[\/-]22.*16:00/);
});
