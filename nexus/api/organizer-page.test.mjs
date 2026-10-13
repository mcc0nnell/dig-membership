import {test} from 'node:test';
import assert from 'node:assert/strict';
import {organizerPage,organizerClient} from './organizer-page.mjs';
import vm from 'node:vm';
test('staff console has labeled controls and live feedback, with strict CSP',async()=>{
 const response=organizerPage('ntc-2027');
 const html=await response.text();
 assert.match(html,/<html lang="en">/);
 assert.match(html,/aria-live="polite"/);
 assert.match(html,/href="#main"/);
 assert.match(html,/for="session-start"/);
 assert.match(html,/for="speaker-name"/);
 assert.match(html,/type="module" src="\/organizer-client.mjs"/);
 assert.doesNotMatch(html,/<script(?! type="module")/);
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
});
test('organizer client is executable syntax and never inserts untrusted HTML',async()=>{
 const js=await organizerClient().text();
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML|document\.write/);
 assert.match(js,/textContent/);
 assert.match(js,/fetch\('\/api\/organizer\//);
});
