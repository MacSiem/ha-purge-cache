const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

function supportedCacheCard() {
  const dom = new JSDOM('', { runScripts: 'dangerously', url: 'http://localhost/' });
  dom.window.eval(readFileSync(join(__dirname, '..', 'ha-purge-cache.js'), 'utf8'));
  const card = dom.window.document.createElement('ha-purge-cache');
  const logs = [], calls = [];
  const storage = { 'ha-baby-tracker-children': '[{"name":"Fixture"}]', 'ha-tools-trace-viewer-stored': '[{"id":"fixture"}]', 'ha-sentence-manager-state': '{"fixture":true}', hassTokens: 'fake-session-fixture', unrelated: 'foreign-fixture' };
  for (const area of [dom.window.localStorage, dom.window.sessionStorage]) {
    for (const [key, value] of Object.entries(storage)) area.setItem(key, value);
  }
  card._collectStats = async () => {};
  card._addLog = (msg, type) => logs.push({ msg, type });
  card._hardReload = () => calls.push('reload');
  const verifyStorage = () => {
    for (const area of [dom.window.localStorage, dom.window.sessionStorage]) {
      assert.equal(area.length, Object.keys(storage).length);
      for (const [key, value] of Object.entries(storage)) assert.equal(area.getItem(key), value);
    }
  };
  return { dom, card, logs, calls, verifyStorage };
}

test('supported cache-only deletion removes caches and workers before reload while preserving every storage key', async () => {
  const { dom, card, logs, calls, verifyStorage } = supportedCacheCard();
  try {
    Object.defineProperty(dom.window.navigator, 'serviceWorker', { value: {
      getRegistrations: async () => ['one', 'two'].map(name => ({ unregister: async () => { calls.push(`worker:${name}`); return true; } })),
    } });
    const names = new Set(['one', 'two']);
    dom.window.caches = {
      keys: async () => Array.from(names),
      delete: async name => { calls.push(`cache:${name}`); return names.delete(name); },
    };
    await card._purgeCachesOnly();
    assert.deepEqual(calls, ['worker:one', 'worker:two', 'cache:one', 'cache:two', 'reload']);
    assert.equal(names.size, 0);
    assert.equal(logs.filter(row => row.type === 'success').length, 2);
    verifyStorage();
  } finally { dom.window.close(); }
});

test('cache APIs returning false are not counted as removed resources', async () => {
  const { dom, card, logs, verifyStorage } = supportedCacheCard();
  try {
    Object.defineProperty(dom.window.navigator, 'serviceWorker', { value: {
      getRegistrations: async () => [{ unregister: async () => false }],
    } });
    dom.window.caches = { keys: async () => ['already-gone'], delete: async () => false };
    for (const lang of ['pl', 'en']) {
      card._lang = lang; logs.length = 0;
      await card._purgeCachesOnly();
      assert.equal(logs[0].msg, card._t.logSwUnregistered(0));
      assert.equal(logs[1].msg, card._t.logCsDeleted(0));
      verifyStorage();
    }
  } finally { dom.window.close(); }
});

test('a failed worker removal is reported and cache-only still preserves storage while deleting caches', async () => {
  const { dom, card, logs, calls, verifyStorage } = supportedCacheCard();
  try {
    Object.defineProperty(dom.window.navigator, 'serviceWorker', { value: {
      getRegistrations: async () => [{ unregister: async () => { throw new Error('fixture-denied'); } }],
    } });
    dom.window.caches = { keys: async () => ['one'], delete: async name => { calls.push(`cache:${name}`); return true; } };
    await card._purgeCachesOnly();
    assert.match(logs[0].msg, /fixture-denied/);
    assert.equal(logs[0].type, 'error');
    assert.deepEqual(calls, ['cache:one', 'reload']);
    assert.equal(logs[1].msg, card._t.logCsDeleted(1));
    verifyStorage();
  } finally { dom.window.close(); }
});

test('cache refresh preserves Baby Tracker and Trace Viewer browser data', async () => {
  const dom = new JSDOM('', { runScripts: 'dangerously', url: 'http://localhost/' });
  try {
    dom.window.eval(readFileSync(join(__dirname, '..', 'ha-purge-cache.js'), 'utf8'));
    const card = dom.window.document.createElement('ha-purge-cache');
    dom.window.localStorage.setItem('ha-baby-tracker-children', '[{"name":"Child"}]');
    dom.window.localStorage.setItem('ha-tools-trace-viewer-stored', '[{"id":"trace"}]');
    dom.window.localStorage.setItem('hassTokens', 'session');
    card._collectStats = async () => {};
    card._hardReload = () => {};

    await card._purgeCachesOnly();

    assert.equal(dom.window.localStorage.getItem('ha-baby-tracker-children'), '[{"name":"Child"}]');
    assert.equal(dom.window.localStorage.getItem('ha-tools-trace-viewer-stored'), '[{"id":"trace"}]');
    assert.equal(dom.window.localStorage.getItem('hassTokens'), 'session');
  } finally {
    dom.window.close();
  }
});
