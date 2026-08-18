const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const cargoPath = path.join(root, 'src-tauri/Cargo.toml');
let cargo = fs.readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(/^version = "[^"]+"$/m, `version = "${pkg.version}"`);
fs.writeFileSync(cargoPath, cargo);
console.log(`✓ Cargo.toml → ${pkg.version}`);

// tauri.conf.json 的 version 字段优先于 Cargo.toml，必须一并同步，
// 否则打包产物与 updater manifest 会停留在旧版本号。
const confPath = path.join(root, 'src-tauri/tauri.conf.json');
let conf = fs.readFileSync(confPath, 'utf8');
const before = conf;
conf = conf.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${pkg.version}"`);
if (conf === before) {
  console.error('✗ tauri.conf.json: version 字段未找到');
  process.exit(1);
}
fs.writeFileSync(confPath, conf);
console.log(`✓ tauri.conf.json → ${pkg.version}`);
