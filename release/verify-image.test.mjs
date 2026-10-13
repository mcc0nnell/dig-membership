import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectRelease} from './verify-image.mjs';
const sha='a'.repeat(40),digest='b'.repeat(64);
const reference='ghcr.io/mcc0nnell/dig-nexus:sha-'+sha;
function fake(command,args){
 if(command==='cosign'){
  assert.equal(args[0],'verify');
  assert.equal(args.at(-1),'ghcr.io/mcc0nnell/dig-nexus@sha256:'+digest);
  assert.ok(args.includes('--certificate-identity'));
  assert.ok(args.includes('--certificate-oidc-issuer'));
  return '';
 }
 if(args.includes('{{json .RepoDigests}}'))return JSON.stringify(['ghcr.io/mcc0nnell/dig-nexus@sha256:'+digest]);
 return sha;
}
test('valid image digest, commit label, and independent verified signing identity are required for PASS',()=>{
 assert.deepEqual(inspectRelease(reference,fake),{
  verdict:'PASS',reference:'ghcr.io/mcc0nnell/dig-nexus@sha256:'+digest,sourceRevision:sha
 });
});
test('wrong source identity or tag cannot pass',()=>{
 assert.equal(inspectRelease('ghcr.io/mcc0nnell/dig-nexus:main',fake).verdict,'FAIL');
 assert.equal(inspectRelease(reference,(command,args)=>args.includes('{{json .RepoDigests}}')?JSON.stringify(['ghcr.io/mcc0nnell/dig-nexus@sha256:'+digest]):'c'.repeat(40)).verdict,'FAIL');
});
test('missing signer, evidence, or image is BLOCKED rather than success',()=>{
 assert.equal(inspectRelease(reference,()=>{throw Error('missing');}).verdict,'BLOCKED');
 assert.equal(inspectRelease(reference,(command,args)=>{if(command==='cosign')throw Error('unauthenticated');return fake(command,args);}).verdict,'BLOCKED');
 assert.equal(inspectRelease(reference,(command,args)=>args.includes('{{json .RepoDigests}}')?'[]':sha).verdict,'BLOCKED');
});
