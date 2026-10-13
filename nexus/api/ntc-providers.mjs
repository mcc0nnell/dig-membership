const enc=new TextEncoder();
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function randomTicket(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
export async function ticketHash(token){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(token))));}
export function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;}
export async function verifyZeffySignature(raw,signature,secret,now=Date.now()){
 if(typeof raw!=='string'||typeof signature!=='string'||typeof secret!=='string'||!secret.startsWith('whsec_'))return false;
 const parts=signature.split(',').map(x=>x.trim().split('='));
 const t=parts.find(x=>x[0]==='t')?.[1],v1=parts.filter(x=>x[0]==='v1').map(x=>x[1]);
 if(!/^\d{10}$/.test(t||'')||Math.abs(now/1000-Number(t))>300||!v1.length)return false;
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(t+'.'+raw))));
 return v1.some(v=>/^[0-9a-f]{64}$/.test(v)&&safeEqual(mac,v));
}
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export async function fetchZeffyPayment(env,paymentId,fetchImpl=fetch){
 if(!uuid(paymentId)||!env.ZEFFY_API_KEY)throw Error('Zeffy unavailable');
 const r=await fetchImpl('https://api.zeffy.com/api/v1/payments/'+encodeURIComponent(paymentId),{
  headers:{authorization:'Bearer '+env.ZEFFY_API_KEY,accept:'application/json'},redirect:'error'});
 if(!r.ok)throw Error('Zeffy payment lookup unavailable');
 const p=await r.json();
 if(p.id!==paymentId||p.object!=='payment')throw Error('Invalid Zeffy payment');
 return p;
}
export function validateZeffyPayment(p){
 return p?.object==='payment'&&uuid(p.id)&&uuid(p.campaign_id)&&
  p.type==='online'&&['succeeded','pending','failed'].includes(p.status)&&
  p.currency==='usd'&&typeof p.buyer?.email==='string'&&
  typeof p.refund_status==='string'&&p.refund_status.length<80&&
  Array.isArray(p.items)&&p.items.length===1&&uuid(p.items[0].rate_id)&&
  p.items[0].type==='ticket'&&Number.isSafeInteger(p.items[0].amount)&&p.items[0].amount>0&&
  Number.isSafeInteger(p.amount)&&p.amount>=p.items[0].amount;
}
export async function sendTransactionEmail(env,job,fetchImpl=fetch){
 if(env.DIG_TRANSACTIONAL_EMAIL_ENABLED!=='true'&&env.DIG_TRANSACTIONAL_EMAIL_ENABLED!==true)throw Error('Transactional mail disabled');
 if(!env.MAILERSEND_API_TOKEN||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.MAILERSEND_FROM_EMAIL||''))throw Error('MailerSend unavailable');
 if(!job||!['registration','payment'].includes(job.kind)||!job.email||!job.confirmationReference)return {accepted:false};
 if(job.kind==='payment'&&job.ticketPaid!==true)return {accepted:false};
 const subject=job.kind==='payment'?'Your DIG conference payment confirmation':'Your DIG conference registration';
 const message=job.kind==='payment'?`Your payment is recorded for ${job.eventTitle}. Reference: ${job.confirmationReference}. Retrieve your QR credential from your authenticated DIG Nexus account.`:
  `Registration received for ${job.eventTitle}. Reference: ${job.confirmationReference}. Your account shows your latest registration status.`;
 const body={from:{email:env.MAILERSEND_FROM_EMAIL,name:env.MAILERSEND_FROM_NAME||'Deaf in Government'},
  to:[{email:job.email}],subject,text:message,html:`<p>${escape(message)}</p>`,tags:['dig-ntc-transactional']};
 const r=await fetchImpl('https://api.mailersend.com/v1/email',{method:'POST',headers:{authorization:'Bearer '+env.MAILERSEND_API_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});
 const id=r.headers.get('x-message-id');
 if(r.status!==202||!id)return {accepted:false};
 return {accepted:true,messageId:id};
}
