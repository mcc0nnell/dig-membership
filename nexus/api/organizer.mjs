import {createOrganizerDb} from './organizer-db.mjs';
import {createNeonClient} from './database.mjs';
import {sessionIdentity} from './google-auth.mjs';
import {organizerPage,organizerClient} from './organizer-page.mjs';
const json=(value,status)=>new Response(JSON.stringify(value),{status,headers:{
 'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'
}});
const allowed={
 save_session:['slug','title','summary','kind','track','room','startsAt','endsAt','capacity'],
 set_session_publication:['slug','published'],
 set_event_publication:['publicationStatus'],
 save_speaker:['id','displayName','bio','publicProfile'],
 set_session_speaker:['sessionSlug','speakerId','linked','role']
};
const text=(v,max)=>typeof v==='string'&&v.length<=max;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const slug=v=>text(v,80)&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const validTime=v=>text(v,40)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&!Number.isNaN(Date.parse(v));
export function validOrganizerAction(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.action!=='string'||!Object.hasOwn(allowed,body.action))return false;
 if(Object.keys(body).some(k=>!['action','data'].includes(k)))return false;
 const d=body.data;
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!allowed[body.action].includes(k)))return false;
 if(body.action==='save_session')return slug(d.slug)&&text(d.title,180)&&d.title.trim().length>0&&
  text(d.summary??'',4000)&&text(d.track??'',100)&&text(d.room??'',100)&&
  ['keynote','workshop','breakout','panel','networking','plenary'].includes(d.kind)&&validTime(d.startsAt)&&validTime(d.endsAt)&&Date.parse(d.startsAt)<Date.parse(d.endsAt)&&
  (d.capacity===null||d.capacity===undefined||(Number.isInteger(d.capacity)&&d.capacity>=1&&d.capacity<=999999));
 if(body.action==='set_session_publication')return slug(d.slug)&&typeof d.published==='boolean';
 if(body.action==='set_event_publication')return ['draft','published'].includes(d.publicationStatus);
 if(body.action==='save_speaker')return uuid(d.id)&&text(d.displayName,120)&&d.displayName.trim().length>0&&text(d.bio??'',4000)&&typeof d.publicProfile==='boolean';
 if(body.action==='set_session_speaker')return slug(d.sessionSlug)&&uuid(d.speakerId)&&typeof d.linked==='boolean'&&['presenter','moderator','facilitator'].includes(d.role);
 return false;
}
export async function organizerRequest(request,env,pathname){
 if(pathname==='/organizer-client.mjs')return request.method==='GET'?organizerClient():json({error:'method_not_allowed'},405);
 const path=pathname.match(/^\/(?:api\/organizer|organizer)\/([^/]+)(\/actions)?\/?$/);
 if(!path)return null;
 const isAPI=pathname.startsWith('/api/');
 const method=request.method;
 if(method!=='GET'&&!(isAPI&&path[2]&&method==='POST'))return json({error:'method_not_allowed'},405);
 if(isAPI&&path[2]&&method==='GET')return json({error:'method_not_allowed'},405);
 if(!isAPI&&path[2])return json({error:'not_found'},404);
 if(!slug(path[1]))return json({error:'not_found'},404);
 if(env.ORGANIZER_ENABLED!==true&&env.ORGANIZER_ENABLED!=='true')return json({error:'organizer_unavailable'},503);
 let identity;
 try {identity=await (env.verifyOrganizerIdentity??((req)=>sessionIdentity(req,env)))(request,env);}
 catch{return json({error:'unauthorized'},401);}
 if(!identity?.verified||!identity?.emailVerified||!text(identity.issuer,512)||!text(identity.subject,512)||!identity.issuer||!identity.subject)
  return json({error:'unauthorized'},401);
 // Cookie-authenticated state changes require exact same-origin checks regardless of SameSite.
 if(method==='POST'&&request.headers.get('origin')!==new URL(request.url).origin)
  return json({error:'origin_not_allowed'},403);
 try {
  const db=env.organizerDb||(env.pgClient?createOrganizerDb(env.pgClient):env.DATABASE_URL?createOrganizerDb(await createNeonClient(env)):null);
  if(!db)return json({error:'organizer_unavailable'},503);
  // Prevent even existence enumeration of drafts by unauthorised verified users.
  const snapshot=await db.snapshot(path[1],identity);
  if(!snapshot)return json({error:'not_found'},404);
  if(method==='GET')return isAPI?json({organizer:snapshot},200):organizerPage(path[1]);
  if(!env.organizerRateLimiter||typeof env.organizerRateLimiter.limit!=='function')return json({error:'organizer_unavailable'},503);
  try {const rate=await env.organizerRateLimiter.limit({key:path[1]+':'+identity.subject});if(!rate?.success)return json({error:'rate_limited'},429);}
  catch{return json({error:'organizer_unavailable'},503);}
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return json({error:'invalid_content_type'},415);
  if(Number(request.headers.get('content-length'))>8192)return json({error:'payload_too_large'},413);
  let body;
  try {const raw=await request.text();if(raw.length>8192)return json({error:'payload_too_large'},413);body=JSON.parse(raw);}
  catch{return json({error:'invalid_json'},400);}
  if(!validOrganizerAction(body))return json({error:'invalid_action'},400);
  // The SQL transaction re-checks staff role and event scope, and writes the audit row.
  try {const result=await db.apply(path[1],identity,body.action,body.data);return json(result,200);}
  catch(e){
   if(e?.code==='42501')return json({error:'forbidden'},403);
   if(e?.code==='22023')return json({error:'invalid_action'},400);
   if(e?.code==='23505')return json({error:'conflict'},409);
   if(e?.code==='P0002')return json({error:'not_found'},404);
   return json({error:'organizer_unavailable'},503);
  }
 }catch{return json({error:'organizer_unavailable'},503);}
}
