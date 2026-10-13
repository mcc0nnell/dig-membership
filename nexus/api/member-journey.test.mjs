import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {finishGoogleLogin} from './google-auth.mjs';

const base='https://nexus.example.invalid';
function harness() {
 const auth=new Map(),members=new Map(),emails=new Map(),calls=[];
 const stub={fetch:async(_url,opts)=>{
  const {action,id,ttl}=JSON.parse(opts.body);
  if(action==='createFlow'||action==='createSession'){auth.set(id,Date.now()+ttl);return Response.json({ok:true});}
  if(action==='consumeFlow'){const ok=(auth.get(id)||0)>Date.now();auth.delete(id);return Response.json({ok});}
  if(action==='checkSession')return Response.json({ok:(auth.get(id)||0)>Date.now()});
  if(action==='revokeSession'){auth.delete(id);return Response.json({ok:true});}
  return Response.json({ok:false},{status:400});
 }};
 const env={
  AUTH_STATE:{idFromName:()=> 'synthetic',get:()=>stub},
  GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',
  GOOGLE_REDIRECT_URI:base+'/auth/google/callback',
  GOOGLE_SESSION_SECRET:'this-is-a-synthetic-session-secret-at-least-43-characters',
  MEMBER_ENROLLMENT_ENABLED:true,
  registrationRateLimiter:{limit:async()=>({success:true})},
  memberDb:{findByIdentity:async ({issuer,subject})=>members.get(issuer+'|'+subject)??null},
  registrationDb:{registerVerifiedIdentity:async ({issuer,subject,email,displayName})=>{
   calls.push({issuer,subject,email,displayName});
   const key=issuer+'|'+subject;
   if(members.has(key))return {kind:'existing',memberId:members.get(key).id};
   if(emails.has(email))return {kind:'email_conflict'};
   const id='synthetic-'+(members.size+1);
   members.set(key,{id,displayName,memberStatus:'pending'});
   emails.set(email,key);
   return {kind:'created',memberId:id};
  }}
 };
 async function signIn(subject='synthetic-subject',email='synthetic@example.invalid') {
  const start=await worker.fetch(new Request(base+'/auth/google/start'),env);
  assert.equal(start.status,303);
  const google=new URL(start.headers.get('location'));
  const flow=start.headers.get('set-cookie').split(';')[0];
  const callback=new Request(base+'/auth/google/callback?code=synthetic&state='+google.searchParams.get('state'),{headers:{cookie:flow}});
  const result=await finishGoogleLogin(callback,env,{
   fetcher:async()=>Response.json({id_token:'synthetic'}),
   verifyToken:async()=>({
    iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,
    nonce:google.searchParams.get('nonce'),sub:subject,email,email_verified:true
   })
  });
  assert.equal(result.status,303);
  return result.headers.getSetCookie().find(s=>s.startsWith('__Host-dig_nexus_session=')).split(';')[0];
 }
 function me(cookie) {return worker.fetch(new Request(base+'/api/me',{headers:{cookie}}),env);}
 function enroll(cookie,body={displayName:'Synthetic Member',requestMembership:true},headers={}) {
  return worker.fetch(new Request(base+'/api/enroll',{
   method:'POST',headers:{
    cookie,origin:base,'content-type':'application/json','x-dig-nexus-action':'request-membership',
    'cf-connecting-ip':'192.0.2.7','sec-fetch-site':'same-origin',...headers
   },body:JSON.stringify(body)
  }),env);
 }
 return {env,signIn,me,enroll,members,calls};
}
test('complete synthetic member journey: sign in, pending request, status, sign out',async()=>{
 const h=harness();
 const cookie=await h.signIn();
 let result=await h.me(cookie);
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{member:null,enrollmentAvailable:true});
 result=await h.enroll(cookie);
 assert.equal(result.status,201);
 const created=await result.json();
 assert.equal(created.memberId,'synthetic-1');
 assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0],{
  issuer:'https://accounts.google.com',subject:'synthetic-subject',
  email:'synthetic@example.invalid',displayName:'Synthetic Member'
 });
 result=await h.me(cookie);
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.member.memberStatus,'pending');
 assert.equal(data.member.displayName,'Synthetic Member');
 // Repeated requests do not create a second record or automatically grant membership.
 result=await h.enroll(cookie);
 assert.equal(result.status,200);
 assert.equal((await result.json()).memberId,created.memberId);
 assert.equal(h.members.size,1);
 const logout=await worker.fetch(new Request(base+'/auth/logout',{
  method:'POST',headers:{cookie,origin:base}
 }),h.env);
 assert.equal(logout.status,303);
 assert.equal((await h.me(cookie)).status,401);
 assert.equal((await h.enroll(cookie)).status,401);
});
test('default-off, CSRF, malformed input, absent rate limiter and identity conflicts fail closed',async()=>{
 const h=harness(),cookie=await h.signIn();
 assert.equal((await h.enroll(cookie,{displayName:'Member',requestMembership:true},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await h.enroll(cookie,{displayName:'Member',requestMembership:true},{'sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await h.enroll(cookie,{displayName:'Member',requestMembership:true},{'x-dig-nexus-action':''})).status,403);
 assert.equal((await h.enroll(cookie,{displayName:'Member',requestMembership:true,roles:['admin']})).status,400);
 assert.equal((await h.enroll(cookie,{displayName:'Member'})).status,400);
 assert.equal((await h.enroll(cookie,{displayName:'Member',requestMembership:true,newsletterConsent:true})).status,400);
 assert.equal(h.members.size,0);
 const disabled={...h.env,MEMBER_ENROLLMENT_ENABLED:false};
 assert.equal((await worker.fetch(new Request(base+'/api/enroll',{method:'POST'}),disabled)).status,503);
 const unprotected={...h.env,registrationRateLimiter:undefined};
 assert.equal((await worker.fetch(new Request(base+'/api/enroll',{method:'POST',headers:{
  cookie,origin:base,'content-type':'application/json','x-dig-nexus-action':'request-membership','cf-connecting-ip':'192.0.2.7'
 },body:JSON.stringify({displayName:'Example',requestMembership:true})}),unprotected)).status,503);
 assert.equal((await h.enroll(cookie)).status,201);
 const other=await h.signIn('other-subject');
 assert.equal((await h.enroll(other)).status,409);
 assert.equal(h.members.size,1);
});
test('portal has accessible request flow, no inline scripts and no automatic opt-in',async()=>{
 const response=await worker.fetch(new Request(base+'/portal'));
 assert.equal(response.status,200);
 const content=await response.text();
 assert.match(content,/join-form/);
 assert.match(content,/request DIG membership/i);
 assert.match(content,/does not subscribe me to newsletters/i);
 assert.match(content,/name="intent"/);
 assert.doesNotMatch(response.headers.get('content-security-policy'),/unsafe-inline/);
 assert.match(content,/src="\/portal-client.mjs"/);
 assert.match(content,/href="\/portal.css"/);
 assert.equal((await worker.fetch(new Request(base+'/portal.css'))).status,200);
 const script=await worker.fetch(new Request(base+'/portal-client.mjs'));
 assert.match(await script.text(),/x-dig-nexus-action/);
});
