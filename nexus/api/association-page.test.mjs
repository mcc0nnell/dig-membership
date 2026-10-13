import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
test('new association workspace is disabled for anonymous users by default',async()=>{
 const response=await worker.fetch(new Request('https://nexus.example.invalid/association'));
 assert.equal(response.status,503);
});
test('staff workspace is a CSP-restricted shell, with no embedded member PII',async()=>{
 const response=await worker.fetch(new Request('https://nexus.example.invalid/association'),{CONSTITUENTS_ENABLED:true});
 assert.equal(response.status,200);
 const html=await response.text();
 assert.match(html,/id="workspace-status"/);
 assert.match(html,/Queue approved campaign/);
 assert.match(html,/src="\/association-client\.mjs"/);
 assert.doesNotMatch(html,/Synthetic Person|subscriber@example\.invalid/);
 assert.doesNotMatch(response.headers.get('content-security-policy'),/unsafe-inline/);
 const css=await worker.fetch(new Request('https://nexus.example.invalid/association.css'));
 const js=await worker.fetch(new Request('https://nexus.example.invalid/association-client.mjs'));
 assert.equal(css.status,200);assert.equal(js.status,200);
 assert.match(await js.text(),/textContent/);
});
