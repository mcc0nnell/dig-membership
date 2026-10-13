export {AuthState} from "./auth-state.mjs";
import {registerMember} from "./registration.mjs";
import {createOidcVerifier} from "./oidc.mjs";
import {createRegistrationDb} from "./registration-db.mjs";
import {createNeonClient} from "./database.mjs";
import {createMemberDb} from "./member-db.mjs";
import {createAgendaDb} from "./agenda-db.mjs";
import {renderAgendaPage} from "./agenda-page.mjs";
import {startGoogleLogin,finishGoogleLogin,sessionIdentity,logoutGoogle,portalPage,portalClient,googleAuthConfigured} from "./google-auth.mjs";
const headers={"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"};
const json=(value,status)=>new Response(JSON.stringify(value),{status,headers});
export default {
 async fetch(request,env={}) {
  const url=new URL(request.url);
  if(url.pathname==='/portal'&&request.method==='GET')return portalPage();
  if(url.pathname==='/portal-client.mjs'&&request.method==='GET')return portalClient();
  if(url.pathname==='/auth/google/start'&&request.method==='GET')return startGoogleLogin(request,env);
  if(url.pathname==='/auth/google/callback'&&request.method==='GET')return finishGoogleLogin(request,env);
  if(url.pathname==='/auth/logout')return request.method==='POST'?await logoutGoogle(request,env):json({error:'method_not_allowed'},405);
  if(request.method==="GET"&&url.pathname==="/api/health")return json({service:"dig-nexus",status:"ok"},200);
  // Public conference projection only: no roster, registration, or accommodation data.
  const agendaJson=url.pathname.match(/^\/api\/events\/([^/]+)\/agenda\/?$/);
  const agendaHtml=url.pathname.match(/^\/events\/([^/]+)\/?$/);
  if(agendaJson||agendaHtml) {
   if(request.method!=="GET")return json({error:"method_not_allowed"},405);
   const slug=(agendaJson||agendaHtml)[1];
   if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80)
    return json({error:"not_found"},404);
   try {
    const db=env.agendaDb||(env.pgClient?createAgendaDb(env.pgClient):env.DATABASE_URL?createAgendaDb(await createNeonClient(env)):null);
    if(!db)return json({error:"agenda_unavailable"},503);
    const agenda=await db.getPublishedAgenda(slug);
    if(!agenda)return json({error:"not_found"},404);
    if(agendaJson)return json({event:agenda},200);
    return new Response(renderAgendaPage(agenda),{status:200,headers:{
     "content-type":"text/html; charset=utf-8","cache-control":"no-store",
     "x-content-type-options":"nosniff","x-frame-options":"DENY",
     "referrer-policy":"no-referrer",
     "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }});
   }catch{return json({error:"agenda_unavailable"},503);}
  }
  if(url.pathname==="/api/me") {
   if(request.method!=="GET")return json({error:"method_not_allowed"},405);
   if(!googleAuthConfigured(env)&&(!env.OIDC_ISSUER||!env.OIDC_AUDIENCE||!env.OIDC_JWKS_URL))return json({error:"authentication_not_configured"},503);
   let identity;
   try {identity=await (env.verifyIdentity||(request.headers.has('authorization')?createOidcVerifier({issuer:env.OIDC_ISSUER,audience:env.OIDC_AUDIENCE,jwksUrl:env.OIDC_JWKS_URL}):req=>sessionIdentity(req,env)))(request);}
   catch{return json({error:"unauthorized"},401);}
   if(!identity?.verified||!identity.emailVerified)return json({error:"unauthorized"},401);
   try {
    const db=env.memberDb||(env.pgClient?createMemberDb(env.pgClient):env.DATABASE_URL?createMemberDb(await createNeonClient(env)):null);
    if(!db)return json({error:"membership_unavailable"},503);
    const member=await db.findByIdentity(identity);
    return member?json({member},200):json({member:null},200);
   }catch{return json({error:"membership_unavailable"},503);}
  }
  if(url.pathname==="/api/register") {
   if(request.method!=="POST")return json({error:"method_not_allowed"},405);
   // Trusted server-side verifier must validate JWT signature, issuer, audience, expiry,
   // email_verified, and provide immutable subject. Never trust incoming identity headers.
   if(env.REGISTRATION_ENABLED!==true && env.REGISTRATION_ENABLED!=="true")return json({error:"registration_unavailable"},503);
   // Browser requests must originate from the configured frontend; never
   // silently accept a browser Origin from an untrusted site.
   const origin=request.headers.get("origin");
   if(!env.REGISTRATION_ALLOWED_ORIGIN || !origin || origin!==env.REGISTRATION_ALLOWED_ORIGIN)
    return json({error:"origin_not_allowed"},403);
   // Edge rate limiting must be configured as a binding before registration.
   if(!env.registrationRateLimiter || typeof env.registrationRateLimiter.limit!=="function")
    return json({error:"registration_unavailable"},503);
   try {
    const ip=request.headers.get("cf-connecting-ip");
    if(!ip || !(await env.registrationRateLimiter.limit({key:ip})).success)
     return json({error:"rate_limited"},429);
   } catch {return json({error:"registration_unavailable"},503);}
   const verifyIdentity=typeof env.verifyIdentity==="function"?env.verifyIdentity:
    env.OIDC_ISSUER&&env.OIDC_AUDIENCE&&env.OIDC_JWKS_URL?
    createOidcVerifier({issuer:env.OIDC_ISSUER,audience:env.OIDC_AUDIENCE,jwksUrl:env.OIDC_JWKS_URL}):null;
   const registrationDb=env.registrationDb||(env.pgClient?createRegistrationDb(env.pgClient):null)||(env.DATABASE_URL?createRegistrationDb(await createNeonClient(env)):null);
   if(!verifyIdentity||!registrationDb)return json({error:"registration_unavailable"},503);
   let identity;
   try {identity=await verifyIdentity(request);} catch {return json({error:"unauthorized"},401);}
   if(!identity?.verified||!identity.emailVerified)return json({error:"unauthorized"},401);
   if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type")||""))return json({error:"invalid_content_type"},415);
   if(Number(request.headers.get("content-length"))>4096)return json({error:"payload_too_large"},413);
   let body;
   try {const raw=await request.text();if(raw.length>4096)return json({error:"payload_too_large"},413);body=JSON.parse(raw);}
   catch{return json({error:"invalid_json"},400);}
   try {const result=await registerMember({identity,body,db:registrationDb});const {status,...payload}=result;return json(payload,status);}
   catch{return json({error:"registration_unavailable"},503);}
  }
  return json({error:"not_found"},404);
 }
};
