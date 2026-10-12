const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

test('cache-only preserves login and local tool records while deleting selected caches and workers', async () => {
 const dom = new JSDOM('', {url:'http://localhost/',runScripts:'dangerously'});
 try {
  const w=dom.window;w.eval(readFileSync(join(__dirname,'..','ha-purge-cache.js'),'utf8'));
  const card=w.document.createElement('ha-purge-cache');card.hass={language:'en',user:{is_admin:true}};w.document.body.append(card);await card._collectStats();
  const fixture={ 'ha-baby-tracker-children':'baby','ha-tools-trace-viewer-stored':'trace','ha-sentence-manager-state':'sentence',hassTokens:'login',unrelated:'foreign'};
  for(const area of [w.localStorage,w.sessionStorage])for(const [key,value] of Object.entries(fixture))area.setItem(key,value);
  const names=new Set(['one','two']);w.caches={keys:async()=>[...names],delete:async name=>names.delete(name)};
  const regs=new Map(['one','two'].map(name=>[name,{scope:`http://localhost/${name}/`,unregister:async()=>regs.delete(name)}]));
  Object.defineProperty(w.navigator,'serviceWorker',{value:{getRegistrations:async()=>[...regs.values()]},configurable:true});
  await card._purgeCachesOnly();assert.equal(names.size,0);assert.equal(regs.size,0);assert.equal(card._reloadTimer,null);
  for(const area of [w.localStorage,w.sessionStorage])for(const [key,value]of Object.entries(fixture))assert.equal(area.getItem(key),value);
  assert.equal(card._actionResult.status,'success');assert.equal(card._actionResult.components.length,2);
 }finally{dom.window.close();}
});
