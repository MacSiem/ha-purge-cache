const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = readFileSync(join(__dirname, '..', 'ha-purge-cache.js'), 'utf8');
const admin = () => ({ id: 'fixture-admin', is_admin: true, is_active: true, groups: [{ id: 'system-admin' }] });
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(language = 'en') {
 const dom = new JSDOM('', { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
 const w = dom.window; w.eval(source);
 const card = w.document.createElement('ha-purge-cache');
 card.hass = { language, user: admin(), connection: { connected: true }, config: { location_name: 'Fixture' }, states: {} };
 w.document.body.append(card); await card._collectStats();
 return { dom, w, card, root: card.shadowRoot };
}
function selected(card, store) { return card._actionResult.components.find(row => row.store === store); }
function cacheFixture(w, names, options = {}) {
 const live = new Set(names);
 let reads = 0;
 w.caches = {
  keys: async () => { reads++; if (options.denyAfter && reads > 1) throw Error('PRIVATE URL secret'); return [...live]; },
  delete: async name => { if (options.fail === name) throw Error('PRIVATE URL secret'); if (options.falseAck) return false; live.delete(name); return true; },
 };
 return { live, reads: () => reads };
}

// Break caught: selected actions must not read/mutate unrelated stores or use Storage.clear().
for (const area of ['localStorage', 'sessionStorage']) test(`${area}: captured exact keys with independent readback and exclusions`, async () => {
 const f = await setup(); try {
  const { w, card } = f;
  w[area].setItem('alpha', 'PRIVATE VALUE'); w[area].setItem('beta', 'PRIVATE VALUE');
  if (area === 'localStorage') {
   w[area].setItem('ha-purge-cache-support-dismissed', '1');
   w[area].setItem('purge-cache-tips-v1.0.0', 'dismissed');
  }
  w.Storage.prototype.clear = () => { throw Error('clear is too broad'); };
  Object.defineProperty(w, area === 'localStorage' ? 'sessionStorage' : 'localStorage', { get() { throw Error('unselected storage read'); }, configurable: true });
  Object.defineProperty(w.navigator, 'serviceWorker', { get() { throw Error('unselected worker read'); }, configurable: true });
  Object.defineProperty(w, 'caches', { get() { throw Error('unselected cache read'); }, configurable: true });
  await card[area === 'localStorage' ? '_purgeLocalStorage' : '_purgeSessionStorage']();
  const row = selected(card, area);
  assert.equal(row.before, 2); assert.equal(row.after, 0); assert.equal(row.removed, 2);
  assert.equal(row.failed, 0); assert.equal(row.unknown, 0);
  assert.deepEqual(plain(row.removedNames).sort(), ['alpha', 'beta']);
  assert.equal(row.status, 'success'); assert.equal(card._reloadTimer, null);
  assert.doesNotMatch(JSON.stringify(card._actionResult), /PRIVATE VALUE|unselected/);
  if (area === 'localStorage') { assert.equal(row.untouched, 2); assert.equal(w.localStorage.getItem('ha-purge-cache-support-dismissed'), '1'); }
  assert.match(f.root.querySelector('#purge-result').textContent, /alpha/);
 } finally { f.dom.window.close(); }
});

test('cache-only captures only caches/workers, removes true acknowledged absent resources, never reloads', async () => {
 const f = await setup(); try {
  const { w, card } = f; const cache = cacheFixture(w, ['one', 'two']);
  const regs = new Map(['one', 'two'].map(name => [name, { scope: `http://localhost/${name}/`, unregister: async () => regs.delete(name) }]));
  Object.defineProperty(w.navigator, 'serviceWorker', { value: { getRegistrations: async () => [...regs.values()] }, configurable: true });
  for (const area of ['localStorage', 'sessionStorage']) Object.defineProperty(w, area, { get() { throw Error('unselected read'); }, configurable: true });
  await card._purgeCachesOnly();
  assert.equal(cache.reads(), 2); assert.equal(cache.live.size, 0); assert.equal(regs.size, 0);
  for (const store of ['cacheStorage', 'serviceWorkers']) {
   const row = selected(card, store); assert.equal(row.before, 2); assert.equal(row.after, 0); assert.equal(row.removed, 2); assert.equal(row.status, 'success');
  }
  assert.equal(card._actionResult.components.length, 2);
  assert.equal(card._actionResult.httpCache.status, 'unconfirmed'); assert.equal(card._actionResult.httpCache.before, null);
  assert.equal(card._reloadTimer, null); assert.equal(f.root.querySelector('#btn-hard-reload').disabled, false);
} finally { f.dom.window.close(); }
});

for (const mode of ['falseAck', 'stillPresent', 'deniedReadback']) test(`cache acknowledgement alone cannot produce success: ${mode}`, async () => {
 const f = await setup(); try {
  const { w, card } = f;
  const state = cacheFixture(w, ['one'], { falseAck: mode === 'falseAck', denyAfter: mode === 'deniedReadback' });
  if (mode === 'stillPresent') w.caches.delete = async () => true;
  await card._purgeCacheStorage(); const row = selected(card, 'cacheStorage');
  assert.notEqual(row.status, 'success'); assert.equal(row.removed, 0);
  if (mode === 'deniedReadback') { assert.equal(row.after, null); assert.equal(row.unknown, 1); }
  else { assert.equal(row.after, 1); assert.equal(row.failed, 1); }
  assert.equal(f.root.querySelector('#btn-hard-reload').disabled, true);
  card._hardReload(); assert.equal(card._reloadTimer, null);
  assert.doesNotMatch(f.root.textContent, /PRIVATE URL secret/);
  assert.ok(state.reads() >= 2);
 } finally { f.dom.window.close(); }
});

test('false acknowledgement with disappearance remains unknown, not removed', async () => {
 const f = await setup(); try {
  const { w, card } = f; const state = cacheFixture(w, ['one']);
  w.caches.delete = async name => { state.live.delete(name); return false; };
  await card._purgeCacheStorage(); const row = selected(card, 'cacheStorage');
  assert.equal(row.after, 0); assert.equal(row.removed, 0); assert.equal(row.unknown, 1); assert.equal(row.status, 'unconfirmed');
 } finally { f.dom.window.close(); }
});

for (const denied of [false, true]) test(`measured empty storage differs from denied enumeration (${denied})`, async () => {
 const f = await setup('pl'); try {
  if (denied) Object.defineProperty(f.w, 'sessionStorage', { get() { throw Error('SECRET'); }, configurable: true });
  await f.card._purgeSessionStorage(); const row = selected(f.card, 'sessionStorage');
  assert.equal(row.before, denied ? null : 0); assert.equal(row.after, denied ? null : 0);
  assert.equal(row.removed, denied ? null : 0); assert.equal(row.status, denied ? 'unconfirmed' : 'success');
  assert.doesNotMatch(JSON.stringify(f.card._actionResult), /SECRET/);
 } finally { f.dom.window.close(); }
});

test('partial local removal reports exact names and survives without green success or reload', async () => {
 const f = await setup(); try {
  f.w.localStorage.setItem('removed', 'one'); f.w.localStorage.setItem('retained', 'two');
  const original = f.w.Storage.prototype.removeItem;
  f.w.Storage.prototype.removeItem = function(key) { if (key === 'retained') throw Error('PRIVATE'); return original.call(this, key); };
  await f.card._purgeLocalStorage(); const row = selected(f.card, 'localStorage');
  assert.equal(row.status, 'partial'); assert.equal(row.before, 2); assert.equal(row.after, 1); assert.equal(row.removed, 1); assert.equal(row.failed, 1);
  assert.deepEqual(plain(row.removedNames), ['removed']); assert.deepEqual(plain(row.failedNames), ['retained']);
  assert.equal(f.root.querySelectorAll('#purge-result [data-result-state="success"]').length, 0);
  assert.equal(f.root.querySelector('#btn-hard-reload').disabled, true); assert.equal(f.card._reloadTimer, null);
 } finally { f.dom.window.close(); }
});

test('full purge continues independent stores and reports separate units on first-store denial', async () => {
 const f = await setup(); try {
  f.w.sessionStorage.setItem('session-only', 'discard');
  Object.defineProperty(f.w, 'localStorage', { get() { throw Error('PRIVATE'); }, configurable: true });
  cacheFixture(f.w, []);
  Object.defineProperty(f.w.navigator, 'serviceWorker', { value: { getRegistrations: async () => [] }, configurable: true });
  await f.card._purgeAll();
  assert.equal(f.w.sessionStorage.length, 0); assert.equal(f.card._actionResult.status, 'partial');
  assert.equal(f.card._actionResult.components.length, 5); assert.equal(f.card._reloadTimer, null);
  assert.equal(f.card._actionResult.total, undefined); assert.equal(f.root.querySelector('#btn-hard-reload').disabled, true);
 } finally { f.dom.window.close(); }
});

// Break caught: late completions or duplicate clicks cannot publish to a changed authority.
for (const change of ['user', 'role', 'active', 'groups', 'connection', 'config', 'source', 'mount']) test(`pending result and confirmation cleared synchronously on ${change}`, async () => {
 const f = await setup(); try {
  const { w, card, root } = f;
  w.localStorage.setItem('private-key-name', 'PRIVATE VALUE'); await card._collectStats();
  card._confirm('private-key-name', () => { throw Error('must be cancelled'); });
  let release; let reads = 0;
  w.caches = { keys: () => { reads++; return new Promise(resolve => { release = resolve; }); }, delete: async () => { throw Error('late mutation'); } };
  const pending = card._purgeCacheStorage();
  await tick();
  const next = { ...card._hass, user: admin() };
  if (change === 'user') next.user.id = 'another-admin';
  if (change === 'role') next.user.is_admin = false;
  if (change === 'active') next.user.is_active = false;
  if (change === 'groups') next.user.groups = [{ id: 'other' }];
  if (change === 'connection') next.connection = { connected: true };
  if (change === 'source') next.config = { location_name: 'Other' };
  if (change === 'config') card.setConfig({ title: 'Changed' });
  else if (change === 'mount') card.remove();
  else card.hass = next;
  assert.equal(card._pendingConfirm, null); assert.equal(card._actionResult, null);
  assert.doesNotMatch(root.querySelector('#ls-keys').textContent + root.querySelector('#purge-result').textContent + root.querySelector('#action-log').textContent, /private-key-name|PRIVATE VALUE/);
  release(['late']); await pending;
  assert.equal(card._actionResult, null); assert.equal(reads, 1); assert.equal(card._reloadTimer, null);
 } finally { f.dom.window.close(); }
});

test('duplicate action requests coalesce to one producer and one completed result', async () => {
 const f = await setup(); try {
  let release; let reads = 0; let deletes = 0; let live = ['one'];
  f.w.caches = { keys: () => { reads++; return reads === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(live); }, delete: async () => { deletes++; live = []; return true; } };
  const first = f.card._purgeCacheStorage(); const second = f.card._purgeCacheStorage();
  await tick(); release(['one']); await Promise.all([first, second]);
  assert.equal(reads, 2); assert.equal(deletes, 1); assert.equal(selected(f.card, 'cacheStorage').removed, 1);
 } finally { f.dom.window.close(); }
});

test('inactive users cannot read private stats or mutate even by calling methods', async () => {
 const f = await setup(); try {
  f.w.localStorage.setItem('protected', 'PRIVATE');
  f.card.hass = { ...f.card._hass, user: { ...admin(), is_active: false } };
  await f.card._purgeLocalStorage(); await f.card._collectStats();
  assert.equal(f.w.localStorage.getItem('protected'), 'PRIVATE'); assert.equal(f.card._actionResult, null);
  assert.equal(f.root.querySelector('#btn-purge-ls').disabled, true); assert.equal(f.root.querySelector('#ls-keys').textContent, '');
 } finally { f.dom.window.close(); }
});

test('single-key confirmation cancels safely, restores focus, traps Tab and supports Enter/Space', async () => {
 const f = await setup(); try {
  const { w, card, root } = f;
  w.localStorage.setItem('one', 'discard'); w.localStorage.setItem('two', 'retain'); await card._collectStats();
  let trigger = root.querySelector('[data-key="one"]'); trigger.focus(); trigger.click();
  const cancel = root.querySelector('#confirm-cancel'), ok = root.querySelector('#confirm-ok');
  cancel.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); assert.equal(root.activeElement, ok);
  ok.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.equal(root.activeElement, cancel);
  cancel.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); assert.equal(root.activeElement, trigger); assert.equal(w.localStorage.getItem('one'), 'discard');
  for (const key of ['Enter', ' ']) {
   trigger.click(); ok.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await tick();
   assert.equal(w.localStorage.getItem('one'), null); assert.equal(w.localStorage.getItem('two'), 'retain');
   assert.equal(root.activeElement, root.querySelector('#keys-toggle'));
   if (key === 'Enter') { w.localStorage.setItem('one', 'discard'); await card._collectStats(); trigger = root.querySelector('[data-key="one"]'); }
  }
  const row = selected(card, 'localStorage'); assert.equal(row.before, 1); assert.equal(row.after, 0); assert.deepEqual(plain(row.removedNames), ['one']);
 } finally { f.dom.window.close(); }
});

test('all existing actions and explicit reviewed reload are retained; no purge schedules navigation', async () => {
 const f = await setup(); try {
  for (const id of ['btn-purge-ls', 'btn-purge-ss', 'btn-purge-sw', 'btn-purge-cs', 'btn-reload-tools', 'btn-purge-caches', 'btn-purge-all', 'btn-hard-reload']) assert.ok(f.root.getElementById(id));
  await f.card._purgeSessionStorage(); assert.equal(f.card._reloadTimer, null);
  const reload = f.root.querySelector('#btn-hard-reload'); reload.focus(); reload.click();
  assert.equal(f.root.querySelector('#confirm-overlay').style.display, 'flex'); assert.equal(f.card._reloadTimer, null);
  f.root.querySelector('#confirm-cancel').click(); assert.equal(f.root.activeElement, reload); assert.equal(f.card._reloadTimer, null);
  reload.click(); f.root.querySelector('#confirm-ok').click(); await tick(); assert.ok(f.card._reloadTimer);
  f.card.hass = { ...f.card._hass, user: { ...admin(), is_admin: false } }; assert.equal(f.card._reloadTimer, null);
 } finally { f.dom.window.close(); }
});

test('HACS script refetch remains available without executing scripts or claiming HTTP cache deletion', async () => {
 const f = await setup(); try {
  const resources = [{ name: 'http://localhost/hacsfiles/tool/tool.js?v=1' }, { name: 'http://localhost/private.js' }];
  Object.defineProperty(f.w.performance, 'getEntriesByType', { value: () => resources });
  let fetched = 0;
  f.w.fetch = async (url, options) => { fetched++; assert.match(url, /\/hacsfiles\/tool\/tool\.js/); assert.equal(options.cache, 'no-store'); resources.push({ name: url }); return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }; };
  await f.card._forceReloadTools();
  assert.equal(fetched, 1); assert.equal(selected(f.card, 'toolScripts').refetched, 1); assert.equal(selected(f.card, 'toolScripts').removed, null);
  assert.equal(f.card._actionResult.httpCache.status, 'unconfirmed'); assert.equal(f.card._reloadTimer, null);
 } finally { f.dom.window.close(); }
});

test('oversized snapshot stays bounded/unknown and cannot trigger broad deletion', async () => {
 const f = await setup(); try {
  for (let i = 0; i < 513; i++) f.w.sessionStorage.setItem(`key-${i}`, 'retain');
  await f.card._purgeSessionStorage(); const row = selected(f.card, 'sessionStorage');
  assert.equal(row.before, null); assert.equal(row.removed, null); assert.equal(row.status, 'unconfirmed'); assert.equal(f.w.sessionStorage.length, 513);
 } finally { f.dom.window.close(); }
});

test('locale refresh preserves confirmation and editor changes preserve unknown config keys', async () => {
 const f = await setup(); try {
  f.root.querySelector('#btn-purge-ls').click(); const callback = f.card._pendingConfirm;
  f.card.hass = { ...f.card._hass, language: 'pl-PL' };
  assert.equal(f.card._pendingConfirm, callback); assert.equal(f.root.querySelector('#confirm-msg').textContent, f.card._t.confirmLS);
  const editor = f.w.document.createElement('ha-purge-cache-editor'); editor.setConfig({ title: 'A', custom_future: { preserved: true } });
  let updated; editor.addEventListener('config-changed', event => { updated = event.detail.config; });
  const input = editor.shadowRoot.querySelector('#cf_title'); input.value = 'B'; input.dispatchEvent(new f.w.Event('input'));
  assert.equal(updated.title, 'B'); assert.equal(updated.custom_future.preserved, true);
 } finally { f.dom.window.close(); }
});

// Break caught: a response acknowledgement without completed body/resource readback is not Success.
test('script refetch acknowledgement without readback stays unconfirmed', async () => {
 const f = await setup(); try {
  Object.defineProperty(f.w.performance, 'getEntriesByType', { value: () => [{ name: 'http://localhost/hacsfiles/tool/tool.js' }] });
  f.w.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  await f.card._forceReloadTools(); const row = selected(f.card, 'toolScripts');
  assert.equal(row.refetched, 0); assert.equal(row.unknown, 1); assert.equal(row.status, 'unconfirmed');
  assert.equal(f.root.querySelector('#btn-hard-reload').disabled, true); assert.equal(f.card._reloadTimer, null);
 } finally { f.dom.window.close(); }
});

// Break caught: removing broad stats refresh must still update the selected store's existing display.
test('selected-store readback refreshes its statistic and key controls without rereading other stores', async () => {
 const f = await setup(); try {
  f.w.localStorage.setItem('alpha', 'value'); f.w.localStorage.setItem('beta', 'value'); await f.card._collectStats();
  const oldSession = f.root.querySelector('#stat-ss').textContent;
  Object.defineProperty(f.w, 'sessionStorage', { get() { throw Error('not selected'); }, configurable: true });
  await f.card._purgeLocalStorage();
  assert.equal(f.root.querySelector('#stat-ls .stat-num').textContent, '0');
  assert.equal(f.root.querySelectorAll('#ls-keys [data-key]').length, 0);
  assert.equal(f.root.querySelector('#stat-ss').textContent, oldSession);
 } finally { f.dom.window.close(); }
});

// Owner preservation: user brief explicitly preserves existing household roles.
test('household keeps local browser purge and its selected-store result',async()=>{
 const f=await setup();try{f.card.hass={...f.card._hass,user:{id:'fixture-household',is_admin:false,is_active:true,group_ids:['system-users']}};
  f.w.sessionStorage.setItem('household-owned','fixture');await f.card._purgeSessionStorage();assert.equal(f.w.sessionStorage.getItem('household-owned'),null);assert.equal(selected(f.card,'sessionStorage').removed,1);assert.equal(f.root.querySelector('#btn-purge-ss').disabled,false);
 }finally{f.dom.window.close();}
});
