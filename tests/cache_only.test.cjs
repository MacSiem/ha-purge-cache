const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

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
