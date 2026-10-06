const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const {readFileSync} = require('node:fs');
const source=readFileSync(require('node:path').join(__dirname,'..','ha-purge-cache.js'),'utf8');
function setup(lang='en') {
 const dom=new JSDOM('',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
 dom.window.eval(source);
 const card=dom.window.document.createElement('ha-purge-cache');
 card.hass={language:lang,states:{},themes:{darkMode:false},user:{is_admin:true}};
 dom.window.document.body.append(card);
 return {dom,w:dom.window,card,root:card.shadowRoot};
}
for(const lang of ['en','pl']) for(const area of ['localStorage','sessionStorage']) {
 test(`denied ${area} clear reports an error and keeps data (${lang})`,async()=>{
  const {dom,w,card,root}=setup(lang);
  try {
   w[area].setItem('owned','retained');
   w.Storage.prototype.clear=function(){throw new w.DOMException('denied','SecurityError');};
   await assert.doesNotReject(card[area==='localStorage'?'_purgeLocalStorage':'_purgeSessionStorage']());
   assert.equal(w[area].getItem('owned'),'retained');
   assert.match(root.querySelector('.log-error').textContent,lang==='en'?/error/i:/błąd/i);
  }finally{dom.window.close();}
 });
}
test('cache-only failure retains its report without reload and can retry',async()=>{
 const {dom,w,card,root}=setup();try{
  Object.defineProperty(w.navigator,'serviceWorker',{value:{getRegistrations:async()=>[{unregister:async()=>{throw Error('denied worker');}}]},configurable:true});
  w.caches={keys:async()=>['one'],delete:async()=>true};
  await card._purgeCachesOnly();
  assert.equal(card._reloadTimer,null);
  assert.match(root.querySelector('#action-log').textContent,/denied worker/);
  w.navigator.serviceWorker.getRegistrations=async()=>[];
  await card._purgeCachesOnly();
  assert.ok(card._reloadTimer,'successful retry may reload');
 }finally{dom.window.close();}
});
test('full reset reports partial failure and continues independent cleanup',async()=>{
 const {dom,w,card,root}=setup();try{
  w.sessionStorage.setItem('owned','disposable');
  Object.defineProperty(w,'localStorage',{get:()=>{throw new w.DOMException('denied','SecurityError');},configurable:true});
  Object.defineProperty(w.navigator,'serviceWorker',{value:{getRegistrations:async()=>[]}});
  w.caches={keys:async()=>[],delete:async()=>true};
  await assert.doesNotReject(card._purgeAll());
  assert.equal(w.sessionStorage.length,0);
  assert.equal(card._reloadTimer,null);
  assert.doesNotMatch(root.querySelector('#action-log').textContent,/Done!/);
 }finally{dom.window.close();}
});
test('confirmation focuses cancel, traps tab, escapes without deletion and restores focus',()=>{
 const {dom,w,root}=setup();try{
  w.localStorage.setItem('owned','retained');
  const trigger=root.querySelector('#btn-purge-ls');trigger.focus();trigger.click();
  const cancel=root.querySelector('#confirm-cancel'),ok=root.querySelector('#confirm-ok');
  assert.equal(root.activeElement,cancel);
  assert.equal(root.querySelector('.confirm-dialog').getAttribute('role'),'dialog');
  cancel.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(root.activeElement,ok);
  ok.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(root.activeElement,cancel);
  cancel.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(root.activeElement,trigger);
  assert.equal(root.querySelector('#confirm-overlay').style.display,'none');
  assert.equal(w.localStorage.getItem('owned'),'retained');
 }finally{dom.window.close();}
});
test('per-key deletion asks for confirmation and reports denial without removing data',async()=>{
 const {dom,w,card,root}=setup();try{
  w.localStorage.setItem('ha-baby-tracker-children','owned data');await card._collectStats();
  root.querySelector('[data-key="ha-baby-tracker-children"]').click();
  assert.equal(w.localStorage.getItem('ha-baby-tracker-children'),'owned data');
  assert.equal(root.querySelector('#confirm-overlay').style.display,'flex');
  root.querySelector('#confirm-cancel').click();
  assert.equal(w.localStorage.getItem('ha-baby-tracker-children'),'owned data');
  w.Storage.prototype.removeItem=()=>{throw new w.DOMException('denied','SecurityError');};
  root.querySelector('[data-key="ha-baby-tracker-children"]').click();root.querySelector('#confirm-ok').click();
  await new Promise(r=>setImmediate(r));
  assert.match(root.querySelector('.log-error').textContent,/error/i);
 }finally{dom.window.close();}
});
