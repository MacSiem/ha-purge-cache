const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const source=readFileSync(join(__dirname,'..','ha-purge-cache.js'),'utf8');
function setup(language='en') {
 const dom=new JSDOM('',{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true});
 dom.window.eval(source);const card=dom.window.document.createElement('ha-purge-cache');
 card.hass={language,states:{},user:{is_admin:false}};dom.window.document.body.append(card);
 return {dom,w:dom.window,card,root:card.shadowRoot};
}
for(const language of ['en','pl']) for(const api of ['serviceWorker','caches']) {
 test(`denied API property access leaves measured failures and usable actions: ${api} (${language})`,async()=>{
  const {dom,w,card,root}=setup(language);
  try {
   const target=api==='serviceWorker'?w.navigator:w;
   Object.defineProperty(target,api,{configurable:true,get(){throw new w.DOMException('actual browser denial','SecurityError');}});
   await assert.doesNotReject(card._collectStats());
   assert.match(root.querySelector(api==='serviceWorker'?'#stat-sw':'#stat-cs').textContent,language==='pl'?/Błąd odczytu/:/Read failed/);
   await assert.doesNotReject(card._purgeCachesOnly());
   assert.equal(card._reloadTimer,null);
   assert.match(root.querySelector('#action-log').textContent,/actual browser denial/);
  }finally{dom.window.close();}
 });
}
test('configured long title is rendered literally and preserved across ordinary language change',()=>{
 const {dom,card,root}=setup();try{
  const title='Kitchen & <img data-hostile-title src=x> '+ 'long title '.repeat(40);
  card.setConfig({title});assert.ok(root.querySelector('h2').textContent.includes(title));
  assert.equal(root.querySelector('[data-hostile-title]'),null);
  card.hass={language:'pl',states:{},user:{is_admin:false}};
  assert.ok(root.querySelector('h2').textContent.includes(title));
 }finally{dom.window.close();}
});
test('storage key disclosure is a keyboard button with an accurate expanded state',()=>{
 const {dom,root}=setup();try{
  const toggle=root.querySelector('#keys-toggle');
  assert.equal(toggle.tagName,'BUTTON');assert.equal(toggle.getAttribute('aria-expanded'),'true');
  toggle.focus();assert.equal(root.activeElement,toggle);toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.ok(root.querySelector('#ls-keys').classList.contains('hidden'));
 }finally{dom.window.close();}
});
test('successful single-key deletion keeps other data and gives focus to the key disclosure',async()=>{
 const {dom,w,card,root}=setup();try{
  w.localStorage.setItem('owned','disposable');w.localStorage.setItem('other','retained');await card._collectStats();
  const trigger=root.querySelector('[data-key="owned"]');trigger.focus();trigger.click();
  root.querySelector('#confirm-ok').click();await new Promise(r=>setImmediate(r));
  assert.equal(w.localStorage.getItem('owned'),null);assert.equal(w.localStorage.getItem('other'),'retained');
  assert.equal(root.activeElement,root.querySelector('#keys-toggle'));
 }finally{dom.window.close();}
});
