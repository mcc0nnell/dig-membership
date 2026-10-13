export function createMagicDb(client){
 if(typeof client?.query!=='function')throw Error('PostgreSQL required');
 const one=async(q,p)=>{const r=await client.query(q,p);return r.rows?.[0]?.value??null;};
 return {
  issue:(hash,email,event)=>one('SELECT nexus_magic_issue($1,$2,$3) AS value',[hash,email,event]),
  consume:hash=>one('SELECT nexus_magic_consume($1) AS value',[hash]),
  revoke:hash=>one('SELECT nexus_magic_revoke($1) AS value',[hash])
 };
}
