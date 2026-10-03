/* Produce only public frontend files. Never publish the bridge, tests or release archives. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const DIRS = ['assets', 'css', 'data', 'game', 'js'];
const FILES = ['index.html', 'empire.html', 'docs/PLAY.md', 'LICENSE'];
function copy(relative) {
  const source = path.join(ROOT, relative), target = path.join(OUT, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw Error('Refusing to publish symlink: ' + relative);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) copy(path.join(relative, entry));
  } else {
    if (!/\.(?:html|css|js|json|png|woff2|txt|md)$/.test(relative) && relative !== 'LICENSE') {
      throw Error('Unexpected public asset type: ' + relative);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}
function build() {
  // Validate essentials before replacing the generated output directory.
  for (const file of [...FILES, 'game/catalog.js', 'game/model.js', 'game/dashboard.js', 'assets/sprites/manifest.js']) {
    if (!fs.statSync(path.join(ROOT, file)).isFile()) throw Error('Missing required file: ' + file);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const entry of [...DIRS, ...FILES]) copy(entry);
  const htmlPath = path.join(OUT, 'empire.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('data-deployment="local"') || !html.includes("connect-src 'self'")) throw Error('Missing static safety markers');
  html = html.replace('data-deployment="local"', 'data-deployment="static"')
    .replace("connect-src 'self'", "connect-src 'none'");
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  console.log('Built static practice game in dist/ (no backend or private state).');
  return OUT;
}
if (require.main === module) build();
module.exports = { build };
