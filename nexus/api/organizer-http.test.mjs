import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const root='https://nexus.example.invalid',slug='ntc-2027';
const verified={verified:true,emailVerified:true,issuer:'https://accounts.google.com',subject:'synthetic-subject'};
const snapshot={event:{slug,title:'NTC Test',startsAt:'2027-04-28T13:00:00Z',endsAt:'2027-04-30T22:00:00Z',timezone:'America/New_York',publicationStatus:'draft'},staffRole:'manager',sessions:[],speakers:[],links:[]};
const env={ORGANIZER_ENABLED:true,verifyOrganizerIdentity:async()=>verified,organizerDb:{snapshot:async()=>snapshot,apply:async(_slug,_identity,action)=>({ok:true,change:{action}})},organizerRateLimiter:{limit:async()=>({success:true})}};
const write=(body,headers={})=>new Request(root+'/api/organizer/'+slug+'/actions',{method:'POST',headers:{origin:root,'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
test('organizer routes fail closed by default, including guessed draft slugs',async()=>{
 for(const url of ['/organizer/ntc-2027','/api/organizer/ntc-2027'])assert.equal((await worker.fetch(new Request(root+url))).status,503);
});
test('organizer GET requires verified Google session identity',async()=>{
 let accessed=false;
 const rejected={...env,verifyOrganizerIdentity:async()=>{throw Error('session revoked');},organizerDb:{snapshot:async()=>{accessed=true;}}};
 const r=await worker.fetch(new Request(root+'/api/organizer/'+slug,{headers:{'x-role':'admin','x-member-id':'forged'}}),rejected);
 assert.equal(r.status,401);assert.equal(accessed,false);
});
test('authorized organizer renders private console and JSON with secure headers',async()=>{
 const r=await worker.fetch(new Request(root+'/organizer/'+slug),env);
 assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
 assert.match(await r.text(),/Conference organizer/);
 const data=await worker.fetch(new Request(root+'/api/organizer/'+slug),env);
 assert.equal(data.status,200);assert.equal((await data.json()).organizer.staffRole,'manager');
});
test('valid manager changes are forwarded without accepting client identity',async()=>{
 const r=await worker.fetch(write({action:'set_event_publication',data:{publicationStatus:'published'}}),env);
 assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
});
test('drafts are not enumerated without event scope, even for verified identity',async()=>{
 const rejected={...env,organizerDb:{snapshot:async()=>null}};
 assert.equal((await worker.fetch(new Request(root+'/api/organizer/'+slug),rejected)).status,404);
 assert.equal((await worker.fetch(write({action:'set_event_publication',data:{publicationStatus:'published'}}),rejected)).status,404);
});
test('rejects CSRF, forged roles, unknown actions, oversized content and missing rate limit',async()=>{
 let changes=0;
 const scoped={...env,organizerDb:{snapshot:async()=>snapshot,apply:async()=>{changes++;return {ok:true};}}};
 assert.equal((await worker.fetch(write({action:'set_event_publication',data:{publicationStatus:'published'}},{origin:'https://evil.invalid'}),scoped)).status,403);
 assert.equal((await worker.fetch(write({action:'set_event_publication',data:{publicationStatus:'published'},role:'admin'}),scoped)).status,400);
 assert.equal((await worker.fetch(write({action:'unknown',data:{}}),scoped)).status,400);
 assert.equal((await worker.fetch(write('{'),scoped)).status,400);
 const rate={...scoped,organizerRateLimiter:undefined};
 assert.equal((await worker.fetch(write({action:'set_event_publication',data:{publicationStatus:'published'}}),rate)).status,503);
 const denied={...scoped,organizerRateLimiter:{limit:async()=>({success:false})}};
 assert.equal((await worker.fetch(write({action:'set_event_publication',data:{publicationStatus:'published'}}),denied)).status,429);
 assert.equal(changes,0);
});
test('PostgreSQL scope and validation errors map to safe HTTP errors',async()=>{
 for(const [code,status] of [['42501',403],['22023',400],['23505',409],['P0002',404],['unexpected',503]]){
  const db={...env,organizerDb:{snapshot:async()=>snapshot,apply:async()=>{const e=Error('sensitive');e.code=code;throw e;}}};
  const r=await worker.fetch(write({action:'set_event_publication',data:{publicationStatus:'published'}}),db);
  assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/sensitive/);
 }
});
test('unauthorized verified identity and suspended sessions fail without exposing drafts',async()=>{
 const r=await worker.fetch(new Request(root+'/api/organizer/'+slug),{...env,verifyOrganizerIdentity:async()=>({verified:true,emailVerified:false,issuer:verified.issuer,subject:verified.subject})});
 assert.equal(r.status,401);
});
