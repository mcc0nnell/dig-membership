import {createNeonClient} from './database.mjs';
import {hashToken} from '../../newsletter/tokens.mjs';

const responseHeaders={
 'cache-control':'no-store','x-content-type-options':'nosniff',
 'x-frame-options':'DENY','referrer-policy':'no-referrer'
};
const enabled=env=>env.NEWSLETTER_UNSUBSCRIBE_ENABLED===true||env.NEWSLETTER_UNSUBSCRIBE_ENABLED==='true';
export function createUnsubscribeDb(client){
 if(typeof client?.query!=='function')throw TypeError('database adapter required');
 return {
  redeem:async tokenHash=>{
   const r=await client.query('SELECT newsletter_redeem_unsubscribe($1) AS valid',[tokenHash]);
   return r.rows?.[0]?.valid===true;
  }
 };
}
function formPage(){
 return new Response(`<!doctype html><html lang="en"><head>
 <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>Unsubscribe | DIG Nexus</title></head><body style="font:1.1rem/1.6 system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">
 <main><h1>Unsubscribe from DIG newsletters</h1>
 <p>Use the button below to stop newsletter deliveries to the address linked to this private link.</p>
 <form method="post"><input type="hidden" name="confirm" value="1">
 <button type="submit" style="font:inherit;padding:.7rem 1rem">Confirm unsubscribe</button></form>
 </main></body></html>`,{headers:{...responseHeaders,'content-type':'text/html; charset=utf-8',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}
export async function unsubscribeRequest(request,env={},pathname=new URL(request.url).pathname){
 const match=pathname.match(/^\/newsletter\/unsubscribe\/([0-9a-f]{64})\/?$/);
 if(!match)return null;
 if(!enabled(env))return Response.json({error:'unavailable'},{status:503,headers:responseHeaders});
 if(request.method==='GET')return formPage();
 if(request.method!=='POST')return new Response(null,{status:405,headers:{...responseHeaders,allow:'GET, POST'}});
 const mime=request.headers.get('content-type')||'';
 if(!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(mime))
  return new Response('Invalid request',{status:415,headers:{...responseHeaders,'content-type':'text/plain; charset=utf-8'}});
 const len=request.headers.get('content-length');
 if(len!==null&&(!/^\d+$/.test(len)||Number(len)>128))
  return new Response('Request too large',{status:413,headers:responseHeaders});
 let raw;
 try{raw=await request.text();}catch{return new Response('Invalid request',{status:400,headers:responseHeaders});}
 if(raw.length>128||raw!=='List-Unsubscribe=One-Click'&&raw!=='confirm=1')
  return new Response('Invalid request',{status:400,headers:responseHeaders});
 try{
  const hash=await hashToken(match[1]);
  const db=env.unsubscribeDb??createUnsubscribeDb(env.pgClient??await createNeonClient(env));
  await db.redeem(hash); // deliberately generic: do not disclose recipient existence.
  return new Response('Your unsubscribe request has been processed.',{status:200,
   headers:{...responseHeaders,'content-type':'text/plain; charset=utf-8'}});
 }catch{
  return new Response('Unsubscribe temporarily unavailable. Please retry.',{status:503,
   headers:{...responseHeaders,'content-type':'text/plain; charset=utf-8'}});
 }
}
