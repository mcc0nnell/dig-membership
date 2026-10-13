import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const url='https://nexus.example.invalid/api/me';
const identity={verified:true,emailVerified:true,issuer:'https://id.example.invalid',subject:'synthetic'};
const config={OIDC_ISSUER:'https://id.example.invalid',OIDC_AUDIENCE:'dig',OIDC_JWKS_URL:'https://id.example.invalid/jwks'};
test('member endpoint fails closed without auth configuration',async()=>{
 assert.equal((await worker.fetch(new Request(url))).status,503);
});
test('member endpoint requires verified identity',async()=>{
 const response=await worker.fetch(new Request(url),{...config,verifyIdentity:async()=>{throw Error('bad');}});
 assert.equal(response.status,401);
});
test('member endpoint uses verified issuer and subject only',async()=>{
 let observed;
 const response=await worker.fetch(new Request(url),{...config,verifyIdentity:async()=>identity,memberDb:{findByIdentity:async data=>{observed=data;return {id:'synthetic-id',displayName:'Example',memberStatus:'pending'};}}});
 assert.equal(response.status,200);
 assert.equal((await response.json()).member.memberStatus,'pending');
 assert.equal(observed.subject,'synthetic');
});
