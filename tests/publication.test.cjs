'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const OUT = require('../scripts/build-pages.cjs').build();
const html = fs.readFileSync(path.join(OUT, 'empire.html'), 'utf8');

test('Pages artifact includes the actual catalog and all ordered frontend entry points', () => {
  assert.ok(fs.statSync(path.join(OUT, 'game/catalog.js')).size > 0);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['game/catalog.js', 'game/model.js', 'game/dashboard.js']);
  assert.equal(require('../game/catalog.js').businesses.length, 9);
  assert.equal(require('../game/catalog.js').missions.length, 18);
});

test('Pages artifact is static and omits all backend, fixture, test and release content', () => {
  assert.match(html, /data-deployment="static"/);
  assert.match(html, /connect-src 'none'/);
  assert.ok(fs.existsSync(path.join(OUT, '.nojekyll')));
  for (const excluded of ['bridge', 'tests', 'release', '.github', 'scripts', 'package.json', 'README.md', 'docs/START_HERE.md']) {
    assert.equal(fs.existsSync(path.join(OUT, excluded)), false, excluded);
  }
});

test('HTML links and styles resolve beneath a GitHub Pages repository prefix', () => {
  for (const filename of ['index.html', 'empire.html']) {
    const source = fs.readFileSync(path.join(OUT, filename), 'utf8');
    for (const [, reference] of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(?:https?:|#|data:)/.test(reference)) continue;
      assert.ok(!reference.startsWith('/'), filename + ' uses an origin-root path: ' + reference);
      const resolved = new URL(reference, 'https://example.github.io/empire-of-businesses-game/' + filename);
      assert.ok(resolved.pathname.startsWith('/empire-of-businesses-game/'));
      assert.ok(fs.statSync(path.join(OUT, reference)).isFile(), reference);
    }
  }
  for (const filename of ['css/demo.css', 'game/empire.css']) {
    const source = fs.readFileSync(path.join(OUT, filename), 'utf8');
    for (const [, reference] of source.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) {
      assert.ok(!reference.startsWith('/'));
      assert.ok(fs.statSync(path.resolve(OUT, path.dirname(filename), reference)).isFile(), reference);
    }
  }
});

test('station sprite sheets, font and furniture remain in their referenced paths', () => {
  const gods = ['zeus', 'hera', 'athena', 'hermes', 'hephaestus', 'apollo', 'hades', 'dionysus', 'poseidon', 'ares', 'artemis', 'aphrodite', 'demeter'];
  for (const god of gods) assert.ok(fs.statSync(path.join(OUT, 'assets/sprites', god + '.png')).size > 0);
  assert.ok(fs.statSync(path.join(OUT, 'assets/fonts/vt323.woff2')).size > 0);
  for (const directory of ['assets/furniture', 'assets/industrial']) {
    assert.deepEqual(fs.readdirSync(path.join(OUT, directory)), fs.readdirSync(path.join(ROOT, directory)));
  }
});

test('Node test guard fails for missing or empty suites instead of a green zero-test run', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'empire-test-guard-'));
  try {
    fs.mkdirSync(path.join(temp, 'scripts')); fs.mkdirSync(path.join(temp, 'tests'));
    fs.copyFileSync(path.join(ROOT, 'scripts/run-node-tests.cjs'), path.join(temp, 'scripts/run-node-tests.cjs'));
    for (const createEmptyFiles of [false, true]) {
      if (createEmptyFiles) for (const name of ['model', 'dashboard', 'publication']) fs.writeFileSync(path.join(temp, 'tests', name + '.test.cjs'), '');
      const result = spawnSync(process.execPath, [path.join(temp, 'scripts/run-node-tests.cjs')], { encoding: 'utf8' });
      assert.equal(result.status, 1); assert.match(result.stderr, /Test guard:/);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Python test guard fails for missing or empty suites instead of a green zero-test run', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'empire-python-guard-'));
  try {
    fs.mkdirSync(path.join(temp, 'scripts')); fs.mkdirSync(path.join(temp, 'tests'));
    fs.copyFileSync(path.join(ROOT, 'scripts/run-python-tests.py'), path.join(temp, 'scripts/run-python-tests.py'));
    for (const createEmptyFiles of [false, true]) {
      if (createEmptyFiles) for (const name of ['test_bridge.py', 'test_bridge_budget.py']) fs.writeFileSync(path.join(temp, 'tests', name), '');
      const result = spawnSync('python3', [path.join(temp, 'scripts/run-python-tests.py')], { encoding: 'utf8' });
      assert.notEqual(result.status, 0); assert.match(result.stderr, /Test guard:/);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
