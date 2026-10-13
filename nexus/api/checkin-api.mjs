import {sessionIdentity} from './google-auth.mjs';
import {createNeonClient} from './database.mjs';
const answer=(obj,status)=>Response.json(obj,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const valid=(v,re,max)=>typeof v==='string'&&v.length<=max&&re.test(v);
export function createCheckinDb(client){
 if(typeof client?.query!=='function')throw Error('database adapter required');
 return {checkin:async(slug,identity,reference,method)=>{
  const result=await client.query('SELECT nexus_conference_staff_checkin($1,$2,$3,$4,$5) AS result',
   [slug,identity.issuer,identity.subject,reference,method]);
  if(!result.rows?.[0]?.result)throw Error('invalid checkin response');
  return result.rows[0].result;
 }};
}
export async function checkinRequest(request,env={},pathname=new URL(request.url).pathname){
 const match=pathname.match(/^\/api\/checkin\/([^/]+)\/?$/);
 if(!match)return null;
 if(!valid(match[1],/^[a-z0-9]+(?:-[a-z0-9]+)*$/,80))return answer({error:'not_found'},404);
 if(request.method!=='POST')return answer({error:'method_not_allowed'},405);
 if(env.NTC_CHECKIN_ENABLED!==true&&env.NTC_CHECKIN_ENABLED!=='true')
  return answer({error:'checkin_unavailable'},503);
 const origin=new URL(request.url).origin;
 if(!origin.startsWith('https://')||request.headers.get('origin')!==origin||
  (request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin')||
  request.headers.get('x-dig-nexus-action')!=='manual-checkin')
  return answer({error:'origin_not_allowed'},403);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
  return answer({error:'invalid_content_type'},415);
 if(Number(request.headers.get('content-length')||0)>1024)return answer({error:'payload_too_large'},413);
 let identity;
 try{identity=await (env.verifyCheckinIdentity??((r)=>sessionIdentity(r,env)))(request,env);}
 catch{return answer({error:'unauthorized'},401);}
 if(!identity?.verified||!identity?.emailVerified||!valid(identity.issuer,/^.{8,512}$/,512)||
  !valid(identity.subject,/^.{1,512}$/,512))return answer({error:'unauthorized'},401);
 if(!env.organizerRateLimiter||typeof env.organizerRateLimiter.limit!=='function')
  return answer({error:'checkin_unavailable'},503);
 try{
  if(!(await env.organizerRateLimiter.limit({key:match[1]+':'+identity.subject})).success)
   return answer({error:'rate_limited'},429);
 }catch{return answer({error:'checkin_unavailable'},503);}
 let payload;
 try{const raw=await request.text();if(raw.length>1024)return answer({error:'payload_too_large'},413);payload=JSON.parse(raw);}
 catch{return answer({error:'invalid_json'},400);}
 if(!payload||Array.isArray(payload)||typeof payload!=='object'||Object.keys(payload).sort().join(',')!=='method,reference'||
    payload.method!=='manual'||!valid(payload.reference,/^[a-f0-9]{32}$/,32))
  return answer({error:'invalid_request'},400);
 try{
  const db=env.checkinDb??createCheckinDb(env.pgClient??await createNeonClient(env));
  return answer({result:await db.checkin(match[1],identity,payload.reference,'manual')},200);
 }catch(e){
  return answer({error:e?.code==='42501'?'forbidden':e?.code==='P0002'?'not_found':
   e?.code==='22023'?'invalid_request':'checkin_unavailable'},
   e?.code==='42501'?403:e?.code==='P0002'?404:e?.code==='22023'?400:503);
 }
}
