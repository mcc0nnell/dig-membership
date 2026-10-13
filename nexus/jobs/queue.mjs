// Original, narrowly scoped Postgres-backed work queue. No third-party queue runtime.
// Claiming is one atomic statement; a random lease token fences stale workers.
export function createJobQueue(client){
 if(typeof client?.query!=='function') throw new TypeError('PostgreSQL query adapter required');
 const query=(sql,args=[])=>client.query(sql,args);
 return {
  async enqueueExpiryCleanup(key){
   if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key)) throw Error('invalid dedupe key');
   const result=await query(`
    INSERT INTO nexus_background_jobs(task,dedupe_key)
      VALUES('runtime_expiry_cleanup',$1)
    ON CONFLICT(task,dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
      SET run_at=CASE WHEN nexus_background_jobs.state IN ('done','dead')
        THEN nexus_background_jobs.run_at ELSE LEAST(nexus_background_jobs.run_at,now()) END
    RETURNING id,state`,[key]);
   return result.rows[0];
  },
  async claim(){
   const result=await query(`
    WITH chosen AS (
      SELECT id FROM nexus_background_jobs
      WHERE (state='queued' AND run_at<=now() OR state='running' AND lease_until<=now())
        AND attempts<max_attempts
      ORDER BY run_at,created_at,id
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE nexus_background_jobs j SET state='running',attempts=j.attempts+1,
      lease_until=now()+interval '90 seconds',lease_token=gen_random_uuid()
    FROM chosen WHERE j.id=chosen.id
    RETURNING j.id,j.task,j.payload,j.attempts,j.lease_token`);
   return result.rows[0]??null;
  },
  async complete(job){
   const r=await query(`
    UPDATE nexus_background_jobs SET state='done',lease_until=NULL,lease_token=NULL,
      finished_at=now(),last_error_code=NULL
    WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>now()
    RETURNING id`,[job.id,job.lease_token]);
   return r.rows.length===1;
  },
  async fail(job,code='retryable_failure'){
   if(!/^[a-z0-9_]{1,60}$/.test(code))throw Error('invalid error code');
   const r=await query(`
    UPDATE nexus_background_jobs SET
      state=CASE WHEN attempts>=max_attempts THEN 'dead' ELSE 'queued' END,
      run_at=now()+LEAST(300,power(2,attempts)::integer)*interval '1 second',
      lease_token=NULL,lease_until=NULL,last_error_code=$3,
      finished_at=CASE WHEN attempts>=max_attempts THEN now() ELSE NULL END
    WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>now()
    RETURNING state`,[job.id,job.lease_token,code]);
   return r.rows[0]?.state??null;
  },
  async cleanupExpired(nowGraceSeconds=300){
   if(!Number.isSafeInteger(nowGraceSeconds)||nowGraceSeconds<60||nowGraceSeconds>86400)
    throw Error('invalid retention grace period');
   // These are expired runtime tokens and counters only, never attendee/member data.
   const tokens=await query("WITH gone AS (DELETE FROM nexus_runtime_tokens WHERE expires_at<now()-($1 * interval '1 second') RETURNING 1) SELECT count(*)::integer AS removed FROM gone",[nowGraceSeconds]);
   const limits=await query("WITH gone AS (DELETE FROM nexus_runtime_rate_limits WHERE expires_at<now()-($1 * interval '1 second') RETURNING 1) SELECT count(*)::integer AS removed FROM gone",[nowGraceSeconds]);
   return {tokens:tokens.rows[0].removed,rateLimits:limits.rows[0].removed};
  }
 };
}
export async function executeNext(queue,{onResult}={}){
 const job=await queue.claim();
 if(!job)return {kind:'idle'};
 try{
  if(job.task!=='runtime_expiry_cleanup'||JSON.stringify(job.payload)!=='{}')
   throw Error('unsupported_job');
  const counts=await queue.cleanupExpired();
  if(!await queue.complete(job)) return {kind:'lease_lost'};
  onResult?.({kind:'completed',task:job.task,counts});
  return {kind:'completed',counts};
 }catch{
  const state=await queue.fail(job,'execution_failure');
  return {kind:state==='dead'?'dead':state==='queued'?'retry_scheduled':'lease_lost'};
 }
}
