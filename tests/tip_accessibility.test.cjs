const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

for (const [language, label] of [['pl', 'Ukryj instrukcję'], ['en', 'Dismiss instructions']]) {
  test(`tip dismissal has a localized accessible name and survives denied persistence (${language})`, () => {
    const dom = new JSDOM('', { runScripts: 'dangerously', url: 'http://localhost/' });
    try {
      const w = dom.window;
      w.eval(readFileSync(join(__dirname, '..', 'ha-purge-cache.js'), 'utf8'));
      Object.defineProperty(w, 'localStorage', {
        get() { throw new w.DOMException('synthetic denied storage', 'SecurityError'); }, configurable: true,
      });
      const card = w.document.createElement('ha-purge-cache');
      card.hass = { language, states: {}, themes: { darkMode: false } };
      const tip = card.shadowRoot.getElementById('tip-banner');
      const dismiss = card.shadowRoot.getElementById('tip-dismiss');
      assert.equal(dismiss.getAttribute('aria-label'), label);
      assert.equal(tip.classList.contains('hidden'), false);
      assert.doesNotThrow(() => dismiss.click());
      assert.equal(tip.classList.contains('hidden'), true);
      assert.ok(card.shadowRoot.getElementById('btn-purge-caches'));
    } finally { dom.window.close(); }
  });
}
