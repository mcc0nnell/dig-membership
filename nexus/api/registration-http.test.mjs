import {test} from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";
const url="https://example.invalid/api/register";
const security={REGISTRATION_ALLOWED_ORIGIN:"https://example.invalid",registrationRateLimiter:{limit:async()=>({success:true})}};
const request=(body,headers={})=>new Request(url,{method:"POST",headers:{"content-type":"application/json","origin":"https://example.invalid","cf-connecting-ip":"192.0.2.1",...headers},body:JSON.stringify(body)});
const verified={verified:true,emailVerified:true,issuer:"https://id.example.invalid",subject:"subject-1",email:"synthetic@example.invalid"};
test("registration remains disabled without configured trusted services",async()=>{
 const r=await worker.fetch(request({displayName:"Synthetic"}));
 assert.equal(r.status,503);
});
test("forged client headers cannot bypass identity verification",async()=>{
 const r=await worker.fetch(request({displayName:"Synthetic"},{"x-role":"admin","x-member-id":"123"}),{...security,REGISTRATION_ENABLED:true,verifyIdentity:async()=>{throw Error("invalid token");},registrationDb:{}});
 assert.equal(r.status,401);
});
test("verified identity reaches DB adapter without accepting roles or consent",async()=>{
 let received;
 const env={REGISTRATION_ENABLED:true,verifyIdentity:async()=>verified,registrationDb:{registerVerifiedIdentity:async data=>{received=data;return {kind:"created",memberId:"synthetic-id"};}}};
 const r=await worker.fetch(request({displayName:"Synthetic"}),env);
 assert.equal(r.status,201);
 assert.equal((await r.json()).memberId,"synthetic-id");
 assert.equal(received.email,"synthetic@example.invalid");
 const invalid=await worker.fetch(request({displayName:"Synthetic",newsletterConsent:true}),env);
 assert.equal(invalid.status,400);
});
test("conflicting verified identity is not linked by email",async()=>{
 const env={REGISTRATION_ENABLED:true,verifyIdentity:async()=>verified,registrationDb:{registerVerifiedIdentity:async()=>({kind:"email_conflict"})}};
 const r=await worker.fetch(request({displayName:"Synthetic"}),env);
 assert.equal(r.status,409);
});
test("malformed JSON is rejected without writes",async()=>{
 const env={REGISTRATION_ENABLED:true,verifyIdentity:async()=>verified,registrationDb:{registerVerifiedIdentity:async()=>{throw Error("unexpected write");}}};
 const r=await worker.fetch(new Request(url,{method:"POST",headers:{"content-type":"application/json","origin":"https://example.invalid","cf-connecting-ip":"192.0.2.1"},body:"{"}),env);
 assert.equal(r.status,400);
});

test("rejects cross-origin registration before identity verification",async()=>{
 const env={...security,REGISTRATION_ENABLED:true,verifyIdentity:async()=>{throw Error("should not verify");},registrationDb:{}};
 const r=await worker.fetch(request({displayName:"Synthetic"},{origin:"https://evil.invalid"}),env);
 assert.equal(r.status,403);
});
test("rejects registration when edge rate limiter is unavailable",async()=>{
 const env={REGISTRATION_ENABLED:true,REGISTRATION_ALLOWED_ORIGIN:"https://example.invalid",verifyIdentity:async()=>verified,registrationDb:{}};
 const r=await worker.fetch(request({displayName:"Synthetic"}),env);
 assert.equal(r.status,503);
});
test("enforces edge rate limiter before verifying identity",async()=>{
 const env={...security,registrationRateLimiter:{limit:async()=>({success:false})},REGISTRATION_ENABLED:true,verifyIdentity:async()=>{throw Error("should not verify");},registrationDb:{}};
 const r=await worker.fetch(request({displayName:"Synthetic"}),env);
 assert.equal(r.status,429);
});
