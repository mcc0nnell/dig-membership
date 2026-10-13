import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const repo='ghcr.io/mcc0nnell/dig-nexus';
const identity='https://github.com/mcc0nnell/dig-nexus/.github/workflows/dig-nexus-docker.yml@refs/heads/main';
const issuer='https://token.actions.githubusercontent.com';
const pattern=/^ghcr\.io\/mcc0nnell\/dig-nexus:sha-([a-f0-9]{40})$/;
export function inspectRelease(image,invoke=execFileSync){
 const match=pattern.exec(image||'');
 if(!match)return {verdict:'FAIL',reason:'invalid immutable release reference'};
 const expectedSha=match[1];
 let rev,digests;
 try{
  rev=invoke('docker',['image','inspect','--format','{{index .Config.Labels "org.opencontainers.image.revision"}}',image],{encoding:'utf8',timeout:12000,stdio:['ignore','pipe','pipe']}).trim();
  const raw=invoke('docker',['image','inspect','--format','{{json .RepoDigests}}',image],{encoding:'utf8',timeout:12000,stdio:['ignore','pipe','pipe']});
  digests=JSON.parse(raw);
 }catch{return {verdict:'BLOCKED',reason:'image metadata unavailable'};}
 if(rev!==expectedSha)return {verdict:'FAIL',reason:'source revision label mismatch'};
 const fullRefs=Array.isArray(digests)?digests.filter(x=>typeof x==='string'&&x.startsWith(repo+'@sha256:')):[];
 if(fullRefs.length!==1||!/^ghcr\.io\/mcc0nnell\/dig-nexus@sha256:[a-f0-9]{64}$/.test(fullRefs[0]))
  return {verdict:'BLOCKED',reason:'immutable OCI image digest unavailable'};
 const digestRef=fullRefs[0];
 try{
  invoke('cosign',['verify','--certificate-identity',identity,'--certificate-oidc-issuer',issuer,digestRef],
   {encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
 }catch{return {verdict:'BLOCKED',reason:'independent trusted-signature verification did not pass'};}
 return {verdict:'PASS',reference:digestRef,sourceRevision:expectedSha};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const verdict=inspectRelease(process.argv[2]);
 console.log(JSON.stringify(verdict));
 process.exitCode=verdict.verdict==='PASS'?0:verdict.verdict==='FAIL'?1:2;
}
