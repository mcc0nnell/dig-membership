import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJobQueue,executeNext} from './queue.mjs';
test('queue uses fenced atomic SKIP LOCKED claims and redacted errors',async()=>{
 const calls=[];
 const fake={query:async(sql,params)=>{
  calls.push({sql,params});
  if(sql.includes('INSERT INTO nexus_background_jobs'))return {rows:[{id:'fixture',state:'queued'}]};
  if(sql.includes('UPDATE nexus_background_jobs j'))return {rows:[{id:'fixture',task:'runtime_expiry_cleanup',payload:{},attempts:1,lease_token:'token'}]};
  if(sql.includes("UPDATE nexus_background_jobs SET state='done'"))return {rows:[{id:'fixture'}]};
  if(sql.includes('DELETE FROM nexus_runtime'))return {rows:[{removed:0}]};
  return {rows:[]};
 }};
 const queue=createJobQueue(fake);
 assert.equal((await queue.enqueueExpiryCleanup('hourly-expiry')).state,'queued');
 assert.equal((await executeNext(queue)).kind,'completed');
 assert.equal(calls.filter(c=>/FOR UPDATE SKIP LOCKED/.test(c.sql)).length,1);
 assert.match(calls.find(c=>/lease_token=\$2 AND lease_until>now\(\)/.test(c.sql)).sql,/state='running'/);
 assert.equal(calls.filter(c=>/DELETE FROM nexus_runtime/.test(c.sql)).length,2);
 await assert.rejects(()=>queue.enqueueExpiryCleanup('space invalid'),/invalid/);
 await assert.rejects(()=>queue.cleanupExpired(5),/invalid/);
});
test('unsupported task fails closed, does not execute callback and enters retry',async()=>{
 let cleaned=0,failures=0;
 const queue={
  claim:async()=>({id:'1',lease_token:'token',task:'arbitrary_email',payload:{}}),
  cleanupExpired:async()=>{cleaned++},
  complete:async()=>true,
  fail:async()=>{failures++;return 'queued'}
 };
 assert.deepEqual(await executeNext(queue),{kind:'retry_scheduled'});
 assert.equal(cleaned,0);assert.equal(failures,1);
});
test('no jobs and expired/fenced worker leases are not marked done',async()=>{
 assert.deepEqual(await executeNext({claim:async()=>null}),{kind:'idle'});
 const result=await executeNext({
  claim:async()=>({id:'1',lease_token:'token',task:'runtime_expiry_cleanup',payload:{}}),
  cleanupExpired:async()=>({tokens:1,rateLimits:2}),
  complete:async()=>false
 });
 assert.equal(result.kind,'lease_lost');
});
