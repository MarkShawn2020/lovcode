const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
cargo = cargo.replace(/^version = "[^"]+"$/m, `version = "${pkg.version}"`);
fs.writeFileSync(path.join(root, 'src-tauri/Cargo.toml'), cargo);
console.log(`✓ Cargo.toml → ${pkg.version}`);
