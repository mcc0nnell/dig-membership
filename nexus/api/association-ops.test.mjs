import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {createAssociationOpsDb} from './association-ops.mjs';
const url='https://nexus.example.invalid/api/association';
const member='11111111-1111-4111-8111-111111111111';
const campaign='22222222-2222-4222-8222-222222222222';
const identity={verified:true,emailVerified:true,issuer:'https://accounts.google.com',subject:'verified-staff'};
const allow={CONSTITUENTS_ENABLED:true,CAMPAIGNS_ENABLED:true,
 verifyAssociationIdentity:async()=>identity,organizerRateLimiter:{limit:async()=>({success:true})},
 associationOpsDb:{member:async()=>({displayName:'Synthetic'}),activity:async()=>({recorded:true}),
  campaign:async()=>({eligibleRecipients:1}),queue:async()=>({status:'queued',recipients:1})}};
const post=(path,body,action,headers={})=>new Request(url+path,{method:'POST',headers:{origin:'https://nexus.example.invalid','x-dig-nexus-action':action,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('both clean-room operations have independently disabled public gates',async()=>{
 assert.equal((await worker.fetch(new Request(url+'/members/'+member))).status,503);
 assert.equal((await worker.fetch(new Request(url+'/campaigns/'+campaign))).status,503);
 assert.equal((await worker.fetch(post('/campaigns/'+campaign+'/queue',undefined,'queue-campaign'))).status,503);
});
test('valid staff identity and rate limiter required, never trust client role headers',async()=>{
 assert.equal((await worker.fetch(new Request(url+'/members/'+member),allow)).status,200);
 assert.equal((await worker.fetch(new Request(url+'/campaigns/'+campaign),allow)).status,200);
 assert.equal((await worker.fetch(new Request(url+'/members/'+member),{...allow,organizerRateLimiter:null})).status,503);
 assert.equal((await worker.fetch(new Request(url+'/members/'+member),{...allow,verifyAssociationIdentity:async()=>{throw Error('revoked');}})).status,401);
});
test('writes enforce exact origin, intentional action header, and allow-listed fields',async()=>{
 assert.equal((await worker.fetch(post('/members/'+member+'/activities',{action:'meeting',summary:'Synthetic followup'},'record-activity'),allow)).status,200);
 assert.equal((await worker.fetch(post('/members/'+member+'/activities',{action:'meeting',summary:'Synthetic',role:'admin'},'record-activity'),allow)).status,400);
 assert.equal((await worker.fetch(post('/members/'+member+'/activities',{action:'meeting',summary:'Synthetic'},'record-activity',{origin:'https://bad.invalid'}),allow)).status,403);
 assert.equal((await worker.fetch(post('/members/'+member+'/activities',{action:'meeting',summary:'Synthetic'},'record-activity',{'sec-fetch-site':'cross-site'}),allow)).status,403);
 assert.equal((await worker.fetch(post('/campaigns/'+campaign+'/queue',undefined,'queue-campaign'),allow)).status,200);
 assert.equal((await worker.fetch(post('/campaigns/'+campaign+'/queue',undefined,'unrelated-action'),allow)).status,403);
 assert.equal((await worker.fetch(post('/campaigns/'+campaign+'/queue',{override:true},'queue-campaign'),allow)).status,400);
});
test('database functions bind verified immutable identity and parameters',async()=>{
 const calls=[];
 const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{value:{status:'ok'}}]};}};
 const db=createAssociationOpsDb(client);
 await db.member(identity,identity.subject,member);
 await db.activity(identity,identity.subject,member,'meeting','Synthetic');
 await db.campaign(identity,identity.subject,campaign);
 await db.queue(identity,identity.subject,campaign);
 assert.equal(calls.length,4);
 assert.deepEqual(calls[1].args,[identity.issuer,identity.subject,member,'meeting','Synthetic']);
 for(const {sql} of calls)assert.match(sql,/\$1,\$2,\$3/);
 assert.doesNotMatch(JSON.stringify(calls.map(x=>x.sql)),/Synthetic/);
});
