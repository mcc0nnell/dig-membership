import {EncryptJWT,jwtDecrypt} from 'jose';
import {authState} from './auth-state.mjs';
import {sessionIdentity} from './google-auth.mjs';
import {createNeonClient} from './database.mjs';
import {createMagicDb} from './magic-db.mjs';
const enc=new TextEncoder();
const issuer='urn:dig:nexus:magic';
const cookieName='__Host-dig_nexus_magic';
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const flag=(env,k)=>env[k]===true||env[k]==='true';
const validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validEvent=s=>typeof s==='string'&&s.length<=80&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
const cookie=(v,age)=>`${cookieName}=${v}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const respond=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...extra}});
async function encryptionKey(env){
 if(typeof env.MAGIC_LINK_SESSION_SECRET!=='string'||env.MAGIC_LINK_SESSION_SECRET.length<43)throw Error('magic secret missing');
 return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(env.MAGIC_LINK_SESSION_SECRET)));
}
const dbFor=async env=>env.magicDb||(env.pgClient?createMagicDb(env.pgClient):env.DATABASE_URL?createMagicDb(await createNeonClient(env)):null);
const parseCookie=req=>(req.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1)||null;
const opaque=/^[A-Za-z0-9_-]{43}$/;

// Only conference attendees can authenticate with this method, never staff/member roles.
export async function attendeeIdentity(req,env){
 try{return await sessionIdentity(req,env);}catch{}
 if(!flag(env,'MAGIC_LINK_ENABLED'))throw Error('email login disabled');
 const sealed=parseCookie(req);
 if(!sealed)throw Error('no email session');
 const payload=(await jwtDecrypt(sealed,await encryptionKey(env))).payload;
 if(payload.issuer!==issuer||payload.emailVerified!==true||!opaque.test(payload.sid||'')||
    !validEmail(payload.email)||typeof payload.subject!=='string'||!payload.subject)throw Error('invalid email session');
 if(!await authState(env,'checkSession',payload.sid))throw Error('revoked email session');
 return {verified:true,emailVerified:true,issuer,subject:payload.subject,email:payload.email};
}

export async function sendMagicEmail(env,{to,token,event,origin},fetchImpl=fetch){
 if(!env.MAILERSEND_API_TOKEN||!validEmail(env.MAILERSEND_FROM_EMAIL))throw Error('mailer unavailable');
 const url=origin+'/auth/magic?event='+encodeURIComponent(event)+'#token='+encodeURIComponent(token);
 const text=`Use this private, single-use DIG Nexus conference sign-in link (valid 15 minutes): ${url}\nIf you did not request it, ignore this message.`;
 const result=await fetchImpl('https://api.mailersend.com/v1/email',{method:'POST',redirect:'error',
  headers:{authorization:'Bearer '+env.MAILERSEND_API_TOKEN,'content-type':'application/json'},
  body:JSON.stringify({from:{email:env.MAILERSEND_FROM_EMAIL,name:'Deaf in Government'},to:[{email:to}],
   subject:'Your DIG Nexus conference sign-in',text,html:`<p><a href="${url}">Complete your conference sign-in</a></p><p>Link expires in 15 minutes. If you did not request it, ignore this email.</p>`,tags:['dig-nexus-magic-link']})});
 if(result.status!==202)throw Error('email not accepted');
}

export async function magicRequest(request,env,pathname){
 if(!['/api/auth/magic/request','/api/auth/magic/redeem','/api/auth/magic/logout'].includes(pathname))return null;
 if(request.method!=='POST')return respond({error:'method_not_allowed'},405);
 if(!flag(env,'MAGIC_LINK_ENABLED'))return respond({error:'magic_disabled'},503);
 if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'origin_not_allowed'},403);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return respond({error:'invalid_content_type'},415);
 let body;
 try{const raw=await request.text();if(raw.length>1024)return respond({error:'payload_too_large'},413);body=JSON.parse(raw);}
 catch{return respond({error:'invalid_json'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body))return respond({error:'invalid_request'},400);
 if(pathname==='/api/auth/magic/logout'){
  if(Object.keys(body).length)return respond({error:'invalid_request'},400);
  try{const sealed=parseCookie(request);if(sealed){const payload=(await jwtDecrypt(sealed,await encryptionKey(env))).payload;
   if(opaque.test(payload.sid||''))await authState(env,'revokeSession',payload.sid);}}
  catch{return respond({error:'logout_unavailable'},503);}
  return respond({signedOut:true},200,{'set-cookie':cookie('',0)});
 }
 if(pathname==='/api/auth/magic/request'){
  if(!flag(env,'MAGIC_LINK_EMAIL_ENABLED'))return respond({error:'delivery_disabled'},503);
  if(Object.keys(body).sort().join(',')!=='email,event'||!validEmail(body.email)||!validEvent(body.event))return respond({error:'invalid_request'},400);
  if(!env.magicRateLimiter||(!env.magicMailer&&!env.MAILERSEND_API_TOKEN))return respond({error:'magic_unavailable'},503);
  const email=body.email.trim().toLowerCase(),emailHash=await hash(email),ip=request.headers.get('cf-connecting-ip');
  if(!ip)return respond({error:'magic_unavailable'},503);
  try{
   const byIp=await env.magicRateLimiter.limit({key:'ip:'+ip});
   const byEmail=await env.magicRateLimiter.limit({key:'email:'+emailHash});
   if(!byIp.success||!byEmail.success)return respond({accepted:true},202);
   const db=await dbFor(env);if(!db)throw Error('database required');
   const token=random(),tokenHash=await hash(token);
   if(await db.issue(tokenHash,email,body.event)!==true)throw Error('magic issuance unavailable');
   try{await (env.magicMailer??(message=>sendMagicEmail(env,message)))({to:email,token,event:body.event,origin:new URL(request.url).origin});}
   catch{await db.revoke(tokenHash);throw Error('delivery failed');}
  }catch{return respond({error:'magic_unavailable'},503);}
  return respond({accepted:true},202);
 }
 if(Object.keys(body).join(',')!=='token'||typeof body.token!=='string'||!opaque.test(body.token))return respond({error:'invalid_request'},400);
 try{
  const db=await dbFor(env);if(!db)throw Error('database required');
  const account=await db.consume(await hash(body.token));
  if(!account||!validEmail(account.email)||!validEvent(account.eventSlug))return respond({error:'expired_or_used'},401);
  const sid=random();if(!await authState(env,'createSession',sid,3600000))throw Error('cannot start session');
  const subject=await hash('dig-nexus:email:v1:'+env.MAGIC_LINK_SESSION_SECRET+':'+account.email);
  const session=await new EncryptJWT({sid,issuer,subject,email:account.email,emailVerified:true})
    .setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuedAt().setExpirationTime('1h').encrypt(await encryptionKey(env));
  return respond({signedIn:true,event:account.eventSlug},200,{'set-cookie':cookie(session,3600)});
 }catch{return respond({error:'expired_or_used'},401);}
}
