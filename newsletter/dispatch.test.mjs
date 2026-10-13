import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNewsletterDispatchDb,dispatchOne} from './dispatch.mjs';
const env={
 DIG_NEWSLETTER_SEND_ENABLED:'true',DIG_NEWSLETTER_MARKETING_READY:'true',
 DIG_NEWSLETTER_ONE_CLICK_VERIFIED:'true',NEWSLETTER_UNSUBSCRIBE_ENABLED:'true',
 DIG_NEWSLETTER_DISPATCH_ENABLED:'true',
 PUBLIC_ORIGIN:'https://nexus.example.invalid',
 MAILERSEND_API_TOKEN:'synthetic-token',MAILERSEND_FROM_EMAIL:'news@example.invalid'
};
const claim={campaignId:'synthetic-campaign',subscriberId:'synthetic-subscriber',
 email:'reader@example.invalid',subject:'Synthetic',text:'Synthetic body',
 html:'<p>Synthetic body</p>',unsubscribeToken:'b'.repeat(64)};
test('dispatch cannot claim or send until all five launch gates are explicitly true',async()=>{
 let called=0;const db={claim:async()=>{called++;return claim},allowed:async()=>true,acknowledge:async()=>{called++;return true}};
 assert.deepEqual(await dispatchOne({...env,DIG_NEWSLETTER_DISPATCH_ENABLED:'false'},{db}),{status:'disabled'});
 assert.equal(called,0);
});
test('one step claims once, builds provider one-click URL and acknowledges API receipt',async()=>{
 let acknowledged,body;
 const db={claim:async()=>claim,allowed:async()=>true,acknowledge:async(c,id)=>{acknowledged={c,id};return true;}};
 const result=await dispatchOne(env,{db,fetchImpl:async(_url,opt)=>{
  body=JSON.parse(opt.body);
  return {ok:true,headers:{get:name=>name==='x-message-id'?'synthetic-receipt':null}};
 }});
 assert.deepEqual(result,{status:'accepted'});
 assert.equal(body.list_unsubscribe,env.PUBLIC_ORIGIN+'/newsletter/unsubscribe/'+claim.unsubscribeToken);
 assert.equal(acknowledged.id,'synthetic-receipt');
});
test('timeout, error and receipt absence never silently retry or count as delivery',async()=>{
 let sent=0,ack=0;
 const db={claim:async()=>claim,allowed:async()=>true,acknowledge:async()=>{ack++;return true;}};
 assert.deepEqual(await dispatchOne(env,{db,fetchImpl:async()=>{sent++;throw Error('ambiguous timeout')}}),{status:'uncertain'});
 assert.deepEqual(await dispatchOne(env,{db,fetchImpl:async()=>{sent++;return {ok:true,headers:{get:()=>null}};}}),{status:'uncertain'});
 assert.equal(ack,0);assert.equal(sent,2);
});
test('dispatch db binds receipt identifiers and does not inline recipient email',async()=>{
 const calls=[];const db=createNewsletterDispatchDb({query:async(sql,params)=>{
  calls.push({sql,params});return {rows:[{payload:claim,confirmed:true}]};
 }});
 assert.deepEqual(await db.claim(),claim);
 assert.equal(await db.allowed(claim),false);
 assert.equal(await db.acknowledge(claim,'receipt'),true);
 assert.deepEqual(calls[2].params,['synthetic-campaign','synthetic-subscriber','receipt']);
 assert.doesNotMatch(calls[2].sql,/reader@example/);
});

test('consent revoked between claim and provider call blocks the send',async()=>{
 let networkCalls=0,acknowledgements=0;
 const db={claim:async()=>claim,allowed:async()=>false,acknowledge:async()=>{acknowledgements++;return true;}};
 assert.deepEqual(await dispatchOne(env,{db,fetchImpl:async()=>{networkCalls++;throw Error('must not call')}}),{status:'suppressed'});
 assert.equal(networkCalls,0);assert.equal(acknowledgements,0);
});
