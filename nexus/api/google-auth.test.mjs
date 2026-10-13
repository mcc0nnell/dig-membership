import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startGoogleLogin,finishGoogleLogin,sessionIdentity,logoutGoogle} from './google-auth.mjs';
const env={GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_REDIRECT_URI:'https://nexus.example.invalid/auth/google/callback',GOOGLE_SESSION_SECRET:'synthetic-test-secret-that-is-at-least-43-characters-long'};
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
 assert.equal(logoutGoogle().status,303);
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
