import {registerMember} from "./registration.mjs";
const headers={"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"};
const json=(value,status)=>new Response(JSON.stringify(value),{status,headers});
export default {
 async fetch(request,env={}) {
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/api/health")return json({service:"dig-nexus",status:"ok"},200);
  if(url.pathname==="/api/me")return json({error:"authentication_not_configured"},501);
  if(url.pathname==="/api/register") {
   if(request.method!=="POST")return json({error:"method_not_allowed"},405);
   // Trusted server-side verifier must validate JWT signature, issuer, audience, expiry,
   // email_verified, and provide immutable subject. Never trust incoming identity headers.
   if(typeof env.verifyIdentity!=="function"||!env.registrationDb)return json({error:"registration_unavailable"},503);
   let identity;
   try {identity=await env.verifyIdentity(request);} catch {return json({error:"unauthorized"},401);}
   if(!identity?.verified||!identity.emailVerified)return json({error:"unauthorized"},401);
   if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type")||""))return json({error:"invalid_content_type"},415);
   if(Number(request.headers.get("content-length"))>4096)return json({error:"payload_too_large"},413);
   let body;
   try {const raw=await request.text();if(raw.length>4096)return json({error:"payload_too_large"},413);body=JSON.parse(raw);}
   catch{return json({error:"invalid_json"},400);}
   try {const result=await registerMember({identity,body,db:env.registrationDb});const {status,...payload}=result;return json(payload,status);}
   catch{return json({error:"registration_unavailable"},503);}
  }
  return json({error:"not_found"},404);
 }
};
