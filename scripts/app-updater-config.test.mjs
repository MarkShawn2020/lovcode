import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("desktop updater runtime and signed artifact contract stay connected", async () => {
  const [packageJson, cargoToml, tauriConfigText, capabilityText, runSource] = await Promise.all([
    read("package.json"),
    read("src-tauri/Cargo.toml"),
    read("src-tauri/tauri.conf.json"),
    read("src-tauri/capabilities/default.json"),
    read("src-tauri/src/app/run.rs"),
  ]);

  const packageConfig = JSON.parse(packageJson);
  const tauriConfig = JSON.parse(tauriConfigText);
  const capability = JSON.parse(capabilityText);

  assert.equal(packageConfig.dependencies["@tauri-apps/plugin-updater"], "^2.10.1");
  assert.equal(packageConfig.dependencies["@tauri-apps/plugin-process"], "^2.3.1");
  assert.match(cargoToml, /tauri-plugin-updater/);
  assert.match(cargoToml, /tauri-plugin-process/);
  assert.match(runSource, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(runSource, /tauri_plugin_process::init\(\)/);
  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
  assert.deepEqual(tauriConfig.plugins.updater.endpoints, [
    "https://github.com/lovstudio/Ataru/releases/latest/download/latest.json",
  ]);
  assert.ok(tauriConfig.plugins.updater.pubkey.length > 80);
  assert.ok(capability.permissions.includes("updater:default"));
  assert.ok(capability.permissions.includes("process:default"));
});

test("release publication stops when signed updater assets are absent", async () => {
  const workflow = await read(".github/workflows/release.yml");
  assert.match(workflow, /Signed Tauri updater assets are required before publishing/);
  assert.match(workflow, /generate-updater-manifest\.mjs/);
  assert.match(workflow, /gh release upload[\s\S]*latest\.json --clobber/);
});
