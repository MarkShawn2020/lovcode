import assert from "node:assert/strict";
import test from "node:test";

import { buildUpdaterManifest } from "./generate-updater-manifest.mjs";

const release = {
  tag_name: "v1.2.3",
  body: "Release notes",
  published_at: "2026-07-27T01:00:00Z",
};

function asset(id, name) {
  return {
    id,
    name,
    browser_download_url: `https://example.test/${name}`,
  };
}

function signedAssetPair(id, name) {
  return [asset(id, name), asset(id + 1, `${name}.sig`)];
}

test("builds one complete manifest after all release assets are available", async () => {
  const assets = [
    ...signedAssetPair(1, "lovcode_aarch64.app.tar.gz"),
    ...signedAssetPair(3, "lovcode_x64.app.tar.gz"),
    ...signedAssetPair(5, "lovcode_1.2.3_x64_en-US.msi"),
    ...signedAssetPair(7, "lovcode_1.2.3_x64-setup.exe"),
    ...signedAssetPair(9, "lovcode_1.2.3_amd64.AppImage"),
    ...signedAssetPair(11, "lovcode_1.2.3_amd64.deb"),
    ...signedAssetPair(13, "lovcode-1.2.3-1.x86_64.rpm"),
    asset(15, "lovcode_1.2.3_aarch64.dmg"),
  ];

  const manifest = await buildUpdaterManifest({
    release,
    assets,
    readSignature: async (signatureAsset) => `signature:${signatureAsset.name}\n`,
    requiredPlatforms: [
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "windows-x86_64",
    ],
  });

  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.notes, "Release notes");
  assert.equal(manifest.pub_date, "2026-07-27T01:00:00Z");
  assert.deepEqual(Object.keys(manifest.platforms), [
    "darwin-aarch64",
    "darwin-aarch64-app",
    "darwin-x86_64",
    "darwin-x86_64-app",
    "linux-x86_64",
    "linux-x86_64-appimage",
    "linux-x86_64-deb",
    "linux-x86_64-rpm",
    "windows-x86_64",
    "windows-x86_64-msi",
    "windows-x86_64-nsis",
  ]);
  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://example.test/lovcode_aarch64.app.tar.gz",
  );
  assert.equal(
    manifest.platforms["windows-x86_64"].url,
    "https://example.test/lovcode_1.2.3_x64_en-US.msi",
  );
  assert.equal(
    manifest.platforms["linux-x86_64"].url,
    "https://example.test/lovcode_1.2.3_amd64.AppImage",
  );
  assert.equal(
    manifest.platforms["linux-x86_64"].signature,
    "signature:lovcode_1.2.3_amd64.AppImage.sig",
  );
});

test("fails before upload when a required target is absent", async () => {
  const assets = signedAssetPair(1, "lovcode_aarch64.app.tar.gz");

  await assert.rejects(
    buildUpdaterManifest({
      release,
      assets,
      readSignature: async () => "signature",
      requiredPlatforms: ["darwin-aarch64", "windows-x86_64"],
    }),
    /Missing required updater platforms: windows-x86_64/,
  );
});

test("fails when the release has no signed updater artifacts", async () => {
  await assert.rejects(
    buildUpdaterManifest({
      release,
      assets: [asset(1, "lovcode_1.2.3_aarch64.dmg")],
      readSignature: async () => "signature",
    }),
    /No signed updater assets were found/,
  );
});
