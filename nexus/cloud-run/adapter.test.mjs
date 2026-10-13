import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {cloudRunEnvironment,createCloudRunHandler} from './adapter.mjs';

async function serve(env,worker){
 let handler;
 const server=createServer((req,res)=>handler(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 handler=createCloudRunHandler({env,worker,publicOrigin:origin});
 return {origin,stop:()=>new Promise(resolve=>server.close(resolve))};
}
test('cloud run env defaults every write gate off',async()=>{
 const env=await cloudRunEnvironment({ORGANIZER_ENABLED:'TRUE',REGISTRATION_ENABLED:'0'});
 assert.equal(env.REGISTRATION_ENABLED,'false');
 assert.equal(env.ORGANIZER_ENABLED,'false');
 assert.equal(env.MEMBER_ENROLLMENT_ENABLED,'false');
 assert.equal(env.CONFERENCE_REGISTRATION_ENABLED,'false');
 assert.equal(env.AUTH_STATE,undefined);
 assert.equal(env.authStateStore,undefined);
});
test('HTTP adapter preserves status, multi-cookie headers and server trust boundary',async()=>{
 let observed;
 const worker={fetch:async(req)=>{
  observed={url:req.url,headers:req.headers,method:req.method,body:await req.text()};
  const headers=new Headers({'cache-control':'no-store','content-type':'text/plain'});
  headers.append('set-cookie','first=a; HttpOnly; Secure');
  headers.append('set-cookie','second=b; HttpOnly; Secure');
  return new Response('ok',{status:201,headers});
 }};
 const srv=await serve({},worker);
 try{
  const res=await fetch(srv.origin+'/api/health',{
   method:'POST',
   headers:{'cf-connecting-ip':'1.2.3.4','x-forwarded-for':'8.8.8.8','content-type':'text/plain'},
   body:'test'
  });
  assert.equal(res.status,201);
  assert.equal(await res.text(),'ok');
  assert.equal(res.headers.getSetCookie().length,2);
  assert.equal(observed.url,srv.origin+'/api/health');
  assert.equal(observed.method,'POST');
  assert.equal(observed.body,'test');
  assert.notEqual(observed.headers.get('cf-connecting-ip'),'1.2.3.4');
  assert.equal(observed.headers.get('x-forwarded-for'),null);
  const invalid=await new Promise((resolve,reject)=>{
   const req=httpRequest(srv.origin+'/',{headers:{host:'attacker.example.invalid'}},response=>{
    response.resume();response.on('end',()=>resolve(response.statusCode));
   });req.on('error',reject);req.end();
  });
  assert.equal(invalid,421);
  const absolute=await new Promise((resolve,reject)=>{
   const req=httpRequest(srv.origin+'/',{path:'//attacker.example.invalid/',headers:{host:new URL(srv.origin).host}},response=>{
    response.resume();response.on('end',()=>resolve(response.statusCode));
   });req.on('error',reject);req.end();
  });
  assert.equal(absolute,400);
  assert.equal((await fetch(srv.origin+'/')).status,201);
 } finally {await srv.stop();}
});
test('real Nexus Cloud Run HTTP service is fail-closed without credentials',async()=>{
 const env=await cloudRunEnvironment({});
 const srv=await serve(env,(await import('../api/worker.mjs')).default);
 try{
  assert.equal((await fetch(srv.origin+'/api/health')).status,200);
  assert.equal((await fetch(srv.origin+'/portal')).status,200);
  assert.equal((await fetch(srv.origin+'/portal.css')).status,200);
  assert.equal((await fetch(srv.origin+'/auth/google/start')).status,503);
  assert.equal((await fetch(srv.origin+'/api/me')).status,503);
  assert.equal((await fetch(srv.origin+'/api/enroll',{method:'POST'})).status,503);
  assert.equal((await fetch(srv.origin+'/api/register',{method:'POST'})).status,503);
 } finally{await srv.stop();}
});
