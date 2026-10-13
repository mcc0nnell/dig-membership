import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

function fixture(fail=false){
 const dir=mkdtempSync(join(tmpdir(),'dig-nexus-upgrade-'));
 const deploy=join(dir,'deploy'),bin=join(dir,'bin');
 mkdirSync(deploy);mkdirSync(bin);
 copyFileSync('deploy/upgrade.sh',join(deploy,'upgrade.sh'));
 writeFileSync(join(dir,'.env'),'NEXUS_IMAGE=dig-nexus:local\nNEXUS_PUBLIC_ORIGIN=https://nexus.example.org\n');
 const docker=join(bin,'docker');
 writeFileSync(docker,`#!/bin/sh
if [ "$1" = "pull" ]; then exit 0; fi
if [ "$1" = "compose" ]; then
  if [ "${fail?'true':'false'}" = "true" ] && [ ! -f "${dir}/failed_once" ]; then
    touch "${dir}/failed_once"
    exit 1
  fi
  exit 0
fi
exit 2
`);
 chmodSync(docker,0o755);
 const node=join(bin,'node');
 writeFileSync(node,`#!/bin/sh
if [ "$1" != "release/verify-image.mjs" ]; then exit 64; fi
echo "$2" > "${dir}/verified-image"
if [ "${process.env.NEXUS_TEST_VERIFIER_FAIL==='1'?'true':'false'}" = "true" ]; then exit 2; fi
exit 0
`);
 chmodSync(node,0o755);
 return {dir,env:{...process.env,PATH:bin+':'+process.env.PATH},close:()=>rmSync(dir,{recursive:true,force:true})};
}
const release='ghcr.io/mcc0nnell/dig-nexus:sha-'+'a'.repeat(40);
test('operator release changes only image tag after successful health check',()=>{
 const f=fixture();
 try{
  execFileSync('sh',['deploy/upgrade.sh',release],{cwd:f.dir,env:f.env,stdio:'pipe'});
  const contents=readFileSync(join(f.dir,'.env'),'utf8');
  assert.match(contents,new RegExp(release));
  assert.equal(readFileSync(join(f.dir,'verified-image'),'utf8').trim(),release);
  assert.match(contents,/NEXUS_PUBLIC_ORIGIN=https:\/\/nexus\.example\.org/);
 }finally{f.close();}
});
test('failed health check restores previous image and refuses success',()=>{
 const f=fixture(true);
 try{
  assert.throws(()=>execFileSync('sh',['deploy/upgrade.sh',release],{cwd:f.dir,env:f.env,stdio:'pipe'}));
  assert.match(readFileSync(join(f.dir,'.env'),'utf8'),/NEXUS_IMAGE=dig-nexus:local/);
 }finally{f.close();}
});
test('missing release-signature verification preserves previous image',()=>{
 const f=fixture();
 const node=join(f.dir,'bin','node');writeFileSync(node,'#!/bin/sh\nexit 2\n');chmodSync(node,0o755);
 try{
  assert.throws(()=>execFileSync('sh',['deploy/upgrade.sh',release],{cwd:f.dir,env:f.env,stdio:'pipe'}));
  assert.match(readFileSync(join(f.dir,'.env'),'utf8'),/NEXUS_IMAGE=dig-nexus:local/);
 }finally{f.close();}
});
test('floating image tags are rejected',()=>{
 const f=fixture();
 try{
  assert.throws(()=>execFileSync('sh',['deploy/upgrade.sh','ghcr.io/mcc0nnell/dig-nexus:latest'],{cwd:f.dir,env:f.env,stdio:'pipe'}));
  assert.match(readFileSync(join(f.dir,'.env'),'utf8'),/NEXUS_IMAGE=dig-nexus:local/);
 }finally{f.close();}
});
