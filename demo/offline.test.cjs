const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'offline.html'),'utf8');
const scripts=[...html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)].map(x=>x[1]);
const script=scripts[0];
test('standalone demo has parseable JavaScript and no external dependencies',()=>{
  assert.equal(scripts.length,3);
  for(const part of scripts)assert.doesNotThrow(()=>new vm.Script(part));
  assert.doesNotMatch(html,/<script[^>]+src=/i);
  assert.doesNotMatch(html,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(html,/<form[^>]+action=/i);
  assert.doesNotMatch(html,/<a[^>]+href="https?:/i);
  assert.match(html,/connect-src 'none'/);
});
test('all simulated UX views and disclaimers exist',()=>{
  for(const name of ['join','verify','dashboard','overview','profile','preferences','renewal','emails','staff'])
    assert.ok(html.includes(name),name);
  assert.match(html,/SYNTHETIC DATA/);
  assert.match(html,/No backend calls/);
  assert.match(html,/real emails/i);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/Skip to main content/);
  assert.match(html,/name="news"/);
});

function harness() {
  class Element {
    constructor(id){this.id=id;this.hidden=false;this.value='';this.textContent='';this.listeners={};this.children=[];this.checked=false;this.dataset={};this.style={};
      this.classList={toggle:()=>{}};}
    addEventListener(type,fn){this.listeners[type]=fn;}
    fire(type='click'){const fn=this.listeners[type];assert.ok(fn,this.id+' has '+type+' listener');
      return fn({preventDefault(){},currentTarget:this});}
    setAttribute(){}focus(){}appendChild(c){this.children.push(c);}replaceChildren(){this.children=[];}
    reportValidity(){return true;} reset(){}
  }
  const all={};
  const get=id=>all[id]??(all[id]=new Element(id));
  const form=(id,fields)=>{
    const e=get(id);const members={};
    for(const [k,v] of Object.entries(fields)){members[k]=new Element(k);members[k].value=v;}
    e.elements={namedItem:name=>members[name]};return e;
  };
  form('join-form',{firstName:'Alex',lastName:'Example',email:'alex@example.test'});
  form('profile-form',{firstName:'',lastName:'',email:'',agency:'',title:''});
  form('preferences-form',{news:'',events:'',access:'ASL',format:'Plain text'});
  const tabs=['overview','profile','preferences','renewal','emails','community','staff'].map(name=>{
    const e=new Element('tab-'+name);e.dataset.tab=name;return e;
  });
  const panels=tabs.map(tab=>{const e=new Element('panel-'+tab.dataset.tab);e.dataset.panel=tab.dataset.tab;return e;});
  const doc={
    getElementById:get,
    createElement:name=>new Element(name),
    querySelectorAll:selector=>selector==='[data-tab]'?tabs:selector==='[data-panel]'?panels:[],
    querySelector:selector=>{
      const match=selector.match(/^\[data-tab="(.+)"\]$/);if(match)return tabs.find(x=>x.dataset.tab===match[1]);
      if(selector.includes(' h3'))return new Element('heading');throw Error('Unexpected selector '+selector);
    }
  };
  const ctx={document:doc,Date,Math,console};
  vm.runInNewContext(script,ctx);
  return {get,tabs,panels};
}
test('join requires simulated verification; activation is local',()=>{
  const {get}=harness();
  get('join-form').fire('submit');
  assert.equal(get('join').hidden,true);
  assert.equal(get('verify').hidden,false);
  assert.match(get('status').textContent,/no email sent/i);
  get('activate').fire();
  assert.equal(get('dashboard').hidden,false);
  assert.match(get('welcome').textContent,/Alex Example/);
  assert.match(get('status').textContent,/Actual DIG enrollment requires an explicit pending request/i);
});
test('expired mock verification fails and does not activate',()=>{
  const {get}=harness();get('join-form').fire('submit');
  get('expire').fire();get('activate').fire();
  assert.equal(get('dashboard').hidden,true);
  assert.match(get('status').textContent,/invalid, expired or used/i);
});
test('local profile, preferences, renewal and reset are functional',()=>{
  const {get}=harness();get('join-form').fire('submit');get('activate').fire();
  const form=get('profile-form').elements;
  form.namedItem('firstName').value='Sam';
  form.namedItem('lastName').value='Sample';
  form.namedItem('agency').value='Example Agency';
  get('profile-form').fire('submit');
  assert.match(get('welcome').textContent,/Sam Sample/);
  assert.equal(form.namedItem('email').value,'alex@example.test');
  get('preferences-form').elements.namedItem('news').checked=true;
  get('preferences-form').fire('submit');
  assert.match(get('status').textContent,/in memory/);
  const prev=get('end-date').textContent;
  get('renew').fire();
  assert.notEqual(get('end-date').textContent,prev);
  get('reset').fire();
  assert.equal(get('join').hidden,false);assert.equal(get('dashboard').hidden,true);
});

test('new member workspace is synthetic and includes accessible community navigation',()=>{
  assert.match(html,/id="card-name"/);
  assert.match(html,/id="card-expiry"/);
  assert.match(html,/class="activity-timeline"/);
  assert.match(html,/data-panel="community"/);
  assert.match(html,/data-go="community"/);
  assert.match(html,/Voting is not available in this demo/);
});

test('offline platform explorer has all three distinct journeys and truthful service boundaries',()=>{
 for(const id of ['ntc-tour','ntc-status','ntc-request','ntc-verify','ntc-checkin','ntc-refund',
  'association-tour','staff-load','staff-activity','newsletter-tour','news-preview','news-confirm',
  'news-queue','news-optout','news-eligible'])
  assert.match(html,new RegExp('id="'+id+'"'),id);
 assert.match(html,/no Zeffy stock held and no admission/i);
 assert.match(html,/List assignment never implies opt-in/i);
 assert.match(html,/queueing does not send/i);
 assert.doesNotMatch(html,/Salesforce/i);
});
