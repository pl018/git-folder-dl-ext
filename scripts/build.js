/**
 * Build script - bundles content script and service worker using esbuild.
 * Content scripts can't use ES modules in MV3, so we bundle them.
 * Service workers can use ES module imports if declared in manifest,
 * but bundling is simpler and more reliable.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const DIST = path.join(__dirname, '..', 'dist');

async function build() {
  // Clean dist
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });

  // Bundle content script
  await esbuild.build({
    entryPoints: [path.join(SRC, 'content', 'main.js')],
    bundle: true,
    outfile: path.join(DIST, 'content', 'main.js'),
    format: 'iife',
    target: 'chrome120',
    minify: false, // Keep readable for debugging
  });

  // Bundle service worker
  await esbuild.build({
    entryPoints: [path.join(SRC, 'background', 'service-worker.js')],
    bundle: true,
    outfile: path.join(DIST, 'background', 'service-worker.js'),
    format: 'iife',
    target: 'chrome120',
    minify: false,
  });

  // Bundle popup script
  await esbuild.build({
    entryPoints: [path.join(SRC, 'popup', 'popup.js')],
    bundle: true,
    outfile: path.join(DIST, 'popup', 'popup.js'),
    format: 'iife',
    target: 'chrome120',
    minify: false,
  });

  // Copy static files
  copyFile('manifest.json');
  copyFile('popup/popup.html');
  copyFile('popup/popup.css');
  copyDir('styles');
  copyDir('icons');

  // Update manifest to point to bundled files (remove module type)
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
  // Paths are already correct since we mirror the structure
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('Build complete -> dist/');
}

function copyFile(relPath) {
  const src = path.join(SRC, relPath);
  const dest = path.join(DIST, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

function copyDir(relPath) {
  const src = path.join(SRC, relPath);
  const dest = path.join(DIST, relPath);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
