import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {createCloudRunHandler} from '../cloud-run/adapter.mjs';
const proxyToken='c'.repeat(64);
async function fixture() {
 let observed;
 const worker={fetch:async request=>{
  observed=request.headers;
  return Response.json({clientIp:request.headers.get('cf-connecting-ip')});
 }};
 let handler;
 const server=createServer((req,res)=>handler(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 handler=createCloudRunHandler({worker,env:{},publicOrigin:origin,proxyToken});
 async function hit(headers={}) {
  return new Promise((resolve,reject)=>{
   const req=httpRequest(origin+'/api/health',{headers},res=>{
    let body='';res.on('data',buf=>body+=buf);
    res.on('end',()=>resolve({status:res.statusCode,body}));
   });
   req.on('error',reject);req.end();
  });
 }
 return {hit,stop:()=>new Promise(resolve=>server.close(resolve)),get observed(){return observed;}};
}
test('reject direct or forged requests when private proxy authentication is required',async()=>{
 const h=await fixture();
 try{
  assert.equal((await h.hit()).status,403);
  assert.equal((await h.hit({'x-dig-nexus-proxy-token':'malicious','x-dig-nexus-client-ip':'192.0.2.200'})).status,403);
  assert.equal((await h.hit({'x-dig-nexus-proxy-token':proxyToken,'x-dig-nexus-client-ip':'not-an-ip'})).status,400);
  assert.equal((await h.hit({'x-dig-nexus-proxy-token':proxyToken,'x-dig-nexus-client-ip':'192.0.2.5'})).status,200);
  assert.equal(h.observed.get('cf-connecting-ip'),'192.0.2.5');
  assert.equal(h.observed.get('x-dig-nexus-proxy-token'),null);
  assert.equal(h.observed.get('x-dig-nexus-client-ip'),null);
 } finally {await h.stop();}
});
