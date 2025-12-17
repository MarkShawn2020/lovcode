#!/usr/bin/env node
// Tauri 2 版本管理脚本 - 同步 package.json 和 Cargo.toml

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const packageJsonPath = path.join(root, 'package.json');
const cargoTomlPath = path.join(root, 'src-tauri/Cargo.toml');
const tauriConfPath = path.join(root, 'src-tauri/tauri.conf.json');

// 读取当前版本
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;
const [major, minor, patch] = currentVersion.split('.').map(Number);

// 解析参数
let arg = process.argv[2];
let newVersion;

if (!arg) {
  console.error('用法: pnpm bump <patch|minor|major|x.y.z>');
  process.exit(1);
}

switch (arg) {
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  default:
    if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) {
      newVersion = arg;
    } else {
      console.error('错误: 使用 patch/minor/major 或 SemVer 格式 (如 1.0.0)');
      process.exit(1);
    }
}

// 更新 package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`✓ package.json: ${currentVersion} → ${newVersion}`);

// 更新 Cargo.toml
let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
cargoToml = cargoToml.replace(/^version = "[^"]+"$/m, `version = "${newVersion}"`);
fs.writeFileSync(cargoTomlPath, cargoToml);
console.log(`✓ Cargo.toml: ${currentVersion} → ${newVersion}`);

// 更新 tauri.conf.json
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = newVersion;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log(`✓ tauri.conf.json: ${currentVersion} → ${newVersion}`);

// Git commit 和 tag
if (!process.argv.includes('--no-git')) {
  try {
    execSync('git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json', { cwd: root, stdio: 'pipe' });
    execSync(`git commit -m "chore: bump version to ${newVersion}"`, { cwd: root, stdio: 'pipe' });
    execSync(`git tag v${newVersion}`, { cwd: root, stdio: 'pipe' });
    console.log(`✓ Git commit + tag v${newVersion}`);
    console.log('\n下一步: git push origin main --tags');
  } catch (e) {
    console.error('Git 操作失败:', e.message);
  }
}

console.log('\n版本更新完成!');
