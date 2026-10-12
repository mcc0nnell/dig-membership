import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
const origin='https://members.deafingov.org';
const env={TURNSTILE_SITE_KEY:'public-site-key',TURNSTILE_SECRET:'secret',SF_CLIENT_ID:'cid',SF_CLIENT_SECRET:'secret',SF_AUTH_BASE_URL:'https://login.salesforce.com',SF_INSTANCE_URL:'https://example.my.salesforce.com'};
const post=(path,obj,headers={})=>new Request(origin+path,{method:'POST',headers:{'origin':origin,'content-type':'application/json',...headers},body:JSON.stringify(obj)});
test('site renders without Laravel and only public site key', async()=>{
  const r=await worker.fetch(new Request(origin+'/membership'),env);
  const text=await r.text();
  assert.equal(r.status,200);
  assert.match(text,/Join Deaf in Government/);
  assert.match(text,/public-site-key/);
  assert.doesNotMatch(text,/SF_CLIENT_SECRET|<form[^>]*action="https:\/\/portal/);
  assert.match(r.headers.get('content-security-policy'),/frame-ancestors/);
});
test('cross-origin or missing challenge rejected before Salesforce',async()=>{
  const fake={...env,TURNSTILE_SECRET:undefined};
  const bad=await worker.fetch(post('/api/membership/request',{email:'e@example.org',lastName:'Member',turnstileToken:'x'},{origin:'https://evil.example'}),env);
  assert.equal(bad.status,403);
  const none=await worker.fetch(post('/api/membership/request',{email:'e@example.org',lastName:'Member',turnstileToken:'x'}),fake);
  assert.equal(none.status,422);
});
test('valid request calls Salesforce magic-link request only after challenge',async()=>{
  const old=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (input,init)=>{
    calls.push([String(input),init]);
    if (String(input).includes('siteverify')) return Response.json({success:true,hostname:'members.deafingov.org'});
    if (String(input).includes('oauth2/token')) return Response.json({access_token:'access-token',expires_in:120});
    if (String(input).includes('/v1/magic/request')) return Response.json({ok:true,throttled:false});
    throw new Error('unexpected URL '+input);
  };
  try {
    const response=await worker.fetch(post('/api/membership/request',{email:'EXAMPLE@EXAMPLE.ORG',firstName:'Example',lastName:'Member',turnstileToken:'challenge'}),env);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,message:'Check your email for your verification link.'});
    const request=calls.find(([path])=>path.includes('/v1/magic/request'));
    assert.ok(request);
    assert.deepEqual(JSON.parse(request[1].body),{email:'example@example.org',firstName:'Example',lastName:'Member',purpose:'web-join',redirectPath:'/membership'});
  } finally {globalThis.fetch=old;}
});
test('verification strips privileged claims and rejects replay response',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async input=>{
    if (String(input).includes('oauth2/token')) return Response.json({access_token:'access-token',expires_in:120});
    if (String(input).includes('/v1/magic/verify')) return Response.json({ok:true,membershipStatus:'ACTIVE',membershipEnd:'2027-10-12T00:00:00.000Z',email:'private@example.org',isPortalAdmin:true,roles:['Portal_Admin'],contactId:'003abc'});
    throw new Error('unexpected');
  };
  try {
    const result=await worker.fetch(post('/api/membership/verify',{token:'very-long-verified-token-123'}),env);
    assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{ok:true,status:'ACTIVE',end:'2027-10-12T00:00:00.000Z'});
  } finally {globalThis.fetch=old;}
});
const wpOrigin = 'https://deafingov.org';
const wpEnv = { ...env, PUBLIC_SITE_ORIGIN: wpOrigin };
const wpPost = (path, obj, from=wpOrigin) => new Request(origin + path, {
  method: 'POST', headers: { Origin: from, 'content-type': 'application/json' }, body: JSON.stringify(obj)
});
test('WordPress origin receives explicit CORS preflight; other origins rejected', async () => {
  const preflight = await worker.fetch(new Request(origin+'/api/membership/request', {
    method:'OPTIONS',headers:{Origin:wpOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}
  }), wpEnv);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), wpOrigin);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'content-type');
  const denied = await worker.fetch(new Request(origin+'/api/membership/verify', {
    method:'OPTIONS',headers:{Origin:'https://evil.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}
  }), wpEnv);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  const wrongConfig = await worker.fetch(new Request(origin+'/api/membership/verify', {
    method:'OPTIONS',headers:{Origin:wpOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}
  }), { ...wpEnv, PUBLIC_SITE_ORIGIN:'http://deafingov.org/unsafe' });
  assert.equal(wrongConfig.status,403);
});
test('WordPress Turnstile hostname must match WordPress, not Worker', async () => {
  const old=globalThis.fetch;
  let salesforceCalls=0;
  globalThis.fetch=async input => {
    if (String(input).includes('siteverify')) return Response.json({ success:true, hostname:'members.deafingov.org' });
    salesforceCalls++;
    throw new Error('Salesforce must not be called');
  };
  try {
    const rejected=await worker.fetch(wpPost('/api/membership/request', {
      email:'test@example.org',lastName:'Member',turnstileToken:'challenge'
    }),wpEnv);
    assert.equal(rejected.status,422);
    assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), wpOrigin);
    assert.equal(salesforceCalls,0);
  } finally {globalThis.fetch=old;}
});
test('WordPress registration calls Salesforce using correct verified hostname', async () => {
  const old=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (input, init) => {
    calls.push(String(input));
    if (String(input).includes('siteverify')) return Response.json({ success:true, hostname:'deafingov.org' });
    if (String(input).includes('oauth2/token')) return Response.json({ access_token:'access-token',expires_in:120 });
    if (String(input).includes('magic/request')) return Response.json({ ok:true });
    throw new Error('Unexpected URL');
  };
  try {
    const result=await worker.fetch(wpPost('/api/membership/request', {
      email:'test@example.org',lastName:'Member',turnstileToken:'challenge'
    }),wpEnv);
    assert.equal(result.status,200);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'),wpOrigin);
    assert.ok(calls.some(call=>call.includes('magic/request')));
  } finally {globalThis.fetch=old;}
});
