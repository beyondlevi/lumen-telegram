// Builds the offline package <package-name>.mrbd.zip from dist/ and writes it
// to dist/. Usage: npm run package (builds first), or
// node scripts/package-offline.mjs [distDir].
//
// Format expected by the Lumen host (the package is unzipped and served at
// http://127.0.0.1:<port>/ with an SPA fallback to index.html):
// - the contents of dist/ at the ROOT of the zip (index.html at the root, no top folder);
// - manifest.webmanifest at the root with id, name, short_name, version (same as
//   package.json), start_url, display and at least one square PNG icon >= 192 px
//   included in the zip;
// - lumen_config (fields the phone companion fills in) and lumen_internet
//   (route the phone's internet to the package) for this app.
// Zip entries use a fixed UTC date, so the same dist/ always yields the same zip.
process.env.TZ = 'UTC';
import fs from 'node:fs';
import path from 'node:path';
import {zipSync} from 'fflate';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const distDir = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
const appName = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name;
const zipName = `${appName}.mrbd.zip`;
const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');
const REQUIRED_CONFIG_KEYS = ['telegram.apiId', 'telegram.apiHash', 'telegram.session'];

function fail(message) {
  console.error(`package-offline: ${message}`);
  process.exit(1);
}

function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listFiles(path.join(dir, entry.name), rel);
    return entry.isFile() ? [rel] : [];
  });
}

function pngSize(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) return null;
  return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

if (!fs.existsSync(path.join(distDir, 'index.html'))) fail(`no index.html in ${distDir}`);
const manifestPath = path.join(distDir, 'manifest.webmanifest');
if (!fs.existsSync(manifestPath)) fail('no manifest.webmanifest at the root of dist/');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const key of ['id', 'name', 'short_name', 'start_url', 'display', 'icons']) {
  if (!manifest[key]) fail(`manifest is missing "${key}"`);
}
if (manifest.start_url !== './') fail('start_url must be "./"');
if (manifest.display !== 'standalone') fail('display must be "standalone"');
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (manifest.version !== appVersion) fail(`manifest "version" must match package.json (${appVersion})`);
if (manifest.lumen_internet !== true) fail('manifest must set "lumen_internet": true');
const configKeys = Array.isArray(manifest.lumen_config)
  ? manifest.lumen_config.map(field => field?.key)
  : [];
for (const key of REQUIRED_CONFIG_KEYS) {
  if (!configKeys.includes(key)) fail(`lumen_config is missing "${key}"`);
}

const files = listFiles(distDir)
  .filter(file => !file.endsWith('.mrbd.zip'))
  .sort();

const bigIcon = manifest.icons.find(icon => {
  const rel = String(icon.src).replace(/^\.?\//, '');
  if (!files.includes(rel)) return false;
  const size = pngSize(fs.readFileSync(path.join(distDir, rel)));
  return size !== null && size.width === size.height && size.width >= 192;
});
if (!bigIcon) fail('manifest needs a square PNG icon >= 192 px included in the zip');

// Assets must resolve from the local origin (http://127.0.0.1:<port>/).
const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const external = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map(m => m[0]);
if (external.length) fail(`index.html references external resources: ${external.join(', ')}`);

// The E2E build's scripted Telegram must never ship.
for (const file of files.filter(name => name.endsWith('.js'))) {
  if (fs.readFileSync(path.join(distDir, file), 'utf8').includes('__fakeTelegram')) fail(`${file} contains the E2E fake Telegram`);
}
const secretKeys = manifest.lumen_config.filter(field => field?.type === 'secret').map(field => field.key);
for (const key of ['telegram.apiHash', 'telegram.session']) {
  if (!secretKeys.includes(key)) fail(`lumen_config "${key}" must be of type "secret"`);
}

const entries = {};
for (const file of files) {
  entries[file] = [new Uint8Array(fs.readFileSync(path.join(distDir, file))), {mtime: FIXED_MTIME}];
}
const zipped = zipSync(entries, {level: 9});
fs.writeFileSync(path.join(distDir, zipName), zipped);

console.log(`package-offline: dist/${zipName} ${zipped.length} B, ${files.length} files`);
for (const file of files) console.log(`  ${file}`);
