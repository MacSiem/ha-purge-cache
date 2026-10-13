// Actual registered editors, using the repository's jsdom/node:test harness.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = process.env.EDITOR_SOURCE_PATH ? readFileSync(join(__dirname, '..', process.env.EDITOR_SOURCE_PATH), 'utf8') : ["ha-purge-cache.js"].map(file => readFileSync(join(__dirname, '..', file), 'utf8')).join('\n');
const editors = [{"card": "ha-purge-cache", "fields": ["title"]}];
const plain = value => JSON.parse(JSON.stringify(value));

function setup(spec, hassFirst = false) {
  const dom = new JSDOM('', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  window.eval(source);
  const editor = window.customElements.get(spec.card).getConfigElement();
  assert.equal(editor.localName, spec.card + '-editor');
  const config = { type: 'custom:' + spec.card, custom_option: { retained: ['yes'] }, ...Object.fromEntries(spec.fields.map(key => [key, 'alpha omega'])) };
  const hass = { language: 'en', locale: { language: 'en' }, config: { currency: 'EUR' } };
  if (hassFirst) editor.hass = hass;
  editor.setConfig(config);
  window.document.body.append(editor);
  if (!hassFirst) editor.hass = hass;
  const events = [];
  window.document.body.addEventListener('config-changed', event => {
    events.push(plain(event.detail.config));
    assert.equal(event.composed, true);
    // The real HA editor host may synchronously echo the emitted config.
    editor.setConfig(plain(event.detail.config));
  });
  return { dom, window, editor, root: editor.shadowRoot, config, hass, events };
}

for (const spec of editors) {
  for (const key of spec.fields) {
    for (const mode of ['caret', 'backward']) test(`${spec.card} ${key}: synchronous host echo preserves ${mode} and input identity`, () => {
      const f = setup(spec);
      try {
        const field = f.root.getElementById('cf_' + key);
        field.focus();
        field.setSelectionRange(5, 5);
        field.setRangeText('X', 5, 5, 'end');
        if (mode === 'backward') field.setSelectionRange(2, 7, 'backward');
        const selection = [field.selectionStart, field.selectionEnd, field.selectionDirection];
        field.dispatchEvent(new f.window.Event('input', { bubbles: true, composed: true }));
        assert.equal(f.root.getElementById('cf_' + key), field);
        assert.equal(f.root.activeElement, field);
        assert.equal(field.value, 'alphaX omega');
        assert.deepEqual([field.selectionStart, field.selectionEnd, field.selectionDirection], selection);
        assert.deepEqual(f.events, [{ ...f.config, [key]: 'alphaX omega' }]);
        assert.equal(f.config[key], 'alpha omega', 'do not mutate host-owned config');
      } finally { f.dom.window.close(); }
    });

    test(`${spec.card} ${key}: empty user value survives echo, hass and reconnect`, () => {
      const f = setup(spec, true);
      try {
        const field = f.root.getElementById('cf_' + key);
        field.focus(); field.value = '';
        field.dispatchEvent(new f.window.Event('input', { bubbles: true }));
        f.editor.hass = { ...f.hass, config: { currency: 'PLN' } };
        f.editor.remove(); f.window.document.body.append(f.editor);
        assert.equal(f.root.getElementById('cf_' + key), field);
        assert.equal(field.value, '');
        assert.deepEqual(f.events, [{ ...f.config, [key]: '' }]);
        field.focus(); field.value = 'reconnected';
        field.dispatchEvent(new f.window.Event('input', { bubbles: true }));
        assert.equal(f.events.length, 2, 'one listener after reconnect');
        assert.equal(f.events[1][key], 'reconnected');
        assert.deepEqual(f.events[1].custom_option, f.config.custom_option);
      } finally { f.dom.window.close(); }
    });

    test(`${spec.card} ${key}: external config updates the active field in place and retains selection`, () => {
      const f = setup(spec);
      try {
        const field = f.root.getElementById('cf_' + key);
        field.focus(); field.setSelectionRange(2, 7, 'backward');
        const replacement = { ...f.config, [key]: 'external value', custom_option: { replacement: true } };
        f.editor.setConfig(replacement);
        assert.equal(f.root.getElementById('cf_' + key), field);
        assert.equal(f.root.activeElement, field);
        assert.equal(field.value, 'external value');
        assert.deepEqual([field.selectionStart, field.selectionEnd, field.selectionDirection], [2, 7, 'backward']);
        f.editor.setConfig({ ...replacement, [key]: 'x' });
        assert.equal(field.value, 'x');
        assert.deepEqual([field.selectionStart, field.selectionEnd], [1, 1], 'selection clamps to new length');
        assert.equal(f.events.length, 0, 'host updates are silent');
        field.value = 'user'; field.dispatchEvent(new f.window.Event('input', { bubbles: true }));
        assert.deepEqual(f.events, [{ ...replacement, [key]: 'user' }]);
      } finally { f.dom.window.close(); }
    });

    test(`${spec.card} ${key}: same-object hass and locale updates preserve editing state without events`, () => {
      const f = setup(spec);
      try {
        const field = f.root.getElementById('cf_' + key);
        field.focus(); field.setSelectionRange(1, 6, 'backward');
        for (const language of ['en', 'pl-PL', 'en']) {
          f.hass.locale.language = language;
          f.hass.language = language === 'en' ? 'pl' : 'en';
          f.editor.hass = f.hass;
          assert.equal(f.root.getElementById('cf_' + key), field);
          assert.equal(f.root.activeElement, field);
          assert.equal(field.value, 'alpha omega');
          assert.deepEqual([field.selectionStart, field.selectionEnd, field.selectionDirection], [1, 6, 'backward']);
          assert.equal(f.root.querySelector('label[for="cf_title"]').textContent, language === 'en' ? 'Title' : 'Tytuł');
          if (spec.card === 'ha-purge-cache') assert.match(f.root.getElementById('cf_inspect_label').textContent, language === 'en' ? /Inspect cache/ : /Sprawdzaj/);
        }
        assert.equal(f.events.length, 0);
        const outside = f.window.document.createElement('input'); f.window.document.body.append(outside); outside.focus();
        f.editor.setConfig({ ...f.config, [key]: 'new external value' });
        f.editor.hass = f.hass;
        assert.equal(f.window.document.activeElement, outside, 'updates must not steal focus');
      } finally { f.dom.window.close(); }
    });
  }

  test(`${spec.card}: every native field has an associated, nonempty label`, () => {
    const f = setup(spec);
    try {
      for (const field of f.root.querySelectorAll('input')) {
        assert.ok(field.labels.length > 0, field.id);
        assert.ok([...field.labels].some(label => label.textContent.trim()), field.id);
        for (const label of field.labels) assert.equal(label.control, field);
      }
    } finally { f.dom.window.close(); }
  });

  if (spec.fields.includes('currency')) test(`${spec.card}: HA currency fallback updates without overwriting an explicit empty or numeric zero`, () => {
    const f = setup(spec);
    try {
      const currency = f.root.getElementById('cf_currency');
      f.editor.setConfig({ title: '', custom_option: { kept: true } });
      assert.equal(f.root.getElementById('cf_title').value, '');
      assert.equal(currency.value, 'EUR');
      f.hass.config.currency = 'PLN'; f.editor.hass = f.hass;
      assert.equal(f.root.getElementById('cf_currency'), currency);
      assert.equal(currency.value, 'PLN');
      f.editor.setConfig({ title: '', currency: '', energy_price: 0 });
      f.editor.hass = { ...f.hass, config: { currency: 'USD' } };
      assert.equal(currency.value, '');
      if (spec.fields.includes('energy_price')) assert.equal(f.root.getElementById('cf_energy_price').value, '0');
      assert.equal(f.events.length, 0);
    } finally { f.dom.window.close(); }
  });
}


test('Purge checkbox preserves focus through sync echo, locale, external config and reconnect with one event', () => {
  const f = setup(editors[0]);
  try {
    const checkbox = f.root.getElementById('cf_inspect_cache_entries');
    assert.equal(checkbox.checked, true);
    checkbox.focus(); checkbox.click();
    assert.equal(f.root.getElementById('cf_inspect_cache_entries'), checkbox);
    assert.equal(f.root.activeElement, checkbox);
    assert.equal(checkbox.checked, false);
    assert.deepEqual(f.events, [{ ...f.config, inspect_cache_entries: false }]);
    for (const language of ['en', 'pl', 'en']) {
      f.editor.hass = { ...f.hass, locale: { language } };
      assert.equal(f.root.activeElement, checkbox);
      assert.equal(checkbox.checked, false);
    }
    f.editor.setConfig({ ...f.events[0], inspect_cache_entries: true });
    assert.equal(f.root.activeElement, checkbox);
    assert.equal(checkbox.checked, true);
    assert.equal(f.events.length, 1);
    f.editor.remove(); f.window.document.body.append(f.editor);
    assert.equal(f.root.getElementById('cf_inspect_cache_entries'), checkbox);
    checkbox.focus(); checkbox.click();
    assert.equal(f.root.activeElement, checkbox);
    assert.equal(checkbox.checked, false);
    assert.equal(f.events.length, 2, 'reconnect binds no duplicate listener');
    assert.deepEqual(f.events[1], { ...f.config, inspect_cache_entries: false });
    for (const value of [undefined, null, 0, '', true]) {
      f.editor.setConfig({ ...f.config, inspect_cache_entries: value });
      assert.equal(checkbox.checked, true, 'only explicit false disables inspection');
    }
    assert.equal(f.events.length, 2);
  } finally { f.dom.window.close(); }
});
