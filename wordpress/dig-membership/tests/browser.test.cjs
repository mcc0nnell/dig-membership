const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../assets/dig-membership.js'),'utf8');

test('magic-link fragment is removed before verification request and never sent to WP', async () => {
  const status = { textContent: '' };
  const root = { dataset:{digMode:'verify'}, querySelector: () => status };
  const history = [];
  const calls=[];
  const context = {
    URL, URLSearchParams,
    window:{ DIGMembership:{ gateway:'https://members.deafingov.org' },
      location:{href:'https://deafingov.org/magic/#t=secret-token-valid-12345&p=web-join'},
      history:{replaceState:(_a,_b,url)=>history.push(url)} },
    document:{querySelectorAll:()=>[root]},
    fetch:(url, options)=>{calls.push([url,options]);return Promise.resolve({ ok:true, json:async()=>({ok:true,status:'ACTIVE'}) });}
  };
  vm.runInNewContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(history,['/magic/']);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'https://members.deafingov.org/api/membership/verify');
  assert.deepEqual(JSON.parse(calls[0][1].body),{token:'secret-token-valid-12345'});
  assert.equal(calls[0][1].credentials,'omit');
  assert.equal(status.textContent,'Your DIG membership is active.');
});

test('invalid purpose fails without calling Worker', () => {
  const status={textContent:''}; const root={dataset:{digMode:'verify'},querySelector:()=>status};
  let called=false;
  const context={URL,URLSearchParams,
    window:{DIGMembership:{gateway:'https://members.deafingov.org'},location:{href:'https://deafingov.org/magic/#t=token&p=login'},history:{replaceState:()=>{}}},
    document:{querySelectorAll:()=>[root]},fetch:()=>{called=true;}};
  vm.runInNewContext(script,context);
  assert.equal(called,false);
  assert.match(status.textContent,/invalid/);
});
