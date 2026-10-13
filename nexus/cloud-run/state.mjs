import {createHash} from 'node:crypto';

const hash=(scope,value)=>createHash('sha256').update(scope+':'+value).digest('hex');
export function createPostgresAuthState(client) {
 if(typeof client?.query!=='function')throw Error('Postgres adapter required');
 return async function authState(action,id,ttl){
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(id))return false;
  if(action==='createFlow'||action==='createSession'){
   if(!Number.isInteger(ttl)||ttl<1||ttl>3600000)return false;
   const kind=action==='createFlow'?'flow':'session';
   const result=await client.query(
    'INSERT INTO nexus_runtime_tokens(token_hash,kind,expires_at) VALUES($1,$2,now()+($3 * interval \'1 millisecond\')) ON CONFLICT DO NOTHING RETURNING token_hash',
    [hash(kind,id),kind,ttl]
   );
   return result.rows?.length===1;
  }
  if(action==='consumeFlow'){
   const result=await client.query(
    "DELETE FROM nexus_runtime_tokens WHERE token_hash=$1 AND kind='flow' AND expires_at>now() RETURNING token_hash",
    [hash('flow',id)]
   );
   return result.rows?.length===1;
  }
  if(action==='checkSession'){
   const result=await client.query(
    "SELECT EXISTS(SELECT 1 FROM nexus_runtime_tokens WHERE token_hash=$1 AND kind='session' AND expires_at>now()) AS valid",
    [hash('session',id)]
   );
   return result.rows?.[0]?.valid===true;
  }
  if(action==='revokeSession'){
   await client.query("DELETE FROM nexus_runtime_tokens WHERE token_hash=$1 AND kind='session'",[hash('session',id)]);
   return true;
  }
  return false;
 };
}

export function createPostgresRateLimiter(client,{scope,limit,seconds}) {
 if(typeof client?.query!=='function'||!scope||!Number.isInteger(limit)||limit<1||
    !Number.isInteger(seconds)||seconds<1)throw Error('invalid rate limiter config');
 return {async limit({key}={}){
  if(typeof key!=='string'||key.length<1||key.length>512)return {success:false};
  const bucket=hash(scope,key);
  const result=await client.query(`
    INSERT INTO nexus_runtime_rate_limits(bucket_hash,request_count,expires_at)
    VALUES($1,1,now()+($2 * interval '1 second'))
    ON CONFLICT(bucket_hash) DO UPDATE SET
      request_count=CASE WHEN nexus_runtime_rate_limits.expires_at<=now() THEN 1
        ELSE LEAST(nexus_runtime_rate_limits.request_count+1,$3::bigint+1) END,
      expires_at=CASE WHEN nexus_runtime_rate_limits.expires_at<=now()
        THEN now()+($2 * interval '1 second') ELSE nexus_runtime_rate_limits.expires_at END
    RETURNING request_count<=$3 AS allowed
  `,[bucket,seconds,limit]);
  return {success:result.rows?.[0]?.allowed===true};
 }};
}
