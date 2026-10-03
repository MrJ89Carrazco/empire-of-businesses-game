/* Controller regressions in a deliberately minimal DOM shim.
 * These are NOT browser/rendering, accessibility, or CSP tests. No network
 * request is made, no real browser profile is used, and saves stay in memory.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../game/catalog.js');
const M = require('../game/model.js');
const ROOT = path.resolve(__dirname, '..');

function harness(saved = null, environment = {}) {
  const nodes = new Map(), windowEvents = new Map(), downloads = [];
  const storage = { raw: saved, blockRead: false, blockWrite: false };
  let calls = 0, mockedFeed = null, rawFeed = null;
  class Node {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
      this.listeners = new Map(); this.attributes = new Map(); this.textContent = '';
      this.hidden = false; this.disabled = false; this.classList = { toggle() {} };
    }
    set id(value) { this._id = value; nodes.set(value, this); }
    get id() { return this._id; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    focus() {}
    close() { this.open = false; }
    showModal() { this.open = true; }
    remove() {}
    querySelector(selector) {
      return this.children.find(n => n.className === selector.slice(1) || n.tag === selector) || null;
    }
    click() {
      if (this.tag === 'a' && this.download) downloads.push({ name: this.download, blob: this.href });
      if (!this.disabled) return this.listeners.get('click')?.({ target: this });
    }
  }
  const html = fs.readFileSync(path.join(ROOT, 'empire.html'), 'utf8');
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) { const node = new Node(); node.id = id; }
  nodes.get('mode-notice').append(Object.assign(new Node(), { className: 'notice-tag' }), new Node('p'));
  const document = {
    documentElement: { dataset: { deployment: environment.deployment || 'local' } },
    getElementById: id => nodes.get(id), createElement: tag => new Node(tag),
    createTextNode: text => Object.assign(new Node('#text'), { textContent: text }), body: new Node('body'),
  };
  const localStorage = {
    getItem() { if (storage.blockRead) throw Error('Storage read unavailable'); return storage.raw; },
    setItem(_key, raw) { if (storage.blockWrite) throw Error('QuotaExceededError'); storage.raw = raw; },
  };
  const location = { hash: '', protocol: 'http:', hostname: '127.0.0.1', ...environment };
  const context = {
    window: { EmpireCatalog: C, EmpireModel: M, addEventListener: (type, listener) => windowEvents.set(type, listener) },
    document, localStorage, location, history: { pushState(_a, _b, hash) { location.hash = hash; } },
    setInterval() {}, setTimeout, clearTimeout, AbortController, TextDecoder, Uint8Array, Blob,
    URL: { createObjectURL: blob => blob, revokeObjectURL() {} },
    async fetch(_url, options) {
      calls++;
      assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
      if (!mockedFeed && rawFeed === null) throw Error('No mocked feed supplied');
      const bytes = new TextEncoder().encode(rawFeed === null ? JSON.stringify(mockedFeed) : rawFeed);
      let used = false;
      return {
        ok: true, headers: { get: () => 'application/json' },
        body: { getReader: () => ({ async read() { if (used) return { done: true }; used = true; return { done: false, value: bytes }; }, async cancel() {} }) },
      };
    },
  };
  const walk = node => [node, ...node.children.flatMap(walk)];
  const app = {
    storage, downloads, get calls() { return calls; },
    start() { vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'game/dashboard.js'), 'utf8'), context); return app; },
    node: id => nodes.get(id), text: id => String(nodes.get(id).textContent),
    mission: (id, strategy = 'focused') => walk(nodes.get('mission-panel')).find(n => n.dataset.mission === id && n.dataset.strategy === strategy),
    choose(id) { nodes.get('business-grid').children.find(n => n.dataset.business === id).click(); },
    dispatchStorage(raw) { windowEvents.get('storage')({ key: M.STORAGE_KEY, newValue: raw }); },
    async import(raw) {
      const input = nodes.get('import-save');
      input.files = [{ size: Buffer.byteLength(raw), text: async () => raw }];
      await input.listeners.get('change')({ target: input });
    },
    setFeed(feed) { mockedFeed = feed; },
    setRawFeed(raw) { rawFeed = raw; },
  };
  return app;
}

function twoMissions() {
  return M.transition(M.transition(M.initial(), { type: 'mission', id: 'web:plan' }), { type: 'mission', id: 'web:trial' });
}

test('storage write failure retains session progress, reports truthfully, and recovers', () => {
  const app = harness().start();
  app.mission('web:plan').click();
  app.storage.blockWrite = true;
  app.mission('web:trial').click();
  assert.equal(app.text('mission-count'), '2');
  assert.match(app.text('announcement'), /Session only/);
  assert.doesNotMatch(app.text('announcement'), /progress is saved locally/);
  assert.equal(M.restore(app.storage.raw).completed.length, 1);
  app.node('next-day').click();
  assert.equal(app.text('mission-count'), '2', 'next action must not restore an older persisted save');
  app.dispatchStorage(M.serialize(M.initial()));
  assert.equal(app.text('mission-count'), '2', 'external storage update must not discard unsaved progress');
  app.storage.blockWrite = false;
  app.choose('drywall'); app.mission('drywall:plan').click();
  assert.equal(M.restore(app.storage.raw).completed.length, 3);
  assert.match(app.text('save-status'), /Saved on this browser/);
});

test('unavailable storage on load still supports a multi-step session', () => {
  const app = harness(); app.storage.blockRead = true; app.storage.blockWrite = true; app.start();
  assert.match(app.text('save-status'), /Session only/);
  app.mission('web:plan').click(); app.mission('web:trial').click();
  assert.equal(app.text('mission-count'), '2');
  assert.equal(app.storage.raw, null);
  assert.match(app.text('announcement'), /Export a save/);
});

test('import with failed persistence survives the next action', async () => {
  const app = harness(M.serialize(M.initial())).start(); app.storage.blockWrite = true;
  await app.import(M.serialize(twoMissions()));
  assert.equal(app.text('mission-count'), '2');
  assert.match(app.text('announcement'), /imported into this session/);
  assert.match(app.text('announcement'), /Session only/);
  app.choose('drywall'); app.mission('drywall:plan').click();
  assert.equal(app.text('mission-count'), '3');
  assert.equal(M.restore(app.storage.raw).completed.length, 0);
});

test('reset with failed persistence does not revive old progress on the next action', () => {
  const app = harness(M.serialize(twoMissions())).start(); app.storage.blockWrite = true;
  app.node('reset-save').click(); app.node('confirm-reset').click();
  assert.equal(app.text('mission-count'), '0');
  assert.match(app.text('announcement'), /reset in this session/);
  assert.match(app.text('announcement'), /Session only/);
  app.mission('web:plan').click();
  assert.equal(app.text('mission-count'), '1');
  assert.equal(M.restore(app.storage.raw).completed.length, 2);
});

test('repeated detached mission control cannot award the mission twice', () => {
  const app = harness().start(), oldButton = app.mission('web:plan');
  oldButton.click(); oldButton.click();
  assert.equal(app.text('mission-count'), '1');
  assert.equal(M.restore(app.storage.raw).completed.length, 1);
  assert.match(app.text('announcement'), /Already completed/);
});

test('invalid imports preserve the current campaign', async () => {
  const app = harness(M.serialize(twoMissions())).start(), saved = app.storage.raw;
  for (const raw of ['{', JSON.stringify({ version: 1, mode: 'real', events: [] }), 'x'.repeat(50001)]) {
    await app.import(raw);
    assert.equal(app.text('mission-count'), '2'); assert.equal(app.storage.raw, saved);
    assert.match(app.text('announcement'), /Save was not imported/);
  }
});

test('operations hides simulated score and refresh remains a read-only manual request', async () => {
  const app = harness(M.serialize(twoMissions())).start();
  assert.equal(app.calls, 0);
  app.node('operations-tab').click();
  assert.equal(app.node('campaign-score').hidden, true);
  assert.equal(app.node('practice-view').hidden, true);
  assert.equal(app.node('operations-view').hidden, false);
  assert.equal(app.calls, 0, 'changing views must not probe any service');
  app.setFeed({ schema_version: 1, read_only: true, mode: 'offline', generated_at: new Date().toISOString(),
    sources: [{ id: 'local-registry', status: 'offline' }, { id: 'local-runtime', status: 'offline' }], projects: [] });
  await app.node('refresh-feed').click();
  assert.equal(app.calls, 1); assert.equal(app.text('feed-status'), 'Offline bridge');
  assert.equal(M.restore(app.storage.raw).completed.length, 2);
  app.node('practice-tab').click(); assert.equal(app.node('campaign-score').hidden, false);
});

test('large bounded multilingual feed loads, but responses beyond the shared cap fail closed', async () => {
  const app = harness().start();
  const dependencies = Array.from({ length: 16 }, (_, i) => `d${String(i).padStart(2, '0')}${'x'.repeat(77)}`);
  const feed = { schema_version: 1, read_only: true, mode: 'connected', generated_at: new Date().toISOString(),
    sources: [{ id: 'local-registry', status: 'ok' }, { id: 'local-runtime', status: 'ok' }],
    projects: Array.from({ length: 64 }, (_, i) => ({ id: `p${i}`, name: '🏭'.repeat(160),
      evidence: '🏭'.repeat(180), stage: '🏭'.repeat(48), status: '🏭'.repeat(64),
      prerequisites: dependencies, depends_on: dependencies })) };
  const raw = JSON.stringify(feed).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  assert.ok(Buffer.byteLength(raw) > 262144); assert.ok(Buffer.byteLength(raw) < M.MAX_FEED_BYTES);
  app.setRawFeed(raw); await app.node('refresh-feed').click();
  assert.equal(app.text('feed-status'), 'Read-only · observed');
  app.setRawFeed('x'.repeat(M.MAX_FEED_BYTES + 1)); await app.node('refresh-feed').click();
  assert.equal(app.text('feed-status'), 'Stale snapshot');
  assert.match(app.text('feed-explanation'), /safe size limit/);
});


test('public hosts are clearly practice-only and cannot request a local state feed', async () => {
  for (const hostname of ['example.github.io', 'example.com', '127.0.0.1.evil.example']) {
    const app = harness(null, { hostname }).start();
    assert.equal(app.text('feed-status'), 'Static practice mode');
    assert.equal(app.node('hosting-notice').hidden, false);
    assert.equal(app.node('refresh-feed').disabled, true);
    app.node('operations-tab').click();
    await app.node('refresh-feed').listeners.get('click')();
    assert.equal(app.calls, 0);
    app.node('practice-tab').click(); app.mission('web:plan').click();
    assert.equal(app.text('mission-count'), '1');
  }
});

test('Pages artifact stays practice-only even when previewed on localhost', async () => {
  const app = harness(null, { hostname: 'localhost', deployment: 'static' }).start();
  assert.equal(app.text('feed-status'), 'Static practice mode');
  await app.node('refresh-feed').listeners.get('click')();
  assert.equal(app.calls, 0);
});

test('file URLs keep practice available without exposing a refresh action', () => {
  const app = harness(null, { protocol: 'file:', hostname: '' }).start();
  assert.equal(app.node('refresh-feed').disabled, true);
  app.mission('web:plan').click();
  assert.equal(app.text('mission-count'), '1');
});
