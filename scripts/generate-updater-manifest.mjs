#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const INSTALLER_TARGETS = [
  {
    suffix: ".app.tar.gz",
    os: "darwin",
    installer: "app",
    basePriority: 100,
  },
  {
    suffix: ".AppImage",
    os: "linux",
    installer: "appimage",
    basePriority: 100,
  },
  {
    suffix: ".msi",
    os: "windows",
    installer: "msi",
    basePriority: 100,
  },
  {
    suffix: "-setup.exe",
    os: "windows",
    installer: "nsis",
    basePriority: 90,
  },
  {
    suffix: ".deb",
    os: "linux",
    installer: "deb",
    basePriority: 80,
  },
  {
    suffix: ".rpm",
    os: "linux",
    installer: "rpm",
    basePriority: 70,
  },
];

function inferArchitecture(assetName) {
  if (/(^|[._-])(aarch64|arm64)([._-]|$)/i.test(assetName)) return "aarch64";
  if (/(^|[._-])(x86_64|x64|amd64)([._-]|$)/i.test(assetName)) return "x86_64";
  if (/(^|[._-])(i686|x86)([._-]|$)/i.test(assetName)) return "i686";
  if (/(^|[._-])(armv7|armhf)([._-]|$)/i.test(assetName)) return "armv7";
  return null;
}

function classifyUpdaterAsset(assetName) {
  const target = INSTALLER_TARGETS.find(({ suffix }) => assetName.endsWith(suffix));
  if (!target) return null;

  const arch = inferArchitecture(assetName);
  if (!arch) return null;

  return { ...target, arch };
}

function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export async function buildUpdaterManifest({
  release,
  assets,
  readSignature,
  requiredPlatforms = [],
}) {
  const assetsByName = new Map(assets.map((asset) => [asset.name, asset]));
  const platforms = {};
  const basePriorities = new Map();

  for (const signatureAsset of assets) {
    if (!signatureAsset.name.endsWith(".sig")) continue;

    const updaterAssetName = signatureAsset.name.slice(0, -".sig".length);
    const updaterAsset = assetsByName.get(updaterAssetName);
    if (!updaterAsset) continue;

    const target = classifyUpdaterAsset(updaterAssetName);
    if (!target) continue;

    const entry = {
      signature: (await readSignature(signatureAsset)).trim(),
      url: updaterAsset.browser_download_url,
    };
    const baseKey = `${target.os}-${target.arch}`;
    const installerKey = `${baseKey}-${target.installer}`;

    platforms[installerKey] = entry;
    if ((basePriorities.get(baseKey) ?? -1) < target.basePriority) {
      platforms[baseKey] = entry;
      basePriorities.set(baseKey, target.basePriority);
    }
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error("No signed updater assets were found in the release");
  }

  const missingPlatforms = requiredPlatforms.filter((platform) => !platforms[platform]);
  if (missingPlatforms.length > 0) {
    throw new Error(`Missing required updater platforms: ${missingPlatforms.join(", ")}`);
  }

  const tagName = release.tag_name ?? "";
  return {
    version: tagName.replace(/^v/, ""),
    notes: release.body ?? "",
    pub_date: release.published_at ?? release.created_at ?? new Date().toISOString(),
    platforms: sortRecord(platforms),
  };
}

function githubHeaders(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubRequest(url, token, accept) {
  const response = await fetch(url, {
    headers: githubHeaders(token, accept),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${url}`);
  }
  return response;
}

async function generateFromGitHub({ repo, tag, output, requiredPlatforms }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");

  const apiBaseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const releaseResponse = await githubRequest(
    `${apiBaseUrl}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    token,
  );
  const release = await releaseResponse.json();
  const assetsResponse = await githubRequest(
    `${apiBaseUrl}/repos/${repo}/releases/${release.id}/assets?per_page=100`,
    token,
  );
  const assets = await assetsResponse.json();

  const manifest = await buildUpdaterManifest({
    release,
    assets,
    requiredPlatforms,
    readSignature: async (asset) => {
      const response = await githubRequest(
        `${apiBaseUrl}/repos/${repo}/releases/assets/${asset.id}`,
        token,
        "application/octet-stream",
      );
      return response.text();
    },
  });

  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Generated ${output} with ${Object.keys(manifest.platforms).length} updater platform entries`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      tag: { type: "string" },
      output: { type: "string", default: "latest.json" },
      require: { type: "string", default: "" },
    },
  });

  if (!values.repo || !values.tag) {
    throw new Error("Usage: generate-updater-manifest.mjs --repo OWNER/REPO --tag TAG");
  }

  await generateFromGitHub({
    repo: values.repo,
    tag: values.tag,
    output: values.output,
    requiredPlatforms: values.require.split(",").filter(Boolean),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
