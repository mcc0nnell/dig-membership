import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkinRequest,createCheckinDb} from './checkin-api.mjs';
const origin='https://nexus.example.invalid';
const path='/api/checkin/ntc-2027';
const reference='a'.repeat(32);
const identity={verified:true,emailVerified:true,issuer:'https://accounts.google.com',subject:'staff'};
const env={
 NTC_CHECKIN_ENABLED:true,
 verifyCheckinIdentity:async()=>identity,
 organizerRateLimiter:{limit:async()=>({success:true})},
 checkinDb:{checkin:async(_slug,_,ref)=>({status:'checked_in',alreadyCheckedIn:false,reference:ref})}
};
const request=(body,headers={})=>new Request(origin+path,{method:'POST',
 headers:{origin,'content-type':'application/json','x-dig-nexus-action':'manual-checkin',...headers},
 body:JSON.stringify(body)});
test('new check-in route is separately default-off',async()=>{
 assert.equal((await checkinRequest(request({reference,method:'manual'}),{})).status,503);
});
test('only verified staff with same-origin and intentionally confirmed manual method reaches SQL',async()=>{
 const ok=await checkinRequest(request({reference,method:'manual'}),env);
 assert.equal(ok.status,200);
 for(const [body,headers] of [
  [{reference,method:'qr'},{}],
  [{reference,method:'manual',role:'admin'},{}],
  [{reference:'invalid',method:'manual'},{}],
  [{reference,method:'manual'},{origin:'https://evil.invalid'}],
  [{reference,method:'manual'},{'sec-fetch-site':'cross-site'}],
  [{reference,method:'manual'},{'x-dig-nexus-action':''}]
 ]){
  assert.notEqual((await checkinRequest(request(body,headers),env)).status,200);
 }
 assert.equal((await checkinRequest(request({reference,method:'manual'}),{...env,organizerRateLimiter:null})).status,503);
 assert.equal((await checkinRequest(request({reference,method:'manual'}),{...env,verifyCheckinIdentity:async()=>{throw Error('invalid');}})).status,401);
});
test('backend binds immutable staff identity to parameters, not user-submitted role',async()=>{
 let args;
 const db=createCheckinDb({query:async(sql,params)=>{
  args={sql,params};return {rows:[{result:{status:'checked_in'}}]};
 }});
 await db.checkin('ntc-2027',identity,reference,'manual');
 assert.match(args.sql,/\$1,\$2,\$3,\$4,\$5/);
 assert.deepEqual(args.params,['ntc-2027',identity.issuer,'staff',reference,'manual']);
});
