// Standards-based OIDC JWT verifier. Requires configured trusted issuer, audience,
// and pinned JWKS URL. The caller MUST keep the JWKS URL in a trusted allowlist.
const encoder=new TextEncoder();
const base64url=s=>{
 if(typeof s!=="string"||!/^[A-Za-z0-9_-]+$/.test(s))throw Error("invalid token encoding");
 const b64=s.replace(/-/g,"+").replace(/_/g,"/");
 const binary=atob(b64+"=".repeat((4-b64.length%4)%4));
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
};
const decode=s=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(base64url(s)));
export function createOidcVerifier({issuer,audience,jwksUrl,fetcher=fetch,clock=()=>Math.floor(Date.now()/1000)}) {
 if(typeof issuer!=="string"||!issuer.startsWith("https://")||typeof audience!=="string"||!audience||typeof jwksUrl!=="string"||!jwksUrl.startsWith("https://"))throw Error("invalid OIDC configuration");
 if(new URL(jwksUrl).origin!==new URL(issuer).origin)throw Error("JWKS origin must match trusted issuer");
 return async function verifyIdentity(request) {
  const authorization=request.headers.get("authorization")||"";
  if(!/^Bearer [A-Za-z0-9._-]+$/.test(authorization))throw Error("missing bearer token");
  const token=authorization.slice(7), parts=token.split(".");
  if(parts.length!==3||token.length>8192)throw Error("invalid token");
  const [h,p,s]=parts,header=decode(h),claims=decode(p);
  if(header.alg!=="RS256"||typeof header.kid!=="string"||!header.kid||header.crit||header.jku||header.jwk)throw Error("unsupported JWT header");
  const now=clock();
  if(claims.iss!==issuer||!(claims.aud===audience||(Array.isArray(claims.aud)&&claims.aud.includes(audience)))||typeof claims.exp!=="number"||claims.exp<=now||typeof claims.iat!=="number"||claims.iat>now+60||claims.exp-now>86400||claims.nbf>now+60||claims.email_verified!==true||typeof claims.sub!=="string"||!claims.sub||typeof claims.email!=="string")throw Error("invalid identity claims");
  const response=await fetcher(jwksUrl,{headers:{accept:"application/json"},redirect:"error"});
  if(!response.ok)throw Error("JWKS unavailable");
  const jwks=await response.json();
  const keys=Array.isArray(jwks.keys)?jwks.keys.filter(k=>k.kid===header.kid&&k.kty==="RSA"&&(!k.alg||k.alg==="RS256")&&(!k.use||k.use==="sig")&&typeof k.n==="string"&&typeof k.e==="string"&&!k.d&&!k.p&&!k.q&&!k.dp&&!k.dq&&!k.qi):[];
  if(keys.length!==1)throw Error("ambiguous signing key");
  const key=await crypto.subtle.importKey("jwk",keys[0],{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const ok=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,base64url(s),encoder.encode(h+"."+p));
  if(!ok)throw Error("invalid signature");
  return {verified:true,emailVerified:true,issuer,subject:claims.sub,email:claims.email};
 };
}
