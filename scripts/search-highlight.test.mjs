import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanSearchExcerpt,
  getSearchHighlightSegments,
  searchTerms,
} from "../src/modules/ui/ataru-search/utils.ts";

test("keeps underscore and hyphen identifiers as exact display terms", () => {
  assert.deepEqual(searchTerms("WECHAT_APP_SECRET"), ["WECHAT_APP_SECRET"]);
  assert.deepEqual(searchTerms("ego-browser"), ["ego-browser"]);
});

test("uses Google-like boolean and phrase semantics for positive highlight terms", () => {
  const terms = searchTerms('wechat AND "app secret" OR token -legacy NOT hidden');

  assert.deepEqual(new Set(terms), new Set(["wechat", "app secret", "token"]));
});

test("highlights only the complete underscore identifier", () => {
  assert.deepEqual(
    getSearchHighlightSegments(
      "wechat AppSecret SECRET_KEY MY_WECHAT_APP_SECRET_VALUE then wechat_app_secret.",
      "WECHAT_APP_SECRET",
    ),
    [
      { text: "wechat AppSecret SECRET_KEY MY_WECHAT_APP_SECRET_VALUE then ", highlighted: false },
      { text: "wechat_app_secret", highlighted: true },
      { text: ".", highlighted: false },
    ],
  );
});

test("highlights a quoted phrase as one range and ignores excluded terms", () => {
  assert.deepEqual(
    getSearchHighlightSegments(
      "app secret and legacy token",
      '"app secret" OR token -legacy',
    ),
    [
      { text: "app secret", highlighted: true },
      { text: " and legacy ", highlighted: false },
      { text: "token", highlighted: true },
    ],
  );
});

test("centers long result excerpts only on the complete identifier", () => {
  const excerpt = cleanSearchExcerpt(
    `${"unrelated context ".repeat(30)}settings.py exposes WECHAT_APP_SECRET fields`,
    "WECHAT_APP_SECRET",
    96,
  );

  assert.ok(excerpt.startsWith("…"));
  assert.match(excerpt, /WECHAT_APP_SECRET/);
  assert.ok(excerpt.indexOf("WECHAT_APP_SECRET") <= 25);

  const partialOnly = cleanSearchExcerpt(
    `${"unrelated context ".repeat(30)}settings.py exposes AppSecret fields`,
    "WECHAT_APP_SECRET",
    96,
  );
  assert.doesNotMatch(partialOnly, /AppSecret/);
});
