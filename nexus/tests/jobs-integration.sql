-- Synthetic clean-room queue/lease proof, isolated from live DIG member data.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE id1 uuid; token uuid; result record; job_id uuid;
BEGIN
 INSERT INTO nexus_background_jobs(task,dedupe_key) VALUES('runtime_expiry_cleanup','fixture-one') RETURNING id INTO id1;
 IF (SELECT count(*) FROM nexus_background_jobs WHERE task='runtime_expiry_cleanup')<>1
 THEN RAISE EXCEPTION 'queue enqueue mismatch'; END IF;
 WITH claim AS (
  SELECT id FROM nexus_background_jobs
  WHERE state='queued' AND run_at<=now() AND attempts<max_attempts
  ORDER BY run_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
 )
 UPDATE nexus_background_jobs j SET state='running',attempts=j.attempts+1,
  lease_until=now()+interval '90 seconds',lease_token=gen_random_uuid()
 FROM claim WHERE j.id=claim.id RETURNING j.id,j.lease_token INTO job_id,token;
 IF job_id<>id1 OR token IS NULL THEN RAISE EXCEPTION 'claim failed'; END IF;
 -- Stale lease never completes.
 UPDATE nexus_background_jobs SET state='done' WHERE id=id1
  AND lease_token=gen_random_uuid() AND lease_until>now();
 IF FOUND THEN RAISE EXCEPTION 'stale lease acknowledged'; END IF;
 UPDATE nexus_background_jobs SET state='done',lease_until=NULL,lease_token=NULL,finished_at=now()
 WHERE id=id1 AND lease_token=token AND state='running' AND lease_until>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'owner could not acknowledge'; END IF;
 INSERT INTO nexus_runtime_tokens(token_hash,kind,expires_at)
 VALUES(repeat('d',64),'session',now()-interval '1 day');
 WITH gone AS (DELETE FROM nexus_runtime_tokens WHERE expires_at<now()-interval '5 minutes' RETURNING 1)
 SELECT count(*) INTO result FROM gone;
 IF result.count<>1 THEN RAISE EXCEPTION 'expired token cleanup did not run'; END IF;
END $$;
ROLLBACK;
