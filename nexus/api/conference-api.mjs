import {createConferenceDb} from './conference-db.mjs';
import {createNeonClient} from './database.mjs';
import {sessionIdentity} from './google-auth.mjs';
import {attendeeIdentity} from './magic-auth.mjs';
import {conferencePage,conferenceClient,coordinationPage,coordinationClient} from './conference-page.mjs';
const json=(value,status)=>new Response(JSON.stringify(value),{status,headers:{
 'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'
}});
const validSlug=slug=>typeof slug==='string'&&slug.length<=80&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
const validIdentity=id=>id?.verified===true&&id?.emailVerified===true&&
 typeof id.issuer==='string'&&id.issuer.length>=8&&id.issuer.length<=512&&
 typeof id.subject==='string'&&id.subject.length>0&&id.subject.length<=512&&
 typeof id.email==='string'&&id.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id.email);
const exactKeys=(body,allowed)=>body&&typeof body==='object'&&!Array.isArray(body)&&
 Object.keys(body).every(k=>allowed.includes(k));
export function validConferenceBody(command,body){
 if(command==='register')return exactKeys(body,['displayName'])&&typeof body.displayName==='string'&&
  body.displayName.trim().length>=1&&body.displayName.trim().length<=120;
 if(command==='workshops')return exactKeys(body,['sessionSlug','action'])&&validSlug(body.sessionSlug)&&
  ['reserve','cancel'].includes(body.action);
 if(command==='accommodations')return exactKeys(body,['request','consent'])&&(
  (body.request===null&&body.consent===undefined)||
  (typeof body.request==='string'&&body.request.trim().length>=1&&body.request.trim().length<=2000&&body.consent===true));
 if(command==='cancel')return exactKeys(body,[])&&Object.keys(body).length===0;
 return false;
}
export async function conferenceRequest(request,env,pathname){
 if(pathname==='/conference-client.mjs')return request.method==='GET'?conferenceClient():json({error:'method_not_allowed'},405);
 if(pathname==='/coordination-client.mjs')return request.method==='GET'?coordinationClient():json({error:'method_not_allowed'},405);
 const coordinationShell=pathname.match(/^\/coordination\/([^/]+)\/?$/);
 if(coordinationShell){if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  return validSlug(coordinationShell[1])?coordinationPage(coordinationShell[1]):json({error:'not_found'},404);}

 const shell=pathname.match(/^\/conference\/([^/]+)\/?$/);
 if(shell){if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  if(!validSlug(shell[1]))return json({error:'not_found'},404);
  return conferencePage(shell[1]);
 }
 const matched=pathname.match(/^\/api\/conference\/([^/]+)\/(me|register|workshops|cancel|accommodations|coordination)\/?$/);
 if(!matched)return null;
 const [,slug,command]=matched;
 if(!validSlug(slug))return json({error:'not_found'},404);
 const expectedMethod=command==='me'||command==='coordination'?'GET':command==='accommodations'?'PUT':'POST';
 if(request.method!==expectedMethod)return json({error:'method_not_allowed'},405);
 if(env.CONFERENCE_REGISTRATION_ENABLED!==true&&env.CONFERENCE_REGISTRATION_ENABLED!=='true')
  return json({error:'conference_unavailable'},503);
 let identity;
 try {identity=await (env.verifyConferenceIdentity??((req)=>command==='coordination'?sessionIdentity(req,env):attendeeIdentity(req,env)))(request,env);}
 catch{return json({error:'unauthorized'},401);}
 if(!validIdentity(identity))return json({error:'unauthorized'},401);
 if(expectedMethod!=='GET'&&request.headers.get('origin')!==new URL(request.url).origin)
  return json({error:'origin_not_allowed'},403);
 let body;
 if(expectedMethod!=='GET'){
  if(!env.conferenceRateLimiter||typeof env.conferenceRateLimiter.limit!=='function')return json({error:'conference_unavailable'},503);
  try {if(!(await env.conferenceRateLimiter.limit({key:slug+':'+identity.subject}))?.success)return json({error:'rate_limited'},429);}
  catch{return json({error:'conference_unavailable'},503);}
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return json({error:'invalid_content_type'},415);
  if(Number(request.headers.get('content-length'))>4096)return json({error:'payload_too_large'},413);
  try {const raw=await request.text();if(raw.length>4096)return json({error:'payload_too_large'},413);body=JSON.parse(raw);}
  catch{return json({error:'invalid_json'},400);}
  if(!validConferenceBody(command,body))return json({error:'invalid_request'},400);
 }
 try {
  const db=env.conferenceDb||(env.pgClient?createConferenceDb(env.pgClient):env.DATABASE_URL?createConferenceDb(await createNeonClient(env)):null);
  if(!db)return json({error:'conference_unavailable'},503);
  let value;
  if(command==='me')value=await db.self(slug,identity);
  if(command==='register')value=await db.register(slug,identity,body.displayName.trim());
  if(command==='workshops')value=await db.workshop(slug,identity,body.sessionSlug,body.action);
  if(command==='cancel')value=await db.cancel(slug,identity);
  if(command==='accommodations')value=await db.accommodation(slug,identity,body.request,body.consent===true);
  if(command==='coordination')value=await db.coordination(slug,identity);
  return json(command==='me'?{enrollment:value}:command==='coordination'?{coordination:value}:{result:value},200);
 }catch(e){
  if(e?.code==='42501')return json({error:'forbidden'},403);
  if(e?.code==='P0002')return json({error:'not_available'},404);
  if(e?.code==='23505')return json({error:'identity_conflict'},409);
  if(e?.code==='22023'||e?.code==='23514')return json({error:'invalid_request'},400);
  return json({error:'conference_unavailable'},503);
 }
}
