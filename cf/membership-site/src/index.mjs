import {htmlPage, clientJS} from './site.mjs';

const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
const json = (body, status=200) => new Response(JSON.stringify(body), {status,headers:JSON_HEADERS});
const fail = (status=503) => json({ok:false,message: status===422 ? 'Invalid request.' : 'Service unavailable.'},status);
function siteHeaders() {
  return {'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'unsafe-inline'; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://deafingov.org https://www.deafingov.org",
    'permissions-policy':'camera=(),microphone=(),geolocation=()'};
}
function permittedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const own = new URL(request.url).origin;
  if (origin === own) return origin;
  if (!env.PUBLIC_SITE_ORIGIN) return null;
  try {
    const site = new URL(env.PUBLIC_SITE_ORIGIN);
    // Explicit origin only: fail closed if the config contains paths, credentials or HTTP.
    if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.pathname !== '/') return null;
    return origin === site.origin ? origin : null;
  } catch { return null; }
}
function withOrigin(response, origin, request) {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Vary', 'Origin');
  if (origin !== new URL(request.url).origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'content-type');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(response.body, {status: response.status, headers});
}
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function readJson(request) {
  if ((request.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') return null;
  if (Number(request.headers.get('content-length') || 0) > 4096) return null;
  try { const text = await request.text(); if (text.length > 4096) return null; const body=JSON.parse(text); return body && typeof body==='object' && !Array.isArray(body) ? body : null; } catch { return null; }
}
async function validateTurnstile(token, request, env, origin) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY || typeof token !== 'string' || token.length<1 || token.length>2048) return false;
  const body = new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token});
  const ip = request.headers.get('CF-Connecting-IP'); if (ip) body.set('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {method:'POST',body,signal:AbortSignal.timeout(8000)});
  if (!r.ok) return false;
  const checked=await r.json();
  const expectedHost=new URL(origin).hostname;
  return checked.success === true && checked.hostname === expectedHost;
}
let oauthCache = null;
async function sfToken(env) {
  const domain=new URL(env.SF_AUTH_BASE_URL);
  if (domain.protocol !== 'https:' || !env.SF_CLIENT_ID || !env.SF_CLIENT_SECRET) throw new Error('Salesforce not configured');
  if (oauthCache && oauthCache.key===env.SF_CLIENT_ID && oauthCache.until>Date.now()) return oauthCache.token;
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:env.SF_CLIENT_ID,client_secret:env.SF_CLIENT_SECRET});
  const response=await fetch(`${domain.origin}/services/oauth2/token`,{method:'POST',body,redirect:'error',signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error('Salesforce OAuth unavailable');
  const result=await response.json();
  if (typeof result.access_token!=='string') throw new Error('Salesforce OAuth incomplete');
  oauthCache={key:env.SF_CLIENT_ID,token:result.access_token,until:Date.now()+Math.min(Number(result.expires_in)||300,300)*1000-30000};
  return result.access_token;
}
async function sfCall(env,path,body) {
  if (!env.SF_INSTANCE_URL) throw new Error('Salesforce not configured');
  const base=new URL(env.SF_INSTANCE_URL);
  if (base.protocol!=='https:' || !/\.my\.salesforce\.com$/.test(base.hostname)) throw new Error('Salesforce instance URL not permitted');
  const token=await sfToken(env);
  const response=await fetch(`${base.origin}/services/apexrest${path}`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(8000)});
  if (response.status===401) oauthCache=null;
  if (!response.ok) throw new Error('Salesforce API unavailable');
  return response.json();
}
async function handleRequest(request,env,origin) {
  const body=await readJson(request);
  if (!body || typeof body.email!=='string' || body.email.length>80 || !emailPattern.test(body.email.trim()) || typeof body.lastName!=='string' || !body.lastName.trim() || body.lastName.trim().length>80 || (body.firstName && (typeof body.firstName!=='string' || body.firstName.trim().length>40)) || (body.website && body.website.length>0)) return fail(422);
  const verified=await validateTurnstile(body.turnstileToken,request,env,origin);
  if (!verified) return fail(422);
  const result=await sfCall(env,'/v1/magic/request',{email:body.email.trim().toLowerCase(),firstName:(body.firstName||'').trim(),lastName:body.lastName.trim(),purpose:'web-join',redirectPath:'/membership'});
  if (!result || result.ok!==true) throw new Error('Could not request magic link');
  // Preserve anti-enumeration: never return token state or whether the address exists.
  return json({ok:true,message:'Check your email for your verification link.'});
}
async function handleVerify(request,env) {
  const body=await readJson(request);
  if (!body || typeof body.token!=='string' || body.token.length<16 || body.token.length>2048) return fail(422);
  const result=await sfCall(env,'/v1/magic/verify',{token:body.token,purpose:'web-join'});
  if (!result || result.ok!==true) return json({ok:false,message:'Invalid or expired token.'},400);
  // Never forward Salesforce contact ids, email addresses, or admin claims into public responses.
  return json({ok:true,status:typeof result.membershipStatus==='string'?result.membershipStatus.toUpperCase():'NONE',end:result.membershipEnd??null});
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (request.method==='GET' && (url.pathname==='/' || url.pathname==='/membership' || url.pathname==='/magic')) {
      if (!env.TURNSTILE_SITE_KEY) return fail();
      return new Response(htmlPage(env.TURNSTILE_SITE_KEY,url.pathname==='/magic'),{status:200,headers:siteHeaders()});
    }
    if (request.method==='GET' && url.pathname==='/membership.js') {
      return new Response(clientJS,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'public, max-age=600','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
    }
    const isApi = url.pathname==='/api/membership/request' || url.pathname==='/api/membership/verify';
    if (isApi && (request.method==='POST' || request.method==='OPTIONS')) {
      const origin = permittedOrigin(request,env);
      if (!origin) return fail(403);
      if (request.method==='OPTIONS') {
        if (request.headers.get('Access-Control-Request-Method') !== 'POST' ||
            request.headers.get('Access-Control-Request-Headers')?.toLowerCase().replace(/\s/g, '') !== 'content-type') return fail(403);
        return withOrigin(new Response(null,{status:204,headers:{'cache-control':'no-store'}}),origin,request);
      }
      let result;
      try { result=url.pathname.endsWith('/request') ? await handleRequest(request,env,origin) : await handleVerify(request,env); }
      catch {result=fail();}
      return withOrigin(result,origin,request);
    }
    return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
  }
};
