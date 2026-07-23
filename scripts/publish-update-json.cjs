#!/usr/bin/env node
/**
 * 合并 GitHub Release 上各 build target 的 .sig 产物,
 * 生成一份覆盖所有平台的 latest.json 并上传覆盖旧的 latest.json。
 *
 * 解决 `tauri-action` 在 matrix 并行下 last-writer-wins 让 macOS 条目被吞的问题。
 *
 * 输入:环境变量 TAG (GitHub Release tag)、sigs/ 目录里有 `gh release download --pattern '*.sig'` 拉下来的签名。
 * 输出:在 release 上覆盖 latest.json。
 * 不需要 macOS 签名/notarization 凭证 —— 只读签名文本,不再构建。
 */
const { readFileSync, writeFileSync, readdirSync } = require("node:fs");
const { execSync } = require("node:child_process");
const path = require("node:path");

const TAG = process.env.TAG;
if (!TAG) {
  console.error("TAG env required");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;

const sigsDir = path.join(root, "sigs");
const sigs = new Map();
for (const f of readdirSync(sigsDir)) {
  if (f.endsWith(".sig")) sigs.set(f, readFileSync(path.join(sigsDir, f), "utf8").trim());
}

const repo = process.env.GITHUB_REPOSITORY || "lovstudio/lovcode";
const baseUrl = `https://github.com/${repo}/releases/download/${TAG}`;

function entryFor(file) {
  const sigName = `${file}.sig`;
  const sig = sigs.get(sigName);
  if (!sig) return null;
  return { url: `${baseUrl}/${file}`, signature: sig };
}

// 平台 key → 上传文件名。同一 .tar.gz 会映射到两个 key(如 darwin-aarch64 / -app),
// 见 tauri-plugin-updater 2.10 的候选列表 {os}-{arch}-{installer} 与 {os}-{arch}。
// 顺序与 tauri-action 默认输出保持一致。
const mappings = [
  ["darwin-aarch64", () => entryFor("lovcode_aarch64.app.tar.gz")],
  ["darwin-aarch64-app", () => entryFor("lovcode_aarch64.app.tar.gz")],
  ["darwin-x86_64", () => entryFor("lovcode_x64.app.tar.gz")],
  ["darwin-x86_64-app", () => entryFor("lovcode_x64.app.tar.gz")],
  ["linux-x86_64", () => entryFor(`lovcode_${version}_amd64.AppImage`)],
  ["linux-x86_64-appimage", () => entryFor(`lovcode_${version}_amd64.AppImage`)],
  ["linux-x86_64-deb", () => entryFor(`lovcode_${version}_amd64.deb`)],
  ["linux-x86_64-rpm", () => entryFor(`lovcode-${version}-1.x86_64.rpm`)],
  ["windows-x86_64", () => entryFor(`lovcode_${version}_x64_en-US.msi`)],
  ["windows-x86_64-msi", () => entryFor(`lovcode_${version}_x64_en-US.msi`)],
  ["windows-x86_64-nsis", () => entryFor(`lovcode_${version}_x64-setup.exe`)],
];

const platforms = {};
for (const [key, fn] of mappings) {
  if (platforms[key]) continue; // 同一 tarball 已用裸 key 占位,-app / -nsis 等后缀共用 entry
  const e = fn();
  if (e) platforms[key] = e;
  else console.warn(`skip ${key}: missing ${fn.toString().match(/entryFor\("([^"]+)"\)/)?.[1] || "unknown"}.sig`);
}

const release = JSON.parse(
  execSync(`gh release view "${TAG}" --json publishedAt`, { encoding: "utf8" })
);

const latest = {
  version,
  notes: "", // tauri-action 原从 CHANGELOG 提取;客户端 UpdateChecker 不读,后续可加
  pub_date: release.publishedAt,
  platforms,
};

const outPath = path.join(root, "latest.json");
writeFileSync(outPath, JSON.stringify(latest, null, 2));
execSync(`gh release upload "${TAG}" "${outPath}" --clobber`, { stdio: "inherit" });
console.log(`latest.json uploaded: keys=${Object.keys(platforms).join(", ")}`);
