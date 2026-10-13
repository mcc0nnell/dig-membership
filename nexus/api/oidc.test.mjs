import {test} from "node:test";
import assert from "node:assert/strict";
import {webcrypto,generateKeyPairSync} from "node:crypto";
import {createOidcVerifier} from "./oidc.mjs";
globalThis.crypto??=webcrypto;
const enc=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk=publicKey.export({format:"jwk"});jwk.kid="test-key";jwk.alg="RS256";
const issuer="https://id.example.invalid",audience="dig-nexus";
const fetcher=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200});
const verifier=createOidcVerifier({issuer,audience,jwksUrl:issuer+"/jwks",fetcher});
function token(claims={},header={}) {
 const now=Math.floor(Date.now()/1000);
 const h=enc({alg:"RS256",kid:"test-key",...header});
 const p=enc({iss:issuer,aud:audience,sub:"subject-1",email:"synthetic@example.invalid",email_verified:true,iat:now,exp:now+300,...claims});
 const {sign}=requireSign();
 return h+"."+p+"."+sign(h+"."+p);
}
function requireSign(){return {sign:data=>{const key=privateKey;return nodeSign("RSA-SHA256",Buffer.from(data),key).toString("base64url");}};}
import {sign as nodeSign} from "node:crypto";
const request=t=>new Request("https://nexus.example.invalid/api/register",{headers:{authorization:"Bearer "+t}});
test("accepts a signed verified identity",async()=>{
 const id=await verifier(request(token()));assert.equal(id.verified,true);assert.equal(id.subject,"subject-1");
});
test("rejects unsigned or altered tokens",async()=>{
 const t=token();await assert.rejects(()=>verifier(request(t.slice(0,-2)+"aa")));
});
test("rejects wrong audience, issuer, expired and unverified email",async()=>{
 for(const claims of [{aud:"other"},{iss:"https://evil.invalid"},{exp:1},{email_verified:false}])await assert.rejects(()=>verifier(request(token(claims))));
});
test("rejects unsupported algorithms and remote key headers",async()=>{
 for(const header of [{alg:"none"},{jku:"https://evil.invalid/jwks"}])await assert.rejects(()=>verifier(request(token({},header))));
});
test("rejects mismatched JWKS origin at configuration time",()=>{
 assert.throws(()=>createOidcVerifier({issuer,audience,jwksUrl:"https://other.invalid/jwks"}));
});
