import {sendNewsletter} from './mailersend.mjs';

// No daemon, timer, auto-retry or default-on sending. A caller must explicitly
// enable ALL gates, supply a deliberately limited DB role, and invoke ONE step.
const gated=env=>['DIG_NEWSLETTER_SEND_ENABLED','DIG_NEWSLETTER_MARKETING_READY',
 'DIG_NEWSLETTER_ONE_CLICK_VERIFIED','NEWSLETTER_UNSUBSCRIBE_ENABLED',
 'DIG_NEWSLETTER_DISPATCH_ENABLED'].every(key=>env?.[key]==='true');

export function createNewsletterDispatchDb(client){
 if(typeof client?.query!=='function')throw TypeError('PostgreSQL adapter required');
 return {
  async claim(){
   const r=await client.query('SELECT newsletter_claim_delivery() AS payload');
   return r.rows?.[0]?.payload??null;
  },
  async allowed(claim){
   const r=await client.query('SELECT newsletter_send_preflight($1,$2) AS eligible',
    [claim.campaignId,claim.subscriberId]);
   return r.rows?.[0]?.eligible===true;
  },
  async acknowledge(claim,receipt){
   const r=await client.query('SELECT newsletter_acknowledge_delivery($1,$2,$3) AS confirmed',
    [claim.campaignId,claim.subscriberId,receipt]);
   return r.rows?.[0]?.confirmed===true;
  }
 };
}

export async function dispatchOne(env,{db,fetchImpl}={}){
 if(!gated(env))return {status:'disabled'};
 if(!db?.claim||!db?.allowed||!db?.acknowledge)throw TypeError('Dispatch database required');
 const claim=await db.claim();
 if(!claim)return {status:'idle'};
 // A claimed record is deliberately NEVER put back in queue automatically:
 // an HTTP timeout can mean the provider accepted the email.
 try{
  if(!await db.allowed(claim))return {status:'suppressed'};
  const token=claim.unsubscribeToken;
  if(!/^[0-9a-f]{64}$/.test(token)||!env.PUBLIC_ORIGIN?.startsWith('https://'))
   throw Error('invalid unsubscribe token or public origin');
  const unsubscribeUrl=env.PUBLIC_ORIGIN+'/newsletter/unsubscribe/'+token;
  const result=await sendNewsletter(env,{
   approved:true,consentVerified:true,suppressed:false,
   email:claim.email,subject:claim.subject,text:claim.text,
   html:claim.html,unsubscribeUrl
  },fetchImpl);
  if(!result.accepted||!result.messageId)
   return {status:'uncertain'}; // receipt absent; manual reconciliation
  return await db.acknowledge(claim,result.messageId)?
   {status:'accepted'}:{status:'uncertain'};
 }catch{
  // No PII or provider tokens in errors. A claimed send remains 'sending'
  // for manual provider receipt reconciliation; retries risk duplicates.
  return {status:'uncertain'};
 }
}
