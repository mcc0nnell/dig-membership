import {sessionIdentity} from './google-auth.mjs';
import {createNeonClient} from './database.mjs';
import {createRegistrationDb} from './registration-db.mjs';
import {registerMember} from './registration.mjs';

const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(data,status)=>new Response(JSON.stringify(data),{status,headers});

/**
 * Cookie-authenticated *request* for membership, not membership approval.
 * This is deliberately separate from the bearer-token /api/register contract.
 * Explicit same-origin + non-simple request + SameSite cookies guard CSRF.
 */
export async function requestMembership(request,env={}) {
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(env.MEMBER_ENROLLMENT_ENABLED!==true&&env.MEMBER_ENROLLMENT_ENABLED!=='true')
  return reply({error:'enrollment_unavailable'},503);
 const origin=new URL(request.url).origin;
 if(!origin.startsWith('https://')||request.headers.get('origin')!==origin||
   (request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'))
  return reply({error:'origin_not_allowed'},403);
 // A cross-origin form cannot send this custom header without a CORS preflight.
 if(request.headers.get('x-dig-nexus-action')!=='request-membership')
  return reply({error:'missing_action_header'},403);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
  return reply({error:'invalid_content_type'},415);
 const claimedLength=Number(request.headers.get('content-length')||'0');
 if(!Number.isFinite(claimedLength)||claimedLength>4096)
  return reply({error:'payload_too_large'},413);
 if(!env.registrationRateLimiter||typeof env.registrationRateLimiter.limit!=='function')
  return reply({error:'enrollment_unavailable'},503);
 const ip=request.headers.get('cf-connecting-ip');
 if(!ip)return reply({error:'enrollment_unavailable'},503);
 try {
  if(!(await env.registrationRateLimiter.limit({key:ip})).success)
   return reply({error:'rate_limited'},429);
 }catch{return reply({error:'enrollment_unavailable'},503);}
 let identity;
 try {identity=await sessionIdentity(request,env);}
 catch{return reply({error:'unauthorized'},401);}
 let raw;
 try {raw=await request.text();}
 catch{return reply({error:'invalid_json'},400);}
 if(raw.length>4096)return reply({error:'payload_too_large'},413);
 let body;
 try {body=JSON.parse(raw);}
 catch{return reply({error:'invalid_json'},400);}
 // Enrollment is deliberate; never infer consent or approval from signing in.
 if(!body||typeof body!=='object'||Array.isArray(body)||body.requestMembership!==true||
    Object.keys(body).some(k=>k!=='displayName'&&k!=='requestMembership'))
  return reply({error:'invalid_enrollment'},400);
 try {
  const db=env.registrationDb||createRegistrationDb(env.pgClient||await createNeonClient(env));
  const result=await registerMember({identity,body:{displayName:body.displayName},db});
  const {status,...payload}=result;
  return reply(payload,status);
 }catch{return reply({error:'enrollment_unavailable'},503);}
}
