import {EncryptJWT, jwtDecrypt, createRemoteJWKSet, jwtVerify} from 'jose';
import {PORTAL_CLIENT} from './portal-client.mjs';
import {authState} from './auth-state.mjs';

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
 if(!(await authState(env,'createFlow',state,300000)))return new Response('Sign-in unavailable',{status:503});
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
  if(!(await authState(env,'consumeFlow',state)))throw Error('flow already used');
  const tokenResponse=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:env.GOOGLE_REDIRECT_URI,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code_verifier:flow.verifier}),redirect:'error'});
  if(!tokenResponse.ok)throw Error('token exchange failed');
  const data=await tokenResponse.json();
  if(typeof data.id_token!=='string')throw Error('ID token missing');
  const payload=verifyToken?await verifyToken(data.id_token): (await jwtVerify(data.id_token,googleKeys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256'],requiredClaims:['sub','exp','iat']})).payload;
  if(!['https://accounts.google.com','accounts.google.com'].includes(payload.iss)||payload.aud!==env.GOOGLE_CLIENT_ID||payload.nonce!==flow.nonce||payload.email_verified!==true||typeof payload.sub!=='string'||!payload.sub||typeof payload.email!=='string'||!payload.email)throw Error('identity rejected');
  const sid=random();
  if(!(await authState(env,'createSession',sid,3600000)))throw Error('session unavailable');
  const session=await seal({sid,issuer:'https://accounts.google.com',subject:payload.sub,email:payload.email,emailVerified:true},key,'1h');
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
 if(typeof payload.sid!=='string'||!(await authState(env,'checkSession',payload.sid)))throw Error('session revoked');
 if(payload.issuer!=='https://accounts.google.com'||typeof payload.subject!=='string'||!payload.subject||payload.emailVerified!==true||typeof payload.email!=='string')throw Error('invalid session');
 return {verified:true,emailVerified:true,issuer:payload.issuer,subject:payload.subject,email:payload.email};
}
export async function logoutGoogle(request,env){
 const origin=request.headers.get('origin');
 const target=new URL(request.url).origin;
 if(origin!==target)return new Response('Origin not allowed',{status:403,headers:{'cache-control':'no-store'}});
 try {const token=parseCookie(request,cookieName);if(token){const payload=await unseal(token,await secret(env));if(typeof payload.sid==='string')await authState(env,'revokeSession',payload.sid);}}catch{return new Response('Logout unavailable',{status:503,headers:{'cache-control':'no-store'}});}
 return response('/portal',{'set-cookie':clear(cookieName)});
}
export function portalPage(){
 const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Member portal | DIG Nexus</title><link rel="stylesheet" href="/portal.css"></head>
<body><a class="skip-link" href="#main">Skip to content</a>
<header><span class="eyebrow">DEAF IN GOVERNMENT</span><strong>DIG Nexus</strong></header>
<main id="main">
 <div class="intro"><span class="eyebrow">MEMBERSHIP</span><h1>Your DIG membership</h1>
  <p>One place to see your membership status and take the next step.</p></div>
 <section class="panel" aria-labelledby="account-heading">
  <h2 id="account-heading">Your account</h2>
  <p id="member-status" role="status" aria-live="polite" aria-atomic="true">Checking your membership status…</p>
  <p id="sign-in"><a class="action" href="/auth/google/start">Continue with Google</a></p>
  <form id="sign-out" action="/auth/logout" method="post" hidden><button class="secondary" type="submit">Sign out</button></form>
 </section>
 <section id="join-section" class="panel" aria-labelledby="join-heading" hidden>
  <span class="eyebrow">NEXT STEP</span><h2 id="join-heading">Request DIG membership</h2>
  <p>Signing in verifies your identity. This request creates a <strong>pending</strong> member record; DIG must approve membership separately.</p>
  <form id="join-form">
   <label for="display-name">Name for your membership record</label>
   <input id="display-name" name="displayName" autocomplete="name" maxlength="120" required>
   <label class="checkbox"><input type="checkbox" required name="intent"><span>I want to request DIG membership. This does not subscribe me to newsletters or make my profile public.</span></label>
   <button type="submit">Request membership</button>
  </form>
  <p id="join-feedback" role="status" aria-live="polite"></p>
 </section>
 <p class="fine-print">Your directory listing is private by default. Membership approval, dues, and communication preferences are handled separately.</p>
</main><script src="/portal-client.mjs" type="module"></script></body></html>`;
 return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer'}});
}
export function portalClient(){return new Response(PORTAL_CLIENT,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
