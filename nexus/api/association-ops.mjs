import {sessionIdentity} from './google-auth.mjs';
import {createNeonClient} from './database.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response=(data,status=200)=>Response.json(data,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const enabled=(env,key)=>env[key]===true||env[key]==='true';
const validIdentity=id=>id?.verified===true&&id?.emailVerified===true&&
 typeof id.issuer==='string'&&id.issuer.length>=8&&id.issuer.length<=512&&
 typeof id.subject==='string'&&id.subject.length>=1&&id.subject.length<=512;

export function createAssociationOpsDb(client){
 if(typeof client?.query!=='function')throw TypeError('Postgres query adapter required');
 async function call(sql,params){
  const r=await client.query(sql,params);
  if(!r.rows?.[0]||!Object.hasOwn(r.rows[0],'value'))throw Error('unexpected database result');
  return r.rows[0].value;
 }
 return {
  member:(id,subject,target)=>call('SELECT nexus_constituent_summary($1,$2,$3) AS value',[id.issuer,id.subject,target]),
  activity:(id,subject,target,action,summary)=>call('SELECT nexus_constituent_record_activity($1,$2,$3,$4,$5) AS value',
   [id.issuer,id.subject,target,action,summary]),
  campaign:(id,subject,target)=>call('SELECT newsletter_campaign_preview($1,$2,$3) AS value',
   [id.issuer,id.subject,target]),
  queue:(id,subject,target)=>call('SELECT newsletter_campaign_queue($1,$2,$3) AS value',
   [id.issuer,id.subject,target])
 };
}

export async function associationOpsRequest(req,env={},pathname=new URL(req.url).pathname){
 const member=pathname.match(/^\/api\/association\/members\/([^/]+)(\/activities)?\/?$/);
 const campaign=pathname.match(/^\/api\/association\/campaigns\/([^/]+)(\/queue)?\/?$/);
 if(!member&&!campaign)return null;
 const match=member||campaign;
 if(!uuid.test(match[1]))return response({error:'not_found'},404);
 const flag=member?'CONSTITUENTS_ENABLED':'CAMPAIGNS_ENABLED';
 if(!enabled(env,flag))return response({error:'not_available'},503);
 const isWrite=Boolean(match[2]);
 if(req.method!==(isWrite?'POST':'GET'))return response({error:'method_not_allowed'},405);
 if(isWrite&&(new URL(req.url).protocol!=='https:'||
  req.headers.get('origin')!==new URL(req.url).origin||
  req.headers.get('x-dig-nexus-action')!==(member?'record-activity':'queue-campaign')||
  (req.headers.has('sec-fetch-site')&&req.headers.get('sec-fetch-site')!=='same-origin')))
  return response({error:'origin_not_allowed'},403);
 let identity;
 try{identity=await (env.verifyAssociationIdentity??((r)=>sessionIdentity(r,env)))(req,env);}
 catch{return response({error:'unauthorized'},401);}
 if(!validIdentity(identity))return response({error:'unauthorized'},401);
 if(!env.organizerRateLimiter||typeof env.organizerRateLimiter.limit!=='function')
  return response({error:'not_available'},503);
 try{if(!(await env.organizerRateLimiter.limit({key:'ops:'+identity.issuer+':'+identity.subject}))?.success)
  return response({error:'rate_limited'},429);}
 catch{return response({error:'not_available'},503);}
 let body;
 if(isWrite&&member){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))
   return response({error:'invalid_content_type'},415);
  if(Number(req.headers.get('content-length')||0)>2048)return response({error:'payload_too_large'},413);
  try{const raw=await req.text();if(raw.length>2048)return response({error:'payload_too_large'},413);body=JSON.parse(raw);}
  catch{return response({error:'invalid_json'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).sort().join(',')!=='action,summary'||
   !['followup','phone','meeting','case_note'].includes(body.action)||
   typeof body.summary!=='string'||body.summary.trim().length<1||body.summary.trim().length>1000)
   return response({error:'invalid_request'},400);
 }
 if(isWrite&&campaign){
  try{if((await req.text()).length>0)return response({error:'invalid_request'},400);}catch{return response({error:'invalid_request'},400);}
 }
 try{
  const db=env.associationOpsDb??createAssociationOpsDb(env.pgClient??await createNeonClient(env));
  const value=member?
   isWrite?await db.activity(identity,identity.subject,match[1],body.action,body.summary.trim()):await db.member(identity,identity.subject,match[1]):
   isWrite?await db.queue(identity,identity.subject,match[1]):await db.campaign(identity,identity.subject,match[1]);
  return response({result:value},value===null?404:200);
 }catch(error){
  const code=error?.code;
  return response({error:code==='42501'?'forbidden':code==='P0002'?'not_found':
   code==='22023'?'invalid_request':'not_available'},
   code==='42501'?403:code==='P0002'?404:code==='22023'?400:503);
 }
}
