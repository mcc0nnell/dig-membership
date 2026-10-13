// Every database read/write goes through identity-scoped SQL functions.
// Identity comes from verified Google session, never from browser JSON.
export function createOrganizerDb(client){
 if(!client||typeof client.query!=='function')throw new TypeError('PostgreSQL query client required');
 return {
  async snapshot(slug,{issuer,subject}){
   const r=await client.query('SELECT nexus_organizer_snapshot($1,$2,$3) AS snapshot',[slug,issuer,subject]);
   return r.rows?.[0]?.snapshot??null;
  },
  async apply(slug,{issuer,subject},action,data){
   const r=await client.query('SELECT nexus_organizer_apply($1,$2,$3,$4,$5::jsonb) AS result',
    [slug,issuer,subject,action,JSON.stringify(data)]);
   if(r.rows?.[0]?.result?.ok!==true)throw Error('invalid organizer database response');
   return r.rows[0].result;
  }
 };
}
