import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {conferencePage,conferenceClient,coordinationPage,coordinationClient} from './conference-page.mjs';
test('HTML features labeled accessible intake and explicit consent',async()=>{
 const r=conferencePage('ntc-2027');const html=await r.text();
 assert.match(html,/lang="en"/);assert.match(html,/aria-live="polite"/);
 assert.match(html,/for="access-note"/);assert.match(html,/id="access-consent"/);
 assert.match(html,/without joining DIG/);assert.match(html,/does not guarantee services/);
 assert.match(html,/Transactional email delivery is optional/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
 assert.doesNotMatch(html,/onClick=|javascript:/i);
});
test('browser source does not use HTML insertion for server-originated content',async()=>{
 const js=await conferenceClient().text();assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(js,/textContent/);assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML|document\.write/);
});

test('restricted coordinator shell embeds no attendee data or third-party code',async()=>{
 const r=coordinationPage('ntc-2027');const html=await r.text();
 assert.equal(r.status,200);assert.match(html,/restricted view contains confidential/i);
 assert.match(html,/role="status"/);assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
 const js=await coordinationClient().text();assert.doesNotThrow(()=>new vm.Script(js));
 assert.doesNotMatch(js,/innerHTML|document\.write|insertAdjacentHTML/);
});
