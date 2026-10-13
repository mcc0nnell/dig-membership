import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startGoogleLogin,finishGoogleLogin,sessionIdentity,logoutGoogle} from './google-auth.mjs';
const stateRecords=new Map();
const stub={fetch:async(_url,opts)=>{const {action,id,ttl}=JSON.parse(opts.body);if(action==='createFlow'||action==='createSession'){stateRecords.set(id,Date.now()+ttl);return Response.json({ok:true});}if(action==='consumeFlow'){const valid=(stateRecords.get(id)||0)>Date.now();stateRecords.delete(id);return Response.json({ok:valid});}if(action==='checkSession')return Response.json({ok:(stateRecords.get(id)||0)>Date.now()});if(action==='revokeSession'){stateRecords.delete(id);return Response.json({ok:true});}return Response.json({ok:false},{status:400});}};
const env={AUTH_STATE:{idFromName:()=> 'synthetic',get:()=>stub},GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_REDIRECT_URI:'https://nexus.example.invalid/auth/google/callback',GOOGLE_SESSION_SECRET:'synthetic-test-secret-that-is-at-least-43-characters-long'};
test('Google start fails closed without credentials',async()=>{
 assert.equal((await startGoogleLogin(new Request('https://nexus.example.invalid/auth/google/start'),{})).status,503);
});
test('Google login uses PKCE, nonce, state, encrypted cookie and secure session',async()=>{
 const start=await startGoogleLogin(new Request('https://nexus.example.invalid/auth/google/start'),env);
 assert.equal(start.status,303);
 const auth=new URL(start.headers.get('location'));
 assert.equal(auth.origin,'https://accounts.google.com');
 assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 assert.ok(auth.searchParams.get('nonce'));
 assert.ok(start.headers.get('set-cookie').includes('HttpOnly; SameSite=Lax'));
 const flow=start.headers.get('set-cookie').split(';')[0];
 const callback='https://nexus.example.invalid/auth/google/callback?code=synthetic&state='+auth.searchParams.get('state');
 let exchange;
 const result=await finishGoogleLogin(new Request(callback,{headers:{cookie:flow}}),env,{
  fetcher:async(url,options)=>{exchange={url,body:new URLSearchParams(options.body)};return Response.json({id_token:'synthetic'});},
  verifyToken:async()=>({iss:'https://accounts.google.com',audience:'ignored',aud:'synthetic-client',nonce:auth.searchParams.get('nonce'),sub:'subject-1',email:'test@example.invalid',email_verified:true})
 });
 assert.equal(result.status,303);
 assert.equal(result.headers.get('location'),'/portal');
 assert.equal(exchange.url,'https://oauth2.googleapis.com/token');
 assert.ok(exchange.body.get('code_verifier'));
 const cookies=result.headers.getSetCookie();
 const session=cookies.find(c=>c.startsWith('__Host-dig_nexus_session='));
 assert.ok(session);
 assert.equal((await sessionIdentity(new Request('https://nexus.example.invalid/api/me',{headers:{cookie:session.split(';')[0]}}),env)).subject,'subject-1');
 assert.equal((await logoutGoogle(new Request('https://nexus.example.invalid/auth/logout',{method:'POST',headers:{origin:'https://nexus.example.invalid'}}),env)).status,303);
});
test('Google callback rejects missing and mismatched state without token exchange',async()=>{
 const start=await startGoogleLogin(new Request('https://nexus.example.invalid/auth/google/start'),env);
 const flow=start.headers.get('set-cookie').split(';')[0];
 const result=await finishGoogleLogin(new Request('https://nexus.example.invalid/auth/google/callback?code=x&state=wrong',{headers:{cookie:flow}}),env,{fetcher:()=>{throw Error('should not exchange');}});
 assert.equal(result.status,401);
 assert.equal((await finishGoogleLogin(new Request('https://nexus.example.invalid/auth/google/callback?code=x'),env)).status,400);
});
test('Google callback rejects wrong nonce, audience and unverified email',async()=>{
 const start=await startGoogleLogin(new Request('https://nexus.example.invalid/auth/google/start'),env);
 const auth=new URL(start.headers.get('location'));
 const flow=start.headers.get('set-cookie').split(';')[0];
 const callback=new Request('https://nexus.example.invalid/auth/google/callback?code=synthetic&state='+auth.searchParams.get('state'),{headers:{cookie:flow}});
 const base={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,nonce:auth.searchParams.get('nonce'),sub:'subject',email:'synthetic@example.invalid',email_verified:true};
 for(const claims of [{...base,nonce:'wrong'},{...base,aud:'wrong'},{...base,email_verified:false}]){
  const result=await finishGoogleLogin(callback,env,{fetcher:async()=>Response.json({id_token:'synthetic'}),verifyToken:async()=>claims});
  assert.equal(result.status,401);
  assert.equal(result.headers.get('set-cookie').includes('Max-Age=0'),true);
 }
});
test('logout requires exact same origin and portal avoids inline scripts',async()=>{
 const {portalPage,portalClient}=await import('./google-auth.mjs');
 const req=origin=>new Request('https://nexus.example.invalid/auth/logout',{method:'POST',headers:{origin}});
 assert.equal((await logoutGoogle(req('https://attacker.example.invalid'),env)).status,403);
 assert.equal((await logoutGoogle(req('https://nexus.example.invalid'),env)).status,303);
 const portal=portalPage();
 assert.equal(portal.headers.get('content-security-policy').includes('unsafe-inline'),false);
 assert.ok((await portal.text()).includes('src="/portal-client.mjs"'));
 assert.equal(portalClient().status,200);
});
test('Google callback consumes flow once and logout revokes copied session',async()=>{
 const start=await startGoogleLogin(new Request('https://nexus.example.invalid/auth/google/start'),env);
 const auth=new URL(start.headers.get('location'));
 const flow=start.headers.get('set-cookie').split(';')[0];
 const request=new Request('https://nexus.example.invalid/auth/google/callback?code=synthetic&state='+auth.searchParams.get('state'),{headers:{cookie:flow}});
 const options={fetcher:async()=>Response.json({id_token:'synthetic'}),verifyToken:async()=>({iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,nonce:auth.searchParams.get('nonce'),sub:'subject',email:'synthetic@example.invalid',email_verified:true})};
 const first=await finishGoogleLogin(request,env,options);
 assert.equal(first.status,303);
 assert.equal((await finishGoogleLogin(request,env,options)).status,401);
 const session=first.headers.getSetCookie().find(c=>c.startsWith('__Host-dig_nexus_session=')).split(';')[0];
 const me=new Request('https://nexus.example.invalid/api/me',{headers:{cookie:session}});
 assert.equal((await sessionIdentity(me,env)).subject,'subject');
 const logout=new Request('https://nexus.example.invalid/auth/logout',{method:'POST',headers:{cookie:session,origin:'https://nexus.example.invalid'}});
 assert.equal((await logoutGoogle(logout,env)).status,303);
 await assert.rejects(()=>sessionIdentity(me,env),/revoked/);
});
