import {EncryptJWT, jwtDecrypt, createRemoteJWKSet, jwtVerify} from 'jose';
import {PORTAL_CLIENT} from './portal-client.mjs';

const cookieName='__Host-dig_nexus_session';
const flowCookie='__Host-dig_nexus_oauth';
const encoder=new TextEncoder();
const b64=bytes=>Array.from(bytes,b=>String.fromCharCode(b)).join('');
const url64=bytes=>btoa(b64(bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const random=()=>url64(crypto.getRandomValues(new Uint8Array(32)));
const digest=async value=>url64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const clear=name=>cookie(name,'',0);
const secret=env=>{
 if(typeof env.GOOGLE_SESSION_SECRET!=='string'||env.GOOGLE_SESSION_SECRET.length<43)throw Error('session secret missing');
 const bytes=encoder.encode(env.GOOGLE_SESSION_SECRET);
 if(bytes.length<32)throw Error('session secret too short');
 return crypto.subtle.digest('SHA-256',bytes).then(x=>new Uint8Array(x));
};
const configured=env=>typeof env.GOOGLE_CLIENT_ID==='string'&&env.GOOGLE_CLIENT_ID.length>0&&typeof env.GOOGLE_CLIENT_SECRET==='string'&&env.GOOGLE_CLIENT_SECRET.length>0&&typeof env.GOOGLE_REDIRECT_URI==='string'&&env.GOOGLE_REDIRECT_URI.startsWith('https://')&&typeof env.GOOGLE_SESSION_SECRET==='string';
const originAllowed=(request,env)=>{
 const uri=new URL(env.GOOGLE_REDIRECT_URI);
 return uri.pathname==='/auth/google/callback'&&uri.origin===new URL(request.url).origin;
};
const parseCookie=(request,name)=>{
 const match=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
 return match?.slice(name.length+1)||null;
};
const seal=async(payload,key,expiry)=>new EncryptJWT(payload).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuedAt().setExpirationTime(expiry).encrypt(key);
const unseal=async(value,key)=> (await jwtDecrypt(value,key,{clockTolerance:0})).payload;
const response=(location,headers={})=>new Response(null,{status:303,headers:{location,'cache-control':'no-store',...headers}});
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export const googleAuthConfigured=configured;
export async function startGoogleLogin(request,env){
 if(!configured(env)||!originAllowed(request,env))return new Response('Google sign-in unavailable',{status:503});
 const key=await secret(env),state=random(),verifier=random(),nonce=random();
 const token=await seal({state,verifier,nonce},key,'5m');
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:env.GOOGLE_REDIRECT_URI,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:await digest(verifier),code_challenge_method:'S256',prompt:'select_account'}))url.searchParams.set(k,v);
 return response(url.href,{'set-cookie':cookie(flowCookie,token,300)});
}
export async function finishGoogleLogin(request,env,{fetcher=fetch,verifyToken}={}){
 if(!configured(env)||!originAllowed(request,env))return new Response('Google sign-in unavailable',{status:503});
 const params=new URL(request.url).searchParams;
 const state=params.get('state'),code=params.get('code');
 if(!state||!code||state.length>512||code.length>4096||params.has('error'))return new Response('Invalid sign-in response',{status:400,headers:{'set-cookie':clear(flowCookie)}});
 try {
  const key=await secret(env),flow=await unseal(parseCookie(request,flowCookie),key);
  if(flow.state!==state||typeof flow.verifier!=='string'||typeof flow.nonce!=='string')throw Error('state mismatch');
  const tokenResponse=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:env.GOOGLE_REDIRECT_URI,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code_verifier:flow.verifier}),redirect:'error'});
  if(!tokenResponse.ok)throw Error('token exchange failed');
  const data=await tokenResponse.json();
  if(typeof data.id_token!=='string')throw Error('ID token missing');
  const payload=verifyToken?await verifyToken(data.id_token): (await jwtVerify(data.id_token,googleKeys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256'],requiredClaims:['sub','exp','iat']})).payload;
  if(!['https://accounts.google.com','accounts.google.com'].includes(payload.iss)||payload.aud!==env.GOOGLE_CLIENT_ID||payload.nonce!==flow.nonce||payload.email_verified!==true||typeof payload.sub!=='string'||!payload.sub||typeof payload.email!=='string'||!payload.email)throw Error('identity rejected');
  const session=await seal({issuer:'https://accounts.google.com',subject:payload.sub,email:payload.email,emailVerified:true},key,'1h');
  const headers=new Headers({location:'/portal','cache-control':'no-store'});
  headers.append('set-cookie',cookie(cookieName,session,3600));
  headers.append('set-cookie',clear(flowCookie));
  return new Response(null,{status:303,headers});
 }catch{return new Response('Sign-in failed',{status:401,headers:{'set-cookie':clear(flowCookie),'cache-control':'no-store'}});}
}
export async function sessionIdentity(request,env){
 if(!configured(env))throw Error('auth not configured');
 const value=parseCookie(request,cookieName);
 if(!value)throw Error('no session');
 const payload=await unseal(value,await secret(env));
 if(payload.issuer!=='https://accounts.google.com'||typeof payload.subject!=='string'||!payload.subject||payload.emailVerified!==true||typeof payload.email!=='string')throw Error('invalid session');
 return {verified:true,emailVerified:true,issuer:payload.issuer,subject:payload.subject,email:payload.email};
}
export function logoutGoogle(request){
 const origin=request.headers.get('origin');
 const target=new URL(request.url).origin;
 if(origin!==target)return new Response('Origin not allowed',{status:403,headers:{'cache-control':'no-store'}});
 return response('/portal',{'set-cookie':clear(cookieName)});
}
export function portalPage(){
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIG Member Portal</title><main><h1>DIG Member Portal</h1><p>Google verifies your identity; DIG approves membership separately.</p><p><a href="/auth/google/start">Continue with Google</a></p><section aria-live="polite" aria-atomic="true" id="member-status">Checking your membership status…</section><form action="/auth/logout" method="post"><button type="submit">Sign out</button></form><p>Membership registration is not yet open.</p></main><script src="/portal-client.mjs" type="module"></script></html>`;
 return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}});
}

export function portalClient(){return new Response(PORTAL_CLIENT,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
