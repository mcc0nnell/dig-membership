import {test} from "node:test";
import assert from "node:assert/strict";
import {registerMember} from "./registration.mjs";
const identity={verified:true,emailVerified:true,issuer:"https://id.example.invalid",subject:"subject-1",email:" TEST@EXAMPLE.INVALID "};
test("unauthenticated registration denied before database",async()=>{
 let called=false;
 const result=await registerMember({identity:{...identity,verified:false},body:{displayName:"Test"},db:{registerVerifiedIdentity:async()=>{called=true;}}});
 assert.equal(result.status,401);assert.equal(called,false);
});
test("server controls identity and refuses client consent/roles",async()=>{
 const db={registerVerifiedIdentity:async()=>{throw new Error("should not be called")}};
 assert.equal((await registerMember({identity,body:{displayName:"Test",newsletterConsent:true},db})).status,400);
});
test("verified registration and repeat request are idempotent",async()=>{
 let seen;let calls=0;
 const db={registerVerifiedIdentity:async(input)=>{seen=input;return {kind:++calls===1?"created":"existing",memberId:"synthetic-id"};}};
 const first=await registerMember({identity,body:{displayName:"Test"},db});
 const second=await registerMember({identity,body:{displayName:"Test"},db});
 assert.equal(first.status,201);assert.equal(second.status,200);
 assert.equal(seen.email,"test@example.invalid");assert.equal(seen.subject,"subject-1");
});
test("different identity claiming same email is a conflict",async()=>{
 const db={registerVerifiedIdentity:async()=>({kind:"email_conflict"})};
 assert.equal((await registerMember({identity,body:{displayName:"Test"},db})).status,409);
});
test("missing database adapter fails closed",async()=>{
 assert.equal((await registerMember({identity,body:{displayName:"Test"}})).status,503);
});
