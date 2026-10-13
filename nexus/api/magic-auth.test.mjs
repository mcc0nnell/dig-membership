import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from './worker.mjs';
import {attendeeIdentity,sendMagicEmail} from './magic-auth.mjs';
import {magicPage,magicClient} from './magic-page.mjs';
const origin='https://nexus.example.invalid';
const key='magic-only-configuration-secret-value-with-great-entropy-test';
function makeFixture(){
 let lastLink=null;const store=new Map(),sessions=new Set(),mail=[];
 const env={MAGIC_LINK_ENABLED:true,MAGIC_LINK_EMAIL_ENABLED:true,MAGIC_LINK_SESSION_SECRET:key,
 magicRateLimiter:{limit:async()=>({success:true})},
 magicDb:{issue:async(hash,email,event)=>{store.clear();store.set(hash,{email,eventSlug:event});return true;},
  consume:async hash=>{const result=store.get(hash);store.delete(hash);return result||null;},
  revoke:async hash=>{store.delete(hash);return true;}},
 magicMailer:async data=>{mail.push(data);lastLink=data.token;},
 authStateStore:async(action,sid)=>{
  if(action==='createSession'){sessions.add(sid);return true;}
  if(action==='checkSession')return sessions.has(sid);
  if(action==='revokeSession'){sessions.delete(sid);return true;}
  return false;
 }};
 const req=(path,body,options={})=>new Request(origin+path,{method:'POST',headers:{'content-type':'application/json','origin':origin,'cf-connecting-ip':'198.51.100.100',...options.headers},body:JSON.stringify(body)});
 return {env,req,getToken:()=>lastLink,mail,store};
}
test('magic links are disabled by default and reject cross-origin requests',async()=>{
 const fixture=makeFixture();const {req,env}=fixture;
 assert.equal((await worker.fetch(req('/api/auth/magic/request',{email:'a@example.invalid',event:'ntc-2027'}))).status,503);
 assert.equal((await worker.fetch(req('/api/auth/magic/request',{email:'a@example.invalid',event:'ntc-2027'},{headers:{origin:'https://evil.invalid'}}),env)).status,403);
});
test('email magic link single-use, verified attendee session, logout and staff isolation',async()=>{
 const {env,req,getToken,mail,store}=makeFixture();
 const request=req('/api/auth/magic/request',{email:'Person@Example.Invalid',event:'ntc-2027'});
 const sent=await worker.fetch(request,env);
 assert.equal(sent.status,202);assert.equal(mail.length,1);assert.equal(mail[0].to,'person@example.invalid');
 assert.equal(store.size,1);assert.notEqual([...store.keys()][0],getToken());
 const redeem=()=>req('/api/auth/magic/redeem',{token:getToken()});
 const success=await worker.fetch(redeem(),env);assert.equal(success.status,200);
 const cookie=success.headers.get('set-cookie').split(';')[0];
 assert.match(cookie,/__Host-dig_nexus_magic=/);assert.equal((await worker.fetch(redeem(),env)).status,401);
 const login=new Request(origin+'/api/conference/ntc-2027/me',{headers:{cookie}});
 const actor=await attendeeIdentity(login,env);
 assert.equal(actor.issuer,'urn:dig:nexus:magic');assert.equal(actor.email,'person@example.invalid');
 assert.equal(actor.verified,true);
 // The magic identity deliberately is NOT a Google OIDC staff or member session.
 const staff=await worker.fetch(new Request(origin+'/api/conference/ntc-2027/coordination',{headers:{cookie}}),{
  ...env,CONFERENCE_REGISTRATION_ENABLED:true,conferenceDb:{coordination:async()=>{throw Error('should not be reached');}}});
 assert.equal(staff.status,401);
 const cancelled=await worker.fetch(req('/api/auth/magic/logout',{}, {headers:{cookie}}),env);
 assert.equal(cancelled.status,200);assert.match(cancelled.headers.get('set-cookie'),/Max-Age=0/);
 await assert.rejects(attendeeIdentity(login,env));
});
test('new request replaces old token and origin/IP rate limits fail closed',async()=>{
 const {env,req,mail}=makeFixture();
 await worker.fetch(req('/api/auth/magic/request',{email:'a@example.invalid',event:'ntc-2027'}),env);
 const first=mail[0].token;
 await worker.fetch(req('/api/auth/magic/request',{email:'a@example.invalid',event:'ntc-2027'}),env);
 assert.equal((await worker.fetch(req('/api/auth/magic/redeem',{token:first}),env)).status,401);
 const throttle={...env,magicRateLimiter:{limit:async()=>({success:false})}};
 const blocked=await worker.fetch(req('/api/auth/magic/request',{email:'another@example.invalid',event:'ntc-2027'}),throttle);
 assert.equal(blocked.status,202);assert.equal(mail.length,2);
});
test('mailer sends no marketing consent and handles provider failure',async()=>{
 let msg;
 const result=await sendMagicEmail({MAILERSEND_API_TOKEN:'local-test',MAILERSEND_FROM_EMAIL:'events@example.invalid'},
  {to:'receiver@example.invalid',token:'t'.repeat(43),event:'ntc-2027',origin},
  async(_url,options)=>{msg=JSON.parse(options.body);return new Response(null,{status:202});});
 assert.equal(result,undefined);assert.deepEqual(msg.tags,['dig-nexus-magic-link']);
 assert.deepEqual(msg.settings,{track_clicks:false,track_opens:false,track_content:false});
 assert.match(msg.text,/#token=/);
 assert.equal('unsubscribeUrl' in msg,false);
 await assert.rejects(sendMagicEmail({MAILERSEND_API_TOKEN:'x',MAILERSEND_FROM_EMAIL:'events@example.invalid'},
  {to:'receiver@example.invalid',token:'x'.repeat(43),event:'ntc-2027',origin},async()=>new Response(null,{status:429})));
});
test('email login page has explicit consent to redeem, no HTML interpolation or third-party scripts',async()=>{
 const html=await magicPage().text();assert.match(html,/Complete sign-in/);assert.match(html,/Sign in by email/);
 assert.equal(magicPage().headers.get('referrer-policy'),'no-referrer');const js=await magicClient().text();assert.doesNotThrow(()=>new vm.Script(js));
 assert.doesNotMatch(js,/innerHTML|document\.write/);
});
