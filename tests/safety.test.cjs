const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
let browser;
before(async () => { browser = await chromium.launch({ headless:true, ...(process.env.LATIAS_BROWSER ? { executablePath:process.env.LATIAS_BROWSER } : {}) }); });
after(async () => { await browser?.close(); });
async function fixture(html, url='https://livepocket.jp/purchase/confirm') {
  const page=await browser.newPage();
  await page.route('**/*', route => route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="utf-8"><title>抽選応募フォーム</title></head><body>'+html+'</body></html>'}));
  await page.goto(url);
  await page.evaluate(() => {
    globalThis.events=[];
    for(const type of ['click','input','change','blur','submit','mousedown','mouseup']) document.addEventListener(type,e=>{events.push({type,id:e.target.id}); if(type==='submit') e.preventDefault();},true);
    globalThis.listeners=[];
    globalThis.chrome={runtime:{id:'test-extension',onMessage:{addListener:fn=>listeners.push(fn)}}};
  });
  for(const file of manifest.content_scripts[0].js) await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  return page;
}
async function send(page, message) {
  return page.evaluate(msg=>new Promise(resolve=>listeners[0](msg,{id:'test-extension'},resolve)),message);
}
const profile={lastName:'Test',firstName:'User',email:'test@example.invalid',phone:'0000000000',birthDate:'2000-01-02'};
function rule(actions, agrees=[]) { return {schemaVersion:2,id:'fixture',match:{hosts:['livepocket.jp']},stages:[{paths:[{prefix:'/purchase/confirm'}],fillActions:actions,agreeActions:agrees}], safety:{neverClickTexts:[]}}; }
test('PRIORITY: malicious remote selectors cannot mutate or activate submit/buttons/links',async()=>{
  const page=await fixture('<form><button id="submit" type="submit" role="checkbox" aria-label="規約に同意します" aria-required="true">送信</button><input id="inputSubmit" type="submit" value="送信"><button id="default">続ける</button><a id="link" href="/final">氏名</a><input id="image" type="image"></form>');
  const before=await page.locator('body').innerHTML();
  const actions=['checkByLabel','ensureCheckedByLabel','fillProfileByLabel','selectProfileByLabel','selectMaxByLabel','selectTextByLabel','clickText','submit'].map(type=>({type,selector:'#submit,#inputSubmit,#default,#link,#image',labelRegex:'.*',profileKey:'email',text:'送信',overwrite:true,allowReadOnly:true,safe:true}));
  const result=await send(page,{type:'FILL_FORM',profile,rule:rule(actions)});
  assert.equal(result.ok,true); assert.equal(result.changed,0); assert.ok(Object.keys(result.rejected).length);
  assert.deepEqual(await page.evaluate(()=>events),[]);
  assert.equal(await page.locator('body').innerHTML(),before);
  await page.close();
});
test('required affirmative native consent only; existing refusal and optional choices remain unchanged',async()=>{
  const page=await fixture('<form><fieldset><legend>利用規約 必須</legend><label><input id="yes" type="checkbox" required>同意します</label></fieldset><fieldset><legend>利用規約 任意</legend><label><input id="optional" type="checkbox">同意します</label></fieldset><fieldset><legend>利用規約 必須</legend><label><input id="no" type="checkbox" required>同意しない</label></fieldset><fieldset><legend>利用規約 必須</legend><label><input type="radio" name="r" checked>いいえ</label><label><input id="radioYes" name="r" type="radio">はい</label></fieldset></form>');
  const r=rule([],[{type:'checkByLabel',selector:'input',labelRegex:'.*'}]);
  assert.equal((await send(page,{type:'AGREE_TERMS',profile,rule:r})).changed,1);
  assert.equal((await send(page,{type:'AGREE_TERMS',profile,rule:r})).changed,0);
  assert.deepEqual(await page.evaluate(()=>['yes','optional','no','radioYes'].map(id=>document.getElementById(id).checked)),[true,false,false,false]);
  assert.equal((await page.evaluate(()=>events)).filter(x=>x.type==='click').length,0);
  await page.close();
});
test('manual categories, hidden/readonly controls, spoofed ARIA and inline handlers are denied',async()=>{
  const labels=['ログイン メール','CAPTCHA 電話','本人確認書類 氏名','受取日 生年月日','店舗 住所','好きなポケモン 氏名','任意アンケート メール','SMS認証 電話'];
  const page=await fixture(labels.map((label,i)=>`<label>${label}<input id="x${i}" required></label>`).join('')+'<label>メール<input id="ro" readonly></label><label>メール<input id="hidden" style="display:none"></label><label>メール<input id="inline" onchange="window.bad=true"></label><div role="checkbox" aria-required="true" aria-label="規約に同意します" id="aria"></div>');
  const r=rule([{type:'fillProfileByLabel',selector:'input',labelRegex:'.*',profileKey:'email',overwrite:true,allowReadOnly:true},{type:'checkByLabel',selector:'[role]',labelRegex:'.*'}]);
  assert.equal((await send(page,{type:'FILL_FORM',profile,rule:r})).changed,0);
  assert.deepEqual(await page.evaluate(()=>events),[]);
  await page.close();
});
test('safe profile fields fill through Gateway and existing input is preserved',async()=>{
  const page=await fixture('<label>メール<input id="email" type="email"></label><label>電話番号<input id="phone" value="manual"></label>');
  const r=rule([{type:'fillProfileByLabel',selector:'#email',labelRegex:'.*',profileKey:'email'},{type:'fillProfileByLabel',selector:'#phone',labelRegex:'.*',profileKey:'phone',overwrite:true}]);
  assert.equal((await send(page,{type:'FILL_FORM',profile,rule:r})).changed,1);
  assert.equal(await page.locator('#email').inputValue(),profile.email);
  assert.equal(await page.locator('#phone').inputValue(),'manual');
  assert.deepEqual(await page.evaluate(()=>events.map(x=>x.type)),['input','change','blur']);
  await page.close();
});
test('ord adaptive spacing preserves letter s and never changes manual input',async()=>{
  const page=await fixture('<label>氏名<input id="name" pattern="[^ ]+"></label><label>氏名<input id="manual" value="Chris Test" pattern="[^ ]+"></label>');
  const r=rule([{type:'fillProfileByLabel',selector:'input',labelRegex:'.*',profileKey:'__fullNameExact'}]);
  const p={lastName:'Chris',firstName:'Test'};
  await send(page,{type:'FILL_FORM',profile:p,rule:r});
  assert.equal(await page.locator('#name').inputValue(),'ChrisTest');
  assert.equal(await page.locator('#manual').inputValue(),'Chris Test');
  await page.close();
});
test('quantity no max stays empty; existing quantity reaches max; disabled unit option excluded',async()=>{
  const page=await fixture('<label>数量<input id="unknown" type="number"></label><label>数量<input id="count" type="number" value="1" max="3"></label><label>数量<select id="q"><option>1個</option><option>3個</option><option disabled>9個</option><optgroup disabled><option>10個</option></optgroup></select></label>');
  await send(page,{type:'FILL_FORM',profile});
  assert.equal(await page.locator('#unknown').inputValue(),'');
  assert.equal(await page.locator('#count').inputValue(),'3');
  assert.equal(await page.locator('#q').inputValue(),'3個');
  await page.close();
});
test('outside run, unsupported host, stale target, auth form: zero operations',async()=>{
  const page=await fixture('<label>メール<input id="email"></label>','https://unknown.example/form');
  assert.equal(await page.evaluate(()=>LATIASSafety.setValue(document.getElementById('email'),'x')),false);
  await send(page,{type:'FILL_FORM',profile});
  assert.deepEqual(await page.evaluate(()=>events),[]);
  await page.close();
  const auth=await fixture('<form><label>メール<input id="email"></label><input type="password"></form>');
  await send(auth,{type:'FILL_FORM',profile}); assert.deepEqual(await auth.evaluate(()=>events),[]); await auth.close();
});
test('remote compiler returns data without DOM; strips permission overrides and rejects click',()=>{
  const context={}; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root,'rule_candidates.js'),'utf8'),context);
  const result=context.LATIASRuleCandidates.compile([{type:'fillProfileByLabel',selector:'#submit',labelRegex:'.*',profileKey:'email',overwrite:true,allowReadOnly:true},{type:'clickText',text:'送信'}]);
  assert.equal(result[0].kind,'profile'); assert.equal(result[0].overwrite,undefined); assert.equal(result[0].allowReadOnly,undefined); assert.equal(result[1].kind,'blocked');
});
test('Google Forms/CustomForm sweeps pass through Gateway, do not act on load',async()=>{
  for(const url of ['https://docs.google.com/forms/d/e/test/viewform','https://customform.jp/form/input/test']) {
    const page=await fixture('<fieldset><legend>利用規約 必須</legend><label><input id="yes" type="checkbox" required>同意します</label></fieldset><label>受取日<input id="date" type="checkbox"></label><div role="checkbox" aria-label="返信に表示するメールアドレスとして記録する" id="aria"></div>',url);
    assert.deepEqual(await page.evaluate(()=>events),[]);
    await send(page,{type:'AGREE_TERMS',profile});
    assert.equal(await page.locator('#yes').isChecked(),true);
    assert.equal(await page.locator('#date').isChecked(),false);
    assert.equal((await page.evaluate(()=>events)).some(x=>x.id==='aria'),false);
    await page.close();
  }
});
test('simultaneous messages are serialized; legacy modules cannot register independent writers',async()=>{
  const page=await fixture('<label>メール<input id="email"></label>');
  for(const f of ['question_mapper.js','rule_enhancer.js']) await page.addScriptTag({content:fs.readFileSync(path.join(root,f),'utf8')});
  assert.equal(await page.evaluate(()=>listeners.length),1);
  const results=await Promise.all([send(page,{type:'FILL_FORM',profile}),send(page,{type:'FILL_FORM',profile})]);
  assert.equal(results.reduce((s,r)=>s+r.changed,0),1);
  assert.deepEqual(await page.evaluate(()=>events.map(x=>x.type)),['input','change','blur']);
  await page.close();
});

test('Gateway rejects detached targets and invalidates the run after URL changes',async()=>{
  const page=await fixture('<label>メール<input id="email"></label>');
  const results=await page.evaluate(()=>{
    const original=document.getElementById('email');
    const detached=original.cloneNode();
    LATIASSafety.begin();
    const stale=LATIASSafety.setValue(detached,'a@example.invalid');
    history.pushState({},'', '/purchase/confirm?next=1');
    const navigated=LATIASSafety.setValue(original,'a@example.invalid');
    const reasons=LATIASSafety.end();
    return {stale,navigated,reasons};
  });
  assert.equal(results.stale,false); assert.equal(results.navigated,false);
  assert.ok(results.reasons['stale-target']); assert.ok(results.reasons['no-current-run']);
  assert.deepEqual(await page.evaluate(()=>events),[]); await page.close();
});

test('select changes use same manual/consent policy and remote fixed answers have no authority',async()=>{
  const page=await fixture('<label>都道府県<select id="pref"><option value="">選択</option><option>東京都</option></select></label><label>受取日<select id="date"><option value="">選択</option><option>東京都</option></select></label><fieldset><legend>利用規約 必須</legend><label>規約<select id="consent" required><option value="">選択</option><option>はい</option><option>いいえ</option></select></label></fieldset>');
  const r=rule([{type:'selectProfileByLabel',selector:'select',labelRegex:'.*',profileKey:'prefecture'},{type:'selectTextByLabel',selector:'#date',labelRegex:'.*',text:'東京都'}],[{type:'selectPositivePairs',selector:'#consent',labelRegex:'.*',pairs:[['はい','いいえ']]}]);
  await send(page,{type:'FILL_FORM',profile:{prefecture:'東京都'},rule:r});
  await send(page,{type:'AGREE_TERMS',profile,rule:r});
  assert.equal(await page.locator('#pref').inputValue(),'東京都');
  assert.equal(await page.locator('#date').inputValue(),'');
  assert.equal(await page.locator('#consent').inputValue(),'はい');
  assert.ok(!(await page.evaluate(()=>events)).some(x=>x.id==='date')); await page.close();
});

test('unsupported messages and content-script senders cannot open a mutation session',async()=>{
  const page=await fixture('<label>メール<input id="email"></label>');
  assert.equal(await page.evaluate(()=>listeners[0]({type:'FILL_FORM',profile:{email:'x'}},{id:'test-extension',tab:{id:5}},()=>{})),false);
  assert.equal(await page.evaluate(()=>listeners[0]({type:'FILL_FORM',profile:{email:'x'}},{id:'other'},()=>{})),false);
  assert.deepEqual(await page.evaluate(()=>events),[]); await page.close();
});

const googleURL='https://docs.google.com/forms/d/e/test/viewform';
function googleForm(inner){return `<form method="post" action="/forms/d/e/test/formResponse">${inner}</form>`;}
function ariaQuestion(id,title='利用規約',label='同意します',role='checkbox',required=true){return `<div role="listitem"><div role="heading">${title}${required?'<span aria-label="必須の質問">*</span>':''}</div><div role="${role==='radio'?'radiogroup':'group'}"><div id="${id}" role="${role}" aria-checked="false" tabindex="0" jscontroller="fixture" jsaction="click:fixture" aria-label="${label}">${label}</div></div></div>`;}
async function wireGoogle(page){await page.evaluate(()=>{document.querySelectorAll('div[jscontroller]').forEach(el=>el.addEventListener('click',()=>el.setAttribute('aria-checked','true')));});}

test('Google Forms verified required affirmative ARIA checkbox and radio use dedicated Gateway once',async()=>{
 const page=await fixture(googleForm(ariaQuestion('check')+ariaQuestion('radio','利用規約','はい','radio')),googleURL);await wireGoogle(page);
 assert.equal((await send(page,{type:'AGREE_TERMS'})).changed,2);
 assert.equal((await send(page,{type:'AGREE_TERMS'})).changed,0);
 assert.deepEqual(await page.evaluate(()=>events.map(x=>[x.type,x.id])),[['click','check'],['click','radio']]);
 assert.equal(await page.evaluate(()=>typeof LATIASSafety.click),'undefined');await page.close();
});

test('Google Forms email recording requires whole exact label and required evidence',async()=>{
 const good='返信に表示するメールアドレスとして test@example.invalid を記録する';
 const page=await fixture(googleForm(ariaQuestion('good','メール',good)+ariaQuestion('optional','メール',good,'checkbox',false)+ariaQuestion('suffix','メール',good+'（広告にも利用）')+ariaQuestion('other','メール','返信に表示するメールアドレスとして任意の情報を記録する')+ariaQuestion('context','メール '+good,'チェックする')),googleURL);await wireGoogle(page);
 assert.equal((await send(page,{type:'FILL_FORM',profile:{}})).changed,1);
 assert.deepEqual(await page.evaluate(()=>events.map(x=>x.id)),['good']);await page.close();
});

test('Google Forms negative optional store pickup identity and survey choices stay untouched',async()=>{
 const html=ariaQuestion('negative','利用規約','同意しない')+['利用規約 任意','利用規約 店舗','利用規約 受取日','利用規約 本人確認','利用規約 アンケート'].map((t,i)=>ariaQuestion('x'+i,t)).join('');
 const page=await fixture(googleForm(html),googleURL);await wireGoogle(page);
 assert.equal((await send(page,{type:'AGREE_TERMS'})).changed,0);assert.deepEqual(await page.evaluate(()=>events),[]);await page.close();
});

test('PRIORITY: spoofed Google role on button submit link or nested button never activates via any capability',async()=>{
 const html='<fieldset><legend>利用規約 必須</legend>'+['<button type="submit"','<button','<input type="submit"','<a href="/final"','<div'].map((tag,i)=>`${tag} id="bad${i}" role="checkbox" aria-checked="false" aria-required="true" tabindex="0" jscontroller="fixture" jsaction="click:fixture" aria-label="同意します">${i===4?'<button>送信</button>':'同意します'}${tag.startsWith('<input')?'':tag.startsWith('<a')?'</a>':tag.startsWith('<div')?'</div>':'</button>'}`).join('')+'</fieldset>';
 const page=await fixture(googleForm(html),googleURL);
 const before=await page.locator('body').innerHTML();
 await page.evaluate(async()=>{LATIASSafety.begin();for(const el of document.querySelectorAll('[id^=bad]')){await LATIASSafety.ensureGoogleConsent(el);await LATIASSafety.ensureGoogleEmailRecording(el);LATIASSafety.ensureProduct(el);LATIASSafety.ensureConsent(el);}LATIASSafety.end();});
 const r={schemaVersion:2,id:'evil',match:{hosts:['docs.google.com']},stages:[{paths:[{prefix:'/forms/'}],fillActions:['checkByLabel','selectProductByLabel','fillProfileByLabel','selectMaxByLabel','clickText','submit'].map(type=>({type,selector:'[id^=bad]',labelRegex:'.*',profileKey:'email'}))}]};
 await send(page,{type:'FILL_FORM',profile,rule:r});assert.deepEqual(await page.evaluate(()=>events),[]);assert.equal(await page.locator('body').innerHTML(),before);await page.close();
});

test('native product checkbox is independent from consent; radio constrained manual and ARIA products stay unchanged',async()=>{
 const field=(title,inner)=>`<fieldset><legend>${title}</legend>${inner}</fieldset>`;
 const choice=(id,type='checkbox')=>`<label><input id="${id}" type="${type}">商品A</label>`;
 const page=await fixture(field('購入希望商品',choice('product'))+field('応募商品',choice('radio','radio'))+field('応募商品 最大1つ',choice('limited'))+field('応募商品 店舗',choice('store'))+field('利用規約 必須',choice('consent'))+field('応募商品','<div id="ariaProduct" role="checkbox" aria-checked="false">商品A</div>'));
 assert.equal((await send(page,{type:'FILL_FORM',profile:{},rule:rule([{type:'selectProductByLabel',selector:'input,[role=checkbox]',labelRegex:'.*'}])})).changed,1);
 assert.deepEqual(await page.evaluate(()=>['product','radio','limited','store','consent'].map(id=>document.getElementById(id).checked)),[true,false,false,false,false]);
 assert.deepEqual(await page.evaluate(()=>events.map(x=>[x.type,x.id])),[['input','product'],['change','product'],['blur','product']]);await page.close();
});

test('Google ARIA contract rejects other origins missing controller wrong form action and existing radio choice',async()=>{
 const html=googleForm(ariaQuestion('yes'));
 const outside=await fixture(html);await wireGoogle(outside);await send(outside,{type:'AGREE_TERMS',rule:rule([],[{type:'checkByLabel',selector:'[role=checkbox]',labelRegex:'.*'}])});assert.deepEqual(await outside.evaluate(()=>events),[]);await outside.close();
 for(const mutation of ['controller','action','existing']){
  const page=await fixture(googleForm(ariaQuestion('yes','利用規約','はい','radio')),googleURL);await wireGoogle(page);
  await page.evaluate(kind=>{const el=document.getElementById('yes');if(kind==='controller')el.removeAttribute('jscontroller');if(kind==='action')document.querySelector('form').action='/forms/d/e/other/formResponse';if(kind==='existing'){const other=el.cloneNode(true);other.id='no';other.setAttribute('aria-checked','true');other.setAttribute('aria-label','同意しない');el.parentElement.appendChild(other);}},mutation);
  assert.equal((await send(page,{type:'AGREE_TERMS'})).changed,0);assert.deepEqual(await page.evaluate(()=>events),[]);await page.close();
 }
});

test('unconfirmed Google click never forces aria state or retries; value API cannot borrow choice purposes',async()=>{
 const page=await fixture(googleForm(ariaQuestion('pending')+'<fieldset><legend>応募商品</legend><label><input id="p" type="checkbox">商品A</label></fieldset>'),googleURL);
 assert.equal((await send(page,{type:'AGREE_TERMS'})).changed,0);assert.equal((await send(page,{type:'AGREE_TERMS'})).changed,0);
 assert.equal(await page.locator('#pending').getAttribute('aria-checked'),'false');assert.deepEqual(await page.evaluate(()=>events.map(x=>x.type)),['click']);
 assert.equal(await page.evaluate(()=>{LATIASSafety.begin();const result=LATIASSafety.setValue(document.getElementById('p'),'changed',{purpose:'product'});LATIASSafety.end();return result;}),false);await page.close();
});
