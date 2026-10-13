import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {validConferenceBody} from './conference-api.mjs';
const origin='https://nexus.example.invalid', slug='ntc-2027';
const id={verified:true,emailVerified:true,issuer:'https://accounts.google.com',subject:'fixture',email:'fixture@example.invalid'};
const db={self:async()=>null,register:async()=>({status:'registered',confirmationReference:'not-a-ticket'}),
 workshop:async()=>({status:'waitlisted'}),cancel:async()=>({status:'cancelled'}),
 accommodation:async()=>({saved:true}),coordination:async()=>({requests:[]})};
const env={CONFERENCE_REGISTRATION_ENABLED:true,verifyConferenceIdentity:async()=>id,
 conferenceDb:db,conferenceRateLimiter:{limit:async()=>({success:true})}};
const req=(action,method='GET',body={},headers={})=>new Request(origin+'/api/conference/'+slug+'/'+action,{
 method,headers:method==='GET'?headers:{origin,'content-type':'application/json',...headers},
 ...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
test('anonymous event registration shell is accessible but contains no private records',async()=>{
 const r=await worker.fetch(new Request(origin+'/conference/'+slug));
 assert.equal(r.status,200);const html=await r.text();
 assert.match(html,/Skip to registration/);assert.match(html,/Deaf in Government/);
 assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
 assert.doesNotMatch(html,/fixture@example.invalid/);
});
test('attendee APIs disabled by default; caller-supplied identity header ignored',async()=>{
 assert.equal((await worker.fetch(req('me'))).status,503);
 const rejected={...env,verifyConferenceIdentity:async()=>{throw Error('revoked cookie');}};
 assert.equal((await worker.fetch(req('register','POST',{displayName:'Person'},{'x-member-id':'admin','x-role':'admin'}),rejected)).status,401);
});
test('membership-free registration binds only verified session email',async()=>{
 let actor;
 const target={...db,register:async(_slug,who,name)=>{actor={who,name};return {status:'registered',confirmationReference:'random-reference'};}};
 const r=await worker.fetch(req('register','POST',{displayName:'Synthetic Person'}),{...env,conferenceDb:target});
 assert.equal(r.status,200);assert.equal((await r.json()).result.confirmationReference,'random-reference');
 assert.deepEqual(actor,{who:id,name:'Synthetic Person'});
});
test('workshop capacity status, cancellation, self and private request use distinct methods',async()=>{
 assert.equal((await worker.fetch(req('workshops','POST',{sessionSlug:'session-one',action:'reserve'}),env)).status,200);
 assert.equal((await worker.fetch(req('cancel','POST',{}),env)).status,200);
 assert.equal((await worker.fetch(req('me'),env)).status,200);
 assert.equal((await worker.fetch(req('accommodations','PUT',{request:'CART',consent:true}),env)).status,200);
 assert.equal((await worker.fetch(req('coordination'),env)).status,200);
 assert.equal((await worker.fetch(req('coordination','POST',{}),env)).status,405);
});
test('unknown fields and missing consent never reach database',async()=>{
 let calls=0;const guarded={...env,conferenceDb:{...db,accommodation:async()=>{calls++;}}};
 for(const body of [{request:'CART'},{request:'CART',consent:false},{request:'CART',consent:true,newsletterConsent:true},
  {request:' '},{request:null,consent:true}]){
  const r=await worker.fetch(req('accommodations','PUT',body),guarded);assert.equal(r.status,400);
 }
 assert.equal(calls,0);
 assert.equal((await worker.fetch(req('accommodations','PUT',{request:null}),guarded)).status,200);
 assert.equal(calls,1);
});
test('cross-site POST, malformed payload and missing rate limiter fail closed',async()=>{
 assert.equal((await worker.fetch(req('register','POST',{displayName:'Valid'},{origin:'https://evil.invalid'}),env)).status,403);
 assert.equal((await worker.fetch(req('register','POST','{'),env)).status,400);
 assert.equal((await worker.fetch(req('register','POST',{displayName:'Valid'}),{...env,conferenceRateLimiter:null})).status,503);
 assert.equal((await worker.fetch(req('register','POST',{displayName:'Valid'}),{...env,conferenceRateLimiter:{limit:async()=>({success:false})}})).status,429);
});
test('database permission and availability errors do not leak sensitive detail',async()=>{
 for(const [code,status] of [['42501',403],['P0002',404],['23505',409],['22023',400],['internal',503]]){
  const e=Error('sensitive request body');e.code=code;
  const r=await worker.fetch(req('register','POST',{displayName:'Person'}),{...env,conferenceDb:{...db,register:async()=>{throw e;}}});
  assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/sensitive/);
 }
});
test('verified email is required and names are constrained',()=>{
 assert.equal(validConferenceBody('register',{displayName:'Valid'}),true);
 assert.equal(validConferenceBody('register',{displayName:'Valid',role:'admin'}),false);
 assert.equal(validConferenceBody('register',{displayName:'   '}),false);
 assert.equal(validConferenceBody('workshops',{sessionSlug:'workshop-one',action:'reserve'}),true);
 assert.equal(validConferenceBody('workshops',{sessionSlug:'workshop-one',action:'promote'}),false);
 assert.equal(validConferenceBody('accommodations',{request:null}),true);
 assert.equal(validConferenceBody('cancel',{}),true);
});
