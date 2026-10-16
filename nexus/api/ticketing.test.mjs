import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import vm from 'node:vm';
import worker from './worker.mjs';
import {ticketHash,randomTicket,verifyZeffySignature,validateZeffyPayment,fetchZeffyPayment,sendTransactionEmail} from './ntc-providers.mjs';
import {createTicketingDb} from './ticketing-db.mjs';
import {checkinClient,checkinPage} from './checkin-page.mjs';
const origin='https://nexus.example.invalid',slug='ntc-synthetic';
const identity={verified:true,emailVerified:true,issuer:'https://accounts.google.com',subject:'synthetic',email:'attendee@fixture.invalid'};
const uuid='50000000-0000-4000-8000-000000000005';
const payment={id:uuid,object:'payment',campaign_id:'20000000-0000-4000-8000-000000000002',
 type:'online',status:'succeeded',currency:'usd',refund_status:'none',dispute:null,amount:2550,
 buyer:{email:identity.email},items:[{type:'ticket',rate_id:'30000000-0000-4000-8000-000000000003',amount:2500}]};
const env={NTC_TICKETING_ENABLED:true,NTC_TICKETS_ENABLED:true,NTC_CHECKIN_ENABLED:true,
 verifyTicketingIdentity:async()=>identity,ticketingRateLimiter:{limit:async()=>({success:true})},
 ticketingDb:{paymentLink:async()=>({provider:'zeffy',url:'https://www.zeffy.com/en-US/ticketing/synthetic',amountCents:2500}),
 issue:async()=>({status:'issued'}),checkin:async()=>({status:'checked_in',attendeeName:'Synthetic Attendee'}),
 reconcile:async()=>({status:'paid'})}};
test('check-in page validates its own slug and cannot interpolate hostile HTML',async()=>{
 const html=await checkinPage(slug);
 assert.equal(html.status,200);
 assert.match(await html.text(),/data-event="ntc-synthetic"/);
 const hostile=['"/><img src=x onerror=alert(1)>','NTC-synthetic','a'.repeat(81),'a-'.repeat(10000)+'!'];
 for(const value of hostile){
  const page=checkinPage(value);
  assert.equal(page.status,404);
  assert.doesNotMatch(await page.text(),/<img|onerror/);
 }
 const invalid=await worker.fetch(new Request(origin+'/checkin/%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E'));
 assert.equal(invalid.status,404);
});
test('high entropy ticket is opaque and securely hashable',async()=>{
 const a=randomTicket(),b=randomTicket();assert.match(a,/^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(a,b);assert.match(await ticketHash(a),/^[a-f0-9]{64}$/);
 assert.notEqual(await ticketHash(a),await ticketHash(b));
});
test('Zeffy HMAC validates raw signed body and a bounded timestamp',async()=>{
 const body='{"id":"evt_test","type":"payment.completed"}';const secret='whsec_synthetic_secret';
 const timestamp=1750000000,mac=createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
 const signature='t='+timestamp+',v1='+mac;
 assert.equal(await verifyZeffySignature(body,signature,secret,timestamp*1000),true);
 assert.equal(await verifyZeffySignature(body+' ',signature,secret,timestamp*1000),false);
 assert.equal(await verifyZeffySignature(body,signature,secret,(timestamp+301)*1000),false);
 assert.equal(await verifyZeffySignature(body,signature,'whsec_wrong_secret',timestamp*1000),false);
});
test('Zeffy payment API checks trusted endpoint, online ticket line and amount',async()=>{
 assert.equal(validateZeffyPayment(payment),true);
 assert.equal(validateZeffyPayment({...payment,type:'manual'}),false);
 assert.equal(validateZeffyPayment({...payment,items:[{...payment.items[0],type:'donation'}]}),false);
 assert.equal(validateZeffyPayment({...payment,amount:100}),false);
 let url,auth;
 const fetched=await fetchZeffyPayment({ZEFFY_API_KEY:'synthetic'},uuid,async(u,opt)=>{
  url=u;auth=opt.headers.authorization;return new Response(JSON.stringify(payment),{status:200});});
 assert.equal(fetched.id,uuid);assert.equal(url,'https://api.zeffy.com/api/v1/payments/'+uuid);assert.equal(auth,'Bearer synthetic');
});
test('payment link is identity-scoped and ticketing disabled by default',async()=>{
 const url=origin+'/api/ticketing/'+slug+'/payment-link';
 assert.equal((await worker.fetch(new Request(url))).status,503);
 const r=await worker.fetch(new Request(url),env);assert.equal(r.status,200);
 assert.equal((await r.json()).payment.provider,'zeffy');
 const denied={...env,verifyTicketingIdentity:async()=>{throw Error('revoked');}};
 assert.equal((await worker.fetch(new Request(url),denied)).status,401);
});
test('ticket issuance returns a valid PNG QR and check-in requires same-origin verified staff identity',async()=>{
 const issue=new Request(origin+'/api/ticketing/'+slug+'/issue',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
 const r=await worker.fetch(issue,env);assert.equal(r.status,200);
 const qr=await r.json();assert.equal(qr.token.length,43);assert.match(qr.qrDataUrl,/^data:image\/png;base64,/);
 const hostile=new Request(origin+'/api/ticketing/'+slug+'/checkin',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:JSON.stringify({token:qr.token})});
 assert.equal((await worker.fetch(hostile,env)).status,403);
 const legit=new Request(origin+'/api/ticketing/'+slug+'/checkin',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:qr.token})});
 const scanned=await worker.fetch(legit,env);assert.equal(scanned.status,200);
 assert.equal((await scanned.json()).checkin.status,'checked_in');
});
test('signed-in purchaser may recover a verified Zeffy payment, mismatched email denied',async()=>{
 const api=origin+'/api/ticketing/'+slug+'/recover';
 const good=()=>new Request(api,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({paymentId:uuid})});
 let captured=null;
 const config={...env,ZEFFY_API_KEY:'synthetic',zeffyFetch:async()=>new Response(JSON.stringify(payment),{status:200}),
  ticketingDb:{...env.ticketingDb,recover:async(event,user,p)=>{captured={event,user,p};return {status:'paid'};}}};
 const ok=await worker.fetch(good(),config);
 assert.equal(ok.status,200);assert.equal((await ok.json()).payment.status,'paid');
 assert.equal(captured.user.email,identity.email);
 const mismatch={...config,zeffyFetch:async()=>new Response(JSON.stringify({...payment,buyer:{email:'different@example.invalid'}}),{status:200})};
 assert.equal((await worker.fetch(good(),mismatch)).status,409);
 assert.equal((await worker.fetch(good(),{...config,zeffyFetch:async()=>new Response(JSON.stringify({...payment,status:'pending'}),{status:200})})).status,422);
 const invalid=new Request(api,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({paymentId:'injected'})});
 assert.equal((await worker.fetch(invalid,config)).status,400);
});
test('Zeffy webhook fails closed for unsigned payloads and re-fetches signed payment independently',async()=>{
 const event={id:'event-test-123456789',type:'payment.completed',data:{id:uuid}};
 const body=JSON.stringify(event),secret='whsec_synthetic_test',t=Math.floor(Date.now()/1000);
 const signature='t='+t+',v1='+createHmac('sha256',secret).update(t+'.'+body).digest('hex');
 const url=origin+'/api/zeffy/webhook';
 const setup={...env,NTC_ZEFFY_WEBHOOK_ENABLED:true,ZEFFY_WEBHOOK_SECRET:secret,ZEFFY_API_KEY:'synthetic',
  zeffyFetch:async()=>new Response(JSON.stringify(payment),{status:200})};
 assert.equal((await worker.fetch(new Request(url,{method:'POST',body,headers:{'content-type':'application/json'}}),setup)).status,401);
 const signed=()=>new Request(url,{method:'POST',body,headers:{'content-type':'application/json','zeffy-signature':signature}});
 const r=await worker.fetch(signed(),setup);assert.equal(r.status,200);assert.equal((await r.json()).status,'paid');
 const offline={...setup,zeffyFetch:async()=>new Response(JSON.stringify({...payment,type:'manual'}),{status:200})};
 assert.equal((await worker.fetch(signed(),offline)).status,422);
});
test('verified but unmatched webhook payment is acknowledged for manual review without admission',async()=>{
 const event={id:'event-unmatched-1234',type:'payment.completed',data:{id:uuid}};
 const body=JSON.stringify(event),secret='whsec_synthetic_test',t=Math.floor(Date.now()/1000);
 const signature='t='+t+',v1='+createHmac('sha256',secret).update(t+'.'+body).digest('hex');
 let held=null;
 const notFound=Object.assign(new Error('not found'),{code:'P0002'});
 const config={...env,NTC_ZEFFY_WEBHOOK_ENABLED:true,ZEFFY_WEBHOOK_SECRET:secret,ZEFFY_API_KEY:'synthetic',
  zeffyFetch:async()=>new Response(JSON.stringify(payment),{status:200}),
  ticketingDb:{...env.ticketingDb,reconcile:async()=>{throw notFound;},review:async(p)=>{held=p;return {status:'manual_review'};}}};
 const r=await worker.fetch(new Request(origin+'/api/zeffy/webhook',{method:'POST',body,
  headers:{'content-type':'application/json','zeffy-signature':signature}}),config);
 assert.equal(r.status,200);assert.equal((await r.json()).status,'manual_review');assert.equal(held.id,uuid);
});
test('ticket DB query bindings never accept client-selected identifiers',async()=>{
 const queries=[];const db=createTicketingDb({query:async(sql,parameters)=>{
  queries.push({sql,parameters});return {rows:[{value:{status:'ok'}}]};}});
 await db.paymentLink(slug,identity);await db.issue(slug,identity,'a'.repeat(64));await db.checkin(slug,identity,'a'.repeat(64));
 await db.reconcile({id:'event-synthetic'},payment);
 assert.equal(queries.length,4);
 assert.deepEqual(queries[1].parameters.slice(0,3),[slug,identity.issuer,identity.subject]);
 assert.equal(queries[3].parameters[5],2500);
});
test('MailerSend transactional email separate from newsletter and disabled unless enabled',async()=>{
 const job={kind:'registration',email:'attendee@fixture.invalid',eventTitle:'Synthetic NTC',confirmationReference:'safe-reference'};
 await assert.rejects(sendTransactionEmail({},job));
 let data;const result=await sendTransactionEmail({DIG_TRANSACTIONAL_EMAIL_ENABLED:'true',MAILERSEND_API_TOKEN:'synthetic',MAILERSEND_FROM_EMAIL:'events@example.invalid'},job,
 async(_url,opts)=>{data=JSON.parse(opts.body);return new Response(null,{status:202,headers:{'x-message-id':'synthetic-message'}});});
 assert.equal(result.accepted,true);assert.deepEqual(data.tags,['dig-ntc-transactional']);
 assert.equal(data.text.includes('safe-reference'),true);assert.equal('unsubscribeUrl' in data,false);
 assert.deepEqual(await sendTransactionEmail({DIG_TRANSACTIONAL_EMAIL_ENABLED:'true',MAILERSEND_API_TOKEN:'x',MAILERSEND_FROM_EMAIL:'events@example.invalid'},{...job,kind:'payment',ticketPaid:false},async()=>{throw Error('must not send');}),{accepted:false});
});
test('check-in page is accessible and browser code has no untrusted HTML interpolation',async()=>{
 const page=await checkinPage('ntc-synthetic').text();assert.match(page,/QR credential/);
 const script=await checkinClient().text();assert.doesNotThrow(()=>new vm.Script(script));
 assert.doesNotMatch(script,/innerHTML|document\.write|insertAdjacentHTML/);
});
