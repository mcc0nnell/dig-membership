import {createRemoteJWKSet, customFetch, jwtVerify} from 'jose';

// Validate an access token from one explicitly configured identity provider.
// Never derive the JWKS location or trusted issuer from the token itself.
export function createOidcVerifier({issuer,audience,jwksUrl,fetcher=fetch,clock=()=>Math.floor(Date.now()/1000)}) {
 if(typeof issuer!=='string'||typeof audience!=='string'||!audience||typeof jwksUrl!=='string')throw Error('invalid OIDC configuration');
 const trustedIssuer=new URL(issuer),keysUrl=new URL(jwksUrl);
 if(trustedIssuer.protocol!=='https:'||keysUrl.protocol!=='https:'||keysUrl.origin!==trustedIssuer.origin||trustedIssuer.username||trustedIssuer.password||keysUrl.username||keysUrl.password||keysUrl.hash)throw Error('invalid OIDC configuration');
 const jwks=createRemoteJWKSet(keysUrl,{[customFetch]:(url,options)=>fetcher(url,{...options,redirect:'error'}),timeoutDuration:5000});
 return async function verifyIdentity(request) {
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer [A-Za-z0-9._-]+$/.test(authorization))throw Error('missing bearer token');
  const token=authorization.slice(7);
  if(token.length>8192)throw Error('invalid token');
  const {payload,protectedHeader}=await jwtVerify(token,jwks,{issuer,audience,algorithms:['RS256'],clockTolerance:60,currentDate:new Date(clock()*1000),requiredClaims:['iat','exp','sub']});
  if(protectedHeader.jku||protectedHeader.jwk||protectedHeader.crit||payload.email_verified!==true||typeof payload.email!=='string'||!payload.email||typeof payload.sub!=='string'||!payload.sub||payload.exp-clock()>86400||payload.iat>clock()+60)throw Error('invalid identity claims');
  return {verified:true,emailVerified:true,issuer,subject:payload.sub,email:payload.email};
 };
}
