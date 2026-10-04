const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

function fixture(language = 'en') {
  const dom = new JSDOM('', { runScripts: 'dangerously', url: 'http://localhost/' });
  const w = dom.window;
  w.eval(readFileSync(join(__dirname, '..', 'ha-purge-cache.js'), 'utf8'));
  const card = w.document.createElement('ha-purge-cache');
  card.setConfig({ show_support: true });
  card.hass = { language, user: { is_admin: true }, states: {} };
  let reads = 0;
  card._collectStats = () => { reads++; };
  w.document.body.append(card);
  return { dom, card, root: card.shadowRoot, reads: () => reads };
}

test('ordinary EN/pl-PL/EN refreshes action labels without replacing controls or collecting stats', () => {
  const f = fixture();
  try {
    const { card, root } = f;
    const button = root.getElementById('btn-purge-ls');
    button.focus();
    root.getElementById('keys-toggle').click();
    card._addLog('Historical result <unchanged>', 'success');
    const log = root.getElementById('action-log').innerHTML;
    const count = f.reads();
    for (const language of ['pl-PL', 'en']) {
      card.hass = { language, user: { is_admin: true }, states: {} };
      assert.equal(button.querySelector('.action-label').textContent, card._t.btnPurgeLS);
      assert.equal(button.getAttribute('aria-label'), card._t.btnPurgeLS);
      assert.equal(root.querySelector('.subtitle').textContent, card._t.subtitle);
      assert.equal(root.querySelector('.tip-banner-title').textContent, card._t.tipTitle);
      assert.equal(root.getElementById('tip-dismiss').getAttribute('aria-label'), card._t.tipDismiss);
      assert.equal(root.getElementById('btn-purge-ls'), button);
      assert.equal(root.activeElement, button);
      assert.ok(root.getElementById('ls-keys').classList.contains('hidden'));
      assert.equal(root.getElementById('action-log').innerHTML, log);
      assert.equal(f.reads(), count);
    }
  } finally { f.dom.window.close(); }
});

test('pending confirmation translates while retaining its callback and overlay, without executing it', () => {
  const f = fixture();
  try {
    const { card, root } = f;
    let applied = 0;
    const callback = () => { applied++; };
    card._confirm(card._t.confirmLS, callback);
    const cancel = root.getElementById('confirm-cancel');
    cancel.focus();
    card.hass = { language: 'pl-PL', user: { is_admin: true } };
    assert.equal(root.getElementById('confirm-msg').textContent, card._t.confirmLS);
    assert.equal(cancel.textContent, 'Anuluj');
    assert.equal(root.getElementById('confirm-overlay').style.display, 'flex');
    assert.equal(card._pendingConfirm, callback);
    assert.equal(root.activeElement, cancel);
    assert.equal(applied, 0);
    cancel.click();
    assert.equal(card._pendingConfirm, null);
    assert.equal(applied, 0);
  } finally { f.dom.window.close(); }
});

test('initial Polish support and ordinary switch are localized without resurrecting dismissed guidance', () => {
  const f = fixture('pl-PL');
  try {
    const { card, root } = f;
    assert.equal(root.querySelector('.donate-section a').textContent, 'Opcjonalne wsparcie HA Tools');
    assert.equal(root.querySelector('.support-dismiss').getAttribute('aria-label'), 'Ukryj link wsparcia');
    root.querySelector('.support-dismiss').click();
    root.getElementById('tip-dismiss').click();
    card.hass = { language: 'en', user: { is_admin: true } };
    assert.equal(root.querySelector('.donate-section'), null);
    assert.ok(root.getElementById('tip-banner').classList.contains('hidden'));
  } finally { f.dom.window.close(); }
});

test('custom pending messages, callbacks, and historical log remain literal across locale changes', () => {
  const f = fixture();
  try {
    const { card, root } = f;
    const callback = () => { throw Error('must not execute'); };
    card._confirm('Custom literal <message>', callback);
    card._addLog('Prior English result', 'info');
    const log = root.getElementById('action-log').innerHTML;
    card.hass = { language: 'pl-PL', user: { is_admin: true } };
    assert.equal(root.getElementById('confirm-msg').textContent, 'Custom literal <message>');
    assert.equal(card._pendingConfirm, callback);
    assert.equal(root.getElementById('action-log').innerHTML, log);
  } finally { f.dom.window.close(); }
});

test('cached statistics and key controls translate without reading or replacing stored rows', () => {
  const f = fixture();
  try {
    const { card, root } = f;
    f.dom.window.localStorage.setItem('authored-key', 'authored-value');
    card._stats = { localStorage: { count: 1, sizeKB: '0.1' }, serviceWorkers: { unavailable: true } };
    card._updateDisplay();
    const row = root.querySelector('.key-row');
    const deletion = row.querySelector('button');
    const number = root.querySelector('#stat-ls .stat-num');
    deletion.focus();
    Object.defineProperty(f.dom.window, 'localStorage', { get() { throw Error('locale must not read storage'); }, configurable: true });
    card.hass = { language: 'pl-PL', user: { is_admin: true } };
    assert.equal(root.querySelector('#stat-ls [data-locale-text]').textContent, card._t.statKeys);
    assert.equal(root.querySelector('#stat-sw [data-locale-text]').textContent, card._t.statUnavailable);
    assert.equal(deletion.getAttribute('aria-label'), `${card._t.deleteKey}: authored-key`);
    assert.equal(root.querySelector('.key-row'), row);
    assert.equal(root.querySelector('#stat-ls .stat-num'), number);
    assert.equal(root.activeElement, deletion);
    assert.equal(row.querySelector('.key-name').textContent, 'authored-key');
  } finally { f.dom.window.close(); }
});

test('existing support and every action description follow ordinary language changes', () => {
  const f = fixture();
  try {
    const { card, root } = f;
    const support = root.querySelector('.donate-section');
    const link = support.querySelector('a');
    for (const language of ['pl-PL', 'en']) {
      card.hass = { language, user: { is_admin: true } };
      for (const suffix of ['PurgeLS', 'PurgeSS', 'PurgeSW', 'PurgeCS', 'ReloadTools', 'PurgeCaches', 'PurgeAll', 'HardReload']) {
        assert.equal(root.querySelector(`[data-locale-text="btn${suffix}"]`).textContent, card._t[`btn${suffix}`]);
        assert.equal(root.querySelector(`[data-locale-text="btn${suffix}Desc"]`).textContent, card._t[`btn${suffix}Desc`]);
      }
      assert.equal(root.querySelector('[data-locale-rich="warningText"]').innerHTML, card._t.warningText);
      assert.equal(link.textContent, language.startsWith('pl') ? 'Opcjonalne wsparcie HA Tools' : 'Optional support for HA Tools');
      assert.equal(support.querySelector('a'), link);
      assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    }
  } finally { f.dom.window.close(); }
});
