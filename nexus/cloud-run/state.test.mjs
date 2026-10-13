import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresAuthState,createPostgresRateLimiter} from './state.mjs';

const valid='A'.repeat(43);
test('auth store uses opaque hashed IDs, correct expiry and atomic consume semantics',async()=>{
 const entries=new Map(),seen=[];
 const query=async(sql,params)=>{
  seen.push({sql,params});
  if(sql.startsWith('INSERT INTO nexus_runtime_tokens')){
   const [hash,kind,ttl]=params;
   if(entries.has(hash))return {rows:[]};
   entries.set(hash,{kind,ttl,active:true});return {rows:[{token_hash:hash}]};
  }
  if(sql.startsWith('DELETE FROM nexus_runtime_tokens')&&sql.includes("kind='flow'")){
   const [hash]=params;const entry=entries.get(hash);
   if(!entry||!entry.active||entry.kind!=='flow')return {rows:[]};
   entry.active=false;return {rows:[{token_hash:hash}]};
  }
  if(sql.startsWith('SELECT EXISTS')){
   const [hash]=params;return {rows:[{valid:entries.get(hash)?.active===true}]};
  }
  if(sql.startsWith('DELETE FROM nexus_runtime_tokens')){
   const [hash]=params;if(entries.has(hash))entries.get(hash).active=false;
   return {rows:[]};
  }
  throw Error('unexpected SQL');
 };
 const store=createPostgresAuthState({query});
 assert.equal(await store('createFlow',valid,300000),true);
 assert.equal(await store('createFlow',valid,300000),false);
 assert.equal(await store('consumeFlow',valid),true);
 assert.equal(await store('consumeFlow',valid),false);
 assert.equal(await store('createSession',valid,3600000),true);
 assert.equal(await store('checkSession',valid),true);
 assert.equal(await store('revokeSession',valid),true);
 assert.equal(await store('checkSession',valid),false);
 assert.equal(await store('createSession','',3600000),false);
 assert.equal(await store('createSession',valid,3600001),false);
 for(const {params,sql} of seen) {
  assert.doesNotMatch(JSON.stringify(params),new RegExp(valid));
  assert.doesNotMatch(sql,/\$\{/);
  assert.match(params[0],/^[0-9a-f]{64}$/);
 }
 const hashes=seen.filter(x=>x.sql.startsWith('INSERT')).map(x=>x.params[0]);
 assert.notEqual(hashes[0],hashes.at(-1)); // flow and session namespaces differ
});
test('rate limit keys are scoped and hashed, queries are parameterized',async()=>{
 const calls=[];
 const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:[{allowed:calls.length<=2}]};}};
 const first=createPostgresRateLimiter(db,{scope:'registration',limit:5,seconds:60});
 const other=createPostgresRateLimiter(db,{scope:'organizer',limit:20,seconds:60});
 assert.deepEqual(await first.limit({key:'192.0.2.1'}),{success:true});
 assert.deepEqual(await first.limit({key:'192.0.2.1'}),{success:true});
 assert.deepEqual(await other.limit({key:'192.0.2.1'}),{success:false});
 assert.notEqual(calls[0].params[0],calls[2].params[0]);
 assert.equal(calls[0].params[1],60);
 assert.equal(calls[0].params[2],5);
 assert.doesNotMatch(JSON.stringify(calls),/192\.0\.2\.1/);
 assert.deepEqual(await first.limit({key:''}),{success:false});
});
test('Google OAuth and logout work with injected Postgres session state instead of Durable Objects',async()=>{
 const {startGoogleLogin,finishGoogleLogin,sessionIdentity,logoutGoogle}=await import('../api/google-auth.mjs');
 const tokens=new Map();
 const client={query:async(sql,params)=>{
  if(sql.startsWith('INSERT INTO nexus_runtime_tokens')){
   if(tokens.has(params[0]))return {rows:[]};
   tokens.set(params[0],{kind:params[1],live:true});return {rows:[{token_hash:params[0]}]};
  }
  if(sql.startsWith('DELETE FROM nexus_runtime_tokens')&&sql.includes("kind='flow'")){
   const record=tokens.get(params[0]);if(!record?.live)return {rows:[]};
   record.live=false;return {rows:[{token_hash:params[0]}]};
  }
  if(sql.startsWith('SELECT EXISTS')){
   return {rows:[{valid:tokens.get(params[0])?.live===true}]};
  }
  if(sql.startsWith('DELETE FROM nexus_runtime_tokens')){
   const record=tokens.get(params[0]);if(record)record.live=false;return {rows:[]};
  }
  throw Error('unexpected SQL');
 }};
 const env={
  GOOGLE_CLIENT_ID:'synthetic-client',
  GOOGLE_CLIENT_SECRET:'synthetic-test-client-secret',
  GOOGLE_REDIRECT_URI:'https://nexus.example.invalid/auth/google/callback',
  GOOGLE_SESSION_SECRET:'long-synthetic-session-secret-that-exceeds-forty-three-characters',
  authStateStore:createPostgresAuthState(client)
 };
 const start=await startGoogleLogin(new Request('https://nexus.example.invalid/auth/google/start'),env);
 assert.equal(start.status,303);
 const google=new URL(start.headers.get('location'));
 const state=google.searchParams.get('state');
 const flow=start.headers.get('set-cookie').split(';')[0];
 const callback=new Request('https://nexus.example.invalid/auth/google/callback?code=synthetic&state='+state,{headers:{cookie:flow}});
 const opts={
  fetcher:async()=>Response.json({id_token:'synthetic'}),
  verifyToken:async()=>({
   iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,
   nonce:google.searchParams.get('nonce'),sub:'synthetic',email:'synthetic@example.invalid',
   email_verified:true
  })
 };
 const first=await finishGoogleLogin(callback,env,opts);
 assert.equal(first.status,303);
 assert.equal((await finishGoogleLogin(callback,env,opts)).status,401);
 const session=first.headers.getSetCookie().find(x=>x.startsWith('__Host-dig_nexus_session=')).split(';')[0];
 const request=new Request('https://nexus.example.invalid/api/me',{headers:{cookie:session}});
 assert.equal((await sessionIdentity(request,env)).subject,'synthetic');
 const logout=await logoutGoogle(new Request('https://nexus.example.invalid/auth/logout',{method:'POST',headers:{cookie:session,origin:'https://nexus.example.invalid'}}),env);
 assert.equal(logout.status,303);
 await assert.rejects(()=>sessionIdentity(request,env),/revoked/);
});
