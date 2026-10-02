const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = readFileSync(join(__dirname, '..', 'ha-purge-cache.js'), 'utf8');

test('first render survives localStorage access denial', async () => {
 const dom = new JSDOM('', {runScripts:'dangerously',url:'http://localhost/'});
 try {
  const w=dom.window;w.eval(source);
  Object.defineProperty(w,'localStorage',{get:()=>{throw new w.DOMException('blocked fixture','SecurityError')},configurable:true});
  const card=w.document.createElement('ha-purge-cache');
  assert.doesNotThrow(()=>{card.hass={language:'en',states:{},themes:{darkMode:false}}});
  assert.ok(card.shadowRoot.getElementById('btn-purge-caches'), 'actions must still render');
  assert.doesNotThrow(()=>card.shadowRoot.getElementById('tip-dismiss').click());
  await card._collectStats();
  assert.equal(card.shadowRoot.getElementById('stat-ls').querySelector('.stat-num').textContent.trim(),'—');
 } finally {dom.window.close();}
});

for (const language of ['en', 'pl']) {
 test(`denied browser storage is unavailable, not measured zero (${language})`, async () => {
  const dom = new JSDOM('', {runScripts:'dangerously',url:'http://localhost/'});
  try {
   const w=dom.window; w.eval(source);
   const card=w.document.createElement('ha-purge-cache');card.hass={language,states:{},themes:{darkMode:false}};
   const denied=()=>{throw new w.DOMException('blocked fixture','SecurityError')};
   Object.defineProperty(w,'caches',{value:{keys:async()=>denied()},configurable:true});
   Object.defineProperty(w.navigator,'serviceWorker',{value:{getRegistrations:async()=>denied()},configurable:true});
   Object.defineProperty(w,'localStorage',{get:denied,configurable:true});
   Object.defineProperty(w,'sessionStorage',{get:denied,configurable:true});
   await card._collectStats();
   for (const id of ['stat-ls','stat-ss','stat-sw','stat-cs']) {
    const el=card.shadowRoot.getElementById(id);
    assert.equal(el.querySelector('.stat-num').textContent.trim(),'—',id+' must not claim zero after denied read');
    assert.match(el.textContent,language==='pl'?/Błąd odczytu/:/Read failed/);
    assert.doesNotMatch(el.textContent,/HTTP/, 'an available API error is not an insecure-origin diagnosis');
   }
   assert.match(card.shadowRoot.getElementById('ls-keys').textContent,language==='pl'?/Błąd odczytu/:/Read failed/);
   delete w.localStorage;delete w.sessionStorage;delete w.caches;delete w.navigator.serviceWorker;
   Object.defineProperty(w,'localStorage',{value:{length:0},configurable:true});
   Object.defineProperty(w,'sessionStorage',{value:{length:0},configurable:true});
   Object.defineProperty(w,'caches',{value:{keys:async()=>[]},configurable:true});
   Object.defineProperty(w.navigator,'serviceWorker',{value:{getRegistrations:async()=>[]},configurable:true});
   await card._collectStats();
   for(const id of ['stat-ls','stat-ss','stat-sw','stat-cs']) assert.equal(card.shadowRoot.getElementById(id).querySelector('.stat-num').textContent.trim(),'0',id+' must retain measured zero on successful empty read');
  } finally {dom.window.close();}
 });
}
