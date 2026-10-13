const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const get=name=>readFileSync(join(__dirname,name),'utf8');
const palette=JSON.parse(get('dig-brand-tokens.json'));
const offline=get('offline.html'), atlas=get('atlas.html');
test('shared DIG token palette has canonical source values',()=>{
 assert.match(palette.source,/portal\/public\/css\/house.css/);
 for(const [role,hex] of Object.entries({navy900:'#0a1628',navy700:'#1a2d4d',slate600:'#475569',electric:'#3b82f6',brandRed:'#e63312',dangerRed:'#dc2626',success:'#16a34a',warning:'#d97706',white:'#ffffff'}))
  assert.equal(palette.color[role].$value,hex);
 assert.match(palette.font.sans.$value,/Instrument Sans/);
});
test('both public design surfaces share brand and stay truthful about local simulation',()=>{
 for(const html of [offline,atlas]){
   assert.match(html,/#0a1628/i);assert.match(html,/#e63312/i);
   assert.match(html,/Instrument Sans/);
   assert.match(html,/prefers-reduced-motion/);
   assert.match(html,/synthetic/i);
 }
 assert.match(offline,/<details class="notice">/);
 assert.match(offline,/<summary>/);
 assert.match(offline,/No backend calls/);
 assert.match(offline,/DIG Nexus interactive prototype, not a live membership service/);
 assert.doesNotMatch(offline,/<script[^>]*\bsrc=/);
 assert.doesNotMatch(offline,/@import|@font-face|url\(https?:/);
});
