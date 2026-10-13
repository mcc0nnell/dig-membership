import QRCode from 'qrcode';
import {checkinPage,checkinClient} from './checkin-page.mjs';
import {sessionIdentity} from './google-auth.mjs';
import {attendeeIdentity} from './magic-auth.mjs';
import {createNeonClient} from './database.mjs';
import {createTicketingDb} from './ticketing-db.mjs';
import {randomTicket,ticketHash,verifyZeffySignature,fetchZeffyPayment,validateZeffyPayment} from './ntc-providers.mjs';
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const allowed=id=>id?.verified===true&&id.emailVerified===true&&typeof id.issuer==='string'&&id.issuer.length>=8&&typeof id.subject==='string'&&id.subject.length>0;
const slug=s=>typeof s==='string'&&s.length<=80&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
const enabled=(env,key)=>env[key]===true||env[key]==='true';
export async function ticketingRequest(request,env,pathname){
 if(pathname==='/checkin-client.mjs')return request.method==='GET'?checkinClient():json({error:'method_not_allowed'},405);
 const staffShell=pathname.match(/^\/checkin\/([^/]+)\/?$/);
 if(staffShell){if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  if(!slug(staffShell[1]))return json({error:'not_found'},404);
  return checkinPage(staffShell[1]);}

 const hook=pathname==='/api/zeffy/webhook';
 const route=pathname.match(/^\/api\/ticketing\/([^/]+)\/(payment-link|issue|checkin|recover)\/?$/);
 if(!hook&&!route)return null;
 if(request.method!==(hook?'POST':route[2]==='payment-link'?'GET':'POST'))return json({error:'method_not_allowed'},405);
 if(!enabled(env,'NTC_TICKETING_ENABLED'))return json({error:'ticketing_unavailable'},503);
 if(!hook&&!slug(route[1]))return json({error:'not_found'},404);
 let db;
 try {db=env.ticketingDb||(env.pgClient?createTicketingDb(env.pgClient):env.DATABASE_URL?createTicketingDb(await createNeonClient(env)):null);
  if(!db)return json({error:'ticketing_unavailable'},503);
 }catch{return json({error:'ticketing_unavailable'},503);}
 if(hook){
  if(!enabled(env,'NTC_ZEFFY_WEBHOOK_ENABLED')||!env.ZEFFY_WEBHOOK_SECRET||!env.ZEFFY_API_KEY)return json({error:'webhook_unavailable'},503);
  let raw;
  try {raw=await request.text();if(raw.length>65536)return json({error:'payload_too_large'},413);
   if(!await verifyZeffySignature(raw,request.headers.get('zeffy-signature'),env.ZEFFY_WEBHOOK_SECRET))return json({error:'unauthorized'},401);
   const event=JSON.parse(raw);
   if(!event||typeof event.id!=='string'||event.id.length<8||event.id.length>256)return json({error:'invalid_event'},400);
   // Ignore unrelated Zeffy events and never trust webhook customer fields alone.
   if(!['payment.completed','payment.updated'].includes(event.type))return json({acknowledged:true});
   const paymentId=typeof event.data?.id==='string'?event.data.id:null;
   if(!paymentId)return json({error:'invalid_event'},400);
   const payment=await fetchZeffyPayment(env,paymentId,env.zeffyFetch||fetch);
   if(!validateZeffyPayment(payment))return json({error:'payment_needs_review'},422);
   // Only current successfully paid/refunded state is eligible for reconciliation.
   let result;
   try{result=await db.reconcile(event,payment);}
   catch(e){
    if(e?.code!=='P0002'||payment.status!=='succeeded'||payment.refund_status!=='none'||typeof db.review!=='function')throw e;
    result=await db.review(payment);
   }
   if(result.status==='paid'&&typeof db.resolveReview==='function')await db.resolveReview(payment);
   return json({acknowledged:true,status:result.status});
  }catch{return json({error:'webhook_unavailable'},503);}
 }
 let id;
 try{id=await (env.verifyTicketingIdentity??((r)=>route[2]==='checkin'?sessionIdentity(r,env):attendeeIdentity(r,env)))(request,env);}
 catch{return json({error:'unauthorized'},401);}
 if(!allowed(id))return json({error:'unauthorized'},401);
 if(request.method==='POST'&&request.headers.get('origin')!==new URL(request.url).origin)return json({error:'origin_not_allowed'},403);
 if(route[2]==='checkin'&&!enabled(env,'NTC_CHECKIN_ENABLED'))return json({error:'checkin_unavailable'},503);
 if(route[2]==='issue'&&!enabled(env,'NTC_TICKETS_ENABLED'))return json({error:'tickets_unavailable'},503);
 if(route[2]==='payment-link'){
  try{return json({payment:await db.paymentLink(route[1],id)});}
  catch(e){return json({error:e?.code==='42501'?'forbidden':'payment_unavailable'},e?.code==='42501'?403:503);}
 }
 if(!env.ticketingRateLimiter||typeof env.ticketingRateLimiter.limit!=='function')return json({error:'ticketing_unavailable'},503);
 try{if(!(await env.ticketingRateLimiter.limit({key:'ticket:'+route[1]+':'+id.subject}))?.success)return json({error:'rate_limited'},429);}
 catch{return json({error:'ticketing_unavailable'},503);}
 let payload={};
 if(route[2]==='checkin'||route[2]==='recover'){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return json({error:'invalid_content_type'},415);
  try {const raw=await request.text();if(raw.length>512)return json({error:'payload_too_large'},413);payload=JSON.parse(raw);}
  catch{return json({error:'invalid_json'},400);}
  if(route[2]==='checkin'&&(!payload||Object.keys(payload).length!==1||typeof payload.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(payload.token)))return json({error:'invalid_ticket'},400);
  if(route[2]==='recover'&&(!payload||Object.keys(payload).length!==1||typeof payload.paymentId!=='string'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.paymentId)))return json({error:'invalid_payment_id'},400);
 }
 try{
  if(route[2]==='recover'){
   if(!env.ZEFFY_API_KEY)return json({error:'payment_verification_unavailable'},503);
   const payment=await fetchZeffyPayment(env,payload.paymentId,env.zeffyFetch||fetch);
   if(!validateZeffyPayment(payment)||payment.status!=='succeeded'||payment.refund_status!=='none'||payment.dispute)return json({error:'payment_needs_review'},422);
   if(payment.buyer.email.trim().toLowerCase()!==id.email.trim().toLowerCase())return json({error:'buyer_email_mismatch'},409);
   const result=await db.recover(route[1],id,payment);
   if(result.status==='paid'&&typeof db.resolveReview==='function')await db.resolveReview(payment);
   return json({payment:result});
  }
  if(route[2]==='checkin')return json({checkin:await db.checkin(route[1],id,await ticketHash(payload.token))});
  const token=randomTicket();const result=await db.issue(route[1],id,await ticketHash(token));
  const qrDataUrl=await QRCode.toDataURL(token,{type:'image/png',errorCorrectionLevel:'M',margin:2,width:250});
  return json({status:result.status,token,qrDataUrl});
 }catch(e){return json({error:e?.code==='42501'?'forbidden':e?.code==='P0002'?'not_found':'ticketing_unavailable'},e?.code==='42501'?403:e?.code==='P0002'?404:503);}
}
