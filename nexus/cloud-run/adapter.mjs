import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {createNeonClient} from '../api/database.mjs';
import {createPostgresAuthState,createPostgresRateLimiter} from './state.mjs';
import nexus from '../api/worker.mjs';

export async function cloudRunEnvironment(config=process.env){
 const env={...config};
 if(config.DATABASE_URL){
  env.pgClient=await createNeonClient(config);
  env.authStateStore=createPostgresAuthState(env.pgClient);
  env.registrationRateLimiter=createPostgresRateLimiter(env.pgClient,{scope:'registration',limit:5,seconds:60});
  env.organizerRateLimiter=createPostgresRateLimiter(env.pgClient,{scope:'organizer',limit:20,seconds:60});
  env.conferenceRateLimiter=createPostgresRateLimiter(env.pgClient,{scope:'conference',limit:10,seconds:60});
 }
 // These gates are explicitly default-off, even with a working database.
 env.ticketingRateLimiter=env.pgClient?createPostgresRateLimiter(env.pgClient,{scope:'ticketing',limit:10,seconds:60}):undefined;
 for(const flag of ['REGISTRATION_ENABLED','MEMBER_ENROLLMENT_ENABLED','ORGANIZER_ENABLED','CONFERENCE_REGISTRATION_ENABLED','NTC_TICKETING_ENABLED','NTC_TICKETS_ENABLED','NTC_CHECKIN_ENABLED','NTC_ZEFFY_WEBHOOK_ENABLED','DIG_TRANSACTIONAL_EMAIL_ENABLED'])
  env[flag]=config[flag]==='true'?'true':'false';
 return env;
}

function tooLarge(req,max){
 const length=req.headers['content-length'];
 return length!=null&&(!/^\d+$/.test(length)||Number(length)>max);
}
async function readBody(req,max){
 const chunks=[];let total=0;
 for await(const chunk of req){
  total+=chunk.length;
  if(total>max){const error=Error('request too large');error.status=413;throw error;}
  chunks.push(chunk);
 }
 return Buffer.concat(chunks);
}

/**
 * Explicit trusted PUBLIC_ORIGIN prevents spoofed Host/Forwarded headers
 * from ever controlling OAuth redirect or SameSite/Origin comparisons.
 */
export function createCloudRunHandler({worker=nexus,env,publicOrigin,bodyLimit=65536,proxyToken}){
 const target=new URL(publicOrigin);
 if(target.origin!==publicOrigin||target.username||target.password||target.pathname!=='/'||target.search||target.hash)
  throw Error('PUBLIC_ORIGIN must be an origin without a path');
 if(proxyToken!==undefined&&!/^[a-f0-9]{64}$/.test(proxyToken))throw Error('Invalid proxy token');
 const expected=proxyToken?Buffer.from(proxyToken):null;
 return async (req,res)=>{
  try{
   if(req.headers.host!==target.host){res.writeHead(421,{'cache-control':'no-store'}).end();return;}
   let clientIp=req.socket.remoteAddress||'unknown';
   if(expected){
    const received=req.headers['x-dig-nexus-proxy-token'];
    const token=typeof received==='string'?Buffer.from(received):Buffer.alloc(0);
    if(token.length!==expected.length||!timingSafeEqual(token,expected)){
     res.writeHead(403,{'cache-control':'no-store'}).end();return;
    }
    const reported=req.headers['x-dig-nexus-client-ip'];
    if(typeof reported!=='string'||!isIP(reported)){
     res.writeHead(400,{'cache-control':'no-store'}).end();return;
    }
    clientIp=reported;
   }
   // Prevent absolute-form / protocol-relative targets from overriding PUBLIC_ORIGIN.
   if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')){
    res.writeHead(400,{'cache-control':'no-store'}).end();return;
   }
   if(tooLarge(req,bodyLimit)){res.writeHead(413,{'cache-control':'no-store'}).end();return;}
   const headers=new Headers();
   for(const [name,value] of Object.entries(req.headers)){
    if(value!==undefined&&name!=='cf-connecting-ip'&&name!=='connection'&&name!=='transfer-encoding'&&name!=='x-forwarded-for'&&name!=='x-forwarded-host'&&name!=='x-forwarded-proto'&&name!=='forwarded'&&name!=='x-real-ip'&&name!=='x-dig-nexus-proxy-token'&&name!=='x-dig-nexus-client-ip')
     headers.set(name,Array.isArray(value)?value.join(', '):value);
   }
   // Use socket address, not user-provided X-Forwarded-For or CF headers.
   // Behind Google's shared front end, deploy Cloud Armor for true client-IP abuse control.
   headers.set('cf-connecting-ip',clientIp);
   const method=req.method||'GET';
   const body=['GET','HEAD'].includes(method)?undefined:await readBody(req,bodyLimit);
   const request=new Request(new URL(req.url||'/',target),{method,headers,body});
   const result=await worker.fetch(request,env);
   const outputHeaders=new Headers(result.headers);
   outputHeaders.delete('transfer-encoding');
   outputHeaders.delete('connection');
   res.statusCode=result.status;
   for(const [name,value] of outputHeaders)
    if(name!=='set-cookie')res.setHeader(name,value);
   const cookies=typeof result.headers.getSetCookie==='function'?result.headers.getSetCookie():[];
   if(cookies.length)res.setHeader('set-cookie',cookies);
   if(method==='HEAD'||!result.body){res.end();return;}
   const bytes=Buffer.from(await result.arrayBuffer());
   res.end(bytes);
  }catch(error){
   // No raw errors, secrets or request bodies in client responses.
   res.writeHead(error.status===413?413:503,{'content-type':'application/json','cache-control':'no-store'});
   res.end(JSON.stringify({error:error.status===413?'payload_too_large':'service_unavailable'}));
  }
 };
}
export function startServer({handler,port=8080,host='0.0.0.0'}){
 return createServer(handler).listen(port,host);
}
