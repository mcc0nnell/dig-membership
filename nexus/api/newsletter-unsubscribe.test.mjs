import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {hashToken} from '../../newsletter/tokens.mjs';
const token='a'.repeat(64);
const path='https://nexus.example.invalid/newsletter/unsubscribe/'+token;
test('unsubscribe endpoint is separately disabled by default',async()=>{
 assert.equal((await worker.fetch(new Request(path))).status,503);
 assert.equal((await worker.fetch(new Request(path,{method:'POST',body:'List-Unsubscribe=One-Click',headers:{'content-type':'application/x-www-form-urlencoded'}}))).status,503);
});
test('GET only presents confirmation and never consumes the private token',async()=>{
 let consumed=0;
 const env={NEWSLETTER_UNSUBSCRIBE_ENABLED:true,unsubscribeDb:{redeem:async()=>{consumed++;return true;}}};
 const page=await worker.fetch(new Request(path),env);
 assert.equal(page.status,200);
 assert.match(page.headers.get('content-security-policy'),/form-action 'self'/);
 assert.match(await page.text(),/Confirm unsubscribe/);
 assert.equal(consumed,0);
});
test('mailbox one-click POST and human confirmation both redeem hashed tokens, without leaking subscriber existence',async()=>{
 const observed=[];
 const env={NEWSLETTER_UNSUBSCRIBE_ENABLED:true,unsubscribeDb:{redeem:async hash=>{observed.push(hash);return false;}}};
 for(const content of ['List-Unsubscribe=One-Click','confirm=1']){
  const r=await worker.fetch(new Request(path,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:content}),env);
  assert.equal(r.status,200);assert.match(await r.text(),/processed/);
 }
 assert.deepEqual(observed,[await hashToken(token),await hashToken(token)]);
 assert.notEqual(observed[0],token);
});
test('malformed POST bodies and content types reject before touching the DB',async()=>{
 let calls=0;
 const env={NEWSLETTER_UNSUBSCRIBE_ENABLED:true,unsubscribeDb:{redeem:async()=>{calls++;return true;}}};
 for(const [content,type] of [['not-one-click','application/x-www-form-urlencoded'],['confirm=1','application/json']]){
  const r=await worker.fetch(new Request(path,{method:'POST',headers:{'content-type':type},body:content}),env);
  assert.notEqual(r.status,200);
 }
 assert.equal(calls,0);
});
test('broken database leaves unsubscribe pending with 503, never returns false success',async()=>{
 const env={NEWSLETTER_UNSUBSCRIBE_ENABLED:true,unsubscribeDb:{redeem:async()=>{throw Error('synthetic DB outage')}}};
 const r=await worker.fetch(new Request(path,{method:'POST',body:'confirm=1',headers:{'content-type':'application/x-www-form-urlencoded'}}),env);
 assert.equal(r.status,503);
});
