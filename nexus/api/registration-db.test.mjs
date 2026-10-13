import {test} from "node:test";
import assert from "node:assert/strict";
import {createRegistrationDb} from "./registration-db.mjs";
test("adapter uses one parameterized atomic SQL call",async()=>{
 let sql,params;
 const db=createRegistrationDb({query:async(q,p)=>{sql=q;params=p;return {rows:[{kind:"created",memberId:"synthetic-id"}]};}});
 const result=await db.registerVerifiedIdentity({issuer:"https://id.example.invalid",subject:"subject-1",email:"test@example.invalid",displayName:"Test"});
 assert.equal(result.kind,"created");assert.equal(result.memberId,"synthetic-id");
 assert.match(sql,/nexus_register_verified_identity\(\$1,\$2,\$3,\$4\)/);
 assert.deepEqual(params,["https://id.example.invalid","subject-1","test@example.invalid","Test"]);
});
test("invalid DB response fails closed",async()=>{
 const db=createRegistrationDb({query:async()=>({rows:[{kind:"activated",memberId:"synthetic-id"}]})});
 await assert.rejects(()=>db.registerVerifiedIdentity({issuer:"x",subject:"y",email:"z",displayName:"Test"}));
});
