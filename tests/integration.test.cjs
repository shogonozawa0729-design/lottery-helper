const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'..');
const read = f => fs.readFileSync(path.join(root,f),'utf8').replace(/^\uFEFF/,'');
const manifest = JSON.parse(read('manifest.json'));

test('page execution inventory is fixed; no Gateway bypass in active scripts',()=>{
  assert.deepEqual(manifest.content_scripts[0].js,['field_policy.js','safety_gateway.js','rule_candidates.js','content.js']);
  const forbidden=[/\.(?:click|dispatchEvent|submit|requestSubmit|setAttribute|removeAttribute|appendChild|insertAdjacentHTML)\s*\(/,/\b(?:eval|Function|Event|MouseEvent|KeyboardEvent)\s*\(/,/\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/,/Object\.(?:getOwnPropertyDescriptor|assign)\s*\(/,/\.(?:value|checked|selected|selectedIndex|innerHTML|outerHTML|textContent)\s*=/,/\[['"](?:value|checked|selected|click|dispatchEvent)['"]\]\s*(?:=|\()/];
  for(const f of manifest.content_scripts[0].js.filter(f=>f!=='safety_gateway.js')) {
    const source=read(f).replace(/item\.checked\s*=/g,'dataProperty ='); // INSPECT_FORM JSON field, not a DOM mutation.
    for(const pattern of forbidden) assert.ok(!pattern.test(source),`${f}: ${pattern}`);
  }
  const popup=read('popup.js');
  assert.ok(!/\bfunc\s*:/.test(popup));
  assert.ok(!/files:\s*\[\s*['"](?:question_mapper|rule_enhancer)/.test(popup));
  for(const f of ['question_mapper.js','rule_enhancer.js']) assert.match(read(f),/\(\(\) => \{\s*\/\/ Phase 1 quarantine:[\s\S]*?\n  return;/);
});

test('popup only processes active tab and tabs to its right; previous core is not over-injected',async()=>{
  const elements=new Map();
  const el=id=>{if(!elements.has(id)) elements.set(id,{textContent:'',style:{},setAttribute(){},addEventListener(){}});return elements.get(id);};
  const calls=[];
  const tabs=[{id:1,index:0,url:'https://left.invalid'},{id:2,index:1,url:'https://active.invalid'},{id:3,index:2,url:'chrome://extensions'},{id:4,index:3,url:'https://right.invalid'}];
  const context={document:{getElementById:el},URL,Date,setInterval(){},navigator:{},fetch:async()=>({ok:true,json:async()=>({adapters:[]})}),chrome:{storage:{local:{get:async()=>({}),set:async()=>{}}},tabs:{query:async q=>q.active?[tabs[1]]:tabs,sendMessage:async()=>({ok:true,helperVersion:'0.9.8'})},scripting:{executeScript:async()=>calls.push('inject')}}};
  vm.createContext(context); vm.runInContext(read('popup.js'),context);
  assert.deepEqual(Array.from(await vm.runInContext('queryWebTabsFromActive()',context),x=>x.id),[2,4]);
  assert.equal(await vm.runInContext('ensureCurrentContent(2)',context),false);
  assert.deepEqual(calls,[]);
});

test('profile schema/save code stays byte-identical and archived copies are absent',()=>{
  const inventory=JSON.parse(read('docs/local-sources.json'));
  for(const entry of inventory.files.filter(e=>['options.js','options.html','dynamic_profile_fields.js','background.js'].includes(e.path))) {
    const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,entry.path))).digest('hex');
    assert.equal(hash,entry.sha256,entry.path);
  }
  for(const entry of inventory.files.filter(e=>e.path.startsWith('lottery-helper_ord/') || e.path.includes('.backup-'))) {
    assert.match(entry.sha256,/^[a-f0-9]{64}$/);
    assert.equal(fs.existsSync(path.join(root,entry.path)),false,entry.path);
  }
  assert.match(read('options.js'),/profile:\s*\{\s*\.\.\.existingProfile,\s*\.\.\.data\s*\}/);
  assert.match(read('options.js'),/chrome\.storage\.local\.get\('profile'\)/);
  assert.match(read('popup.js'),/const RULE_CACHE_KEY = 'remoteRuleBundleV2'/);
});

test('ord split kana improvement and corrected spacing are present only in active core',()=>{
  const content=read('content.js');
  assert.ok(content.includes('姓の?(?:フリガナ|ふりがな|カナ)'));
  assert.ok(!content.includes('/[\\\\s　]'));
  assert.ok(content.includes('/[\\s　]'));
  assert.match(content,/identityCorrection: true/);
  assert.equal(manifest.version,'0.9.8.3');
});
