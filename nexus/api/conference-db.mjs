// Attendee identity is server-verified, never accepted from client JSON.
// All writes use single-statement PostgreSQL functions with event-row locking.
export function createConferenceDb(client){
 if(!client||typeof client.query!=='function')throw new TypeError('database client required');
 const one=async(sql,params,key)=>{
  const result=await client.query(sql,params);
  const value=result.rows?.[0]?.[key];
  if(value===undefined)throw Error('invalid conference database response');
  return value;
 };
 const auth=(slug,identity)=>[slug,identity.issuer,identity.subject];
 return {
  self:(slug,identity)=>one('SELECT nexus_conference_self($1,$2,$3) AS value',auth(slug,identity),'value'),
  register:(slug,identity,displayName)=>one('SELECT nexus_conference_register($1,$2,$3,$4,$5) AS value',
    [...auth(slug,identity),identity.email,displayName],'value'),
  workshop:(slug,identity,sessionSlug,action)=>one('SELECT nexus_conference_workshop($1,$2,$3,$4,$5) AS value',
    [...auth(slug,identity),sessionSlug,action],'value'),
  cancel:(slug,identity)=>one('SELECT nexus_conference_cancel($1,$2,$3) AS value',auth(slug,identity),'value'),
  accommodation:(slug,identity,note,consent)=>one('SELECT nexus_conference_accommodation($1,$2,$3,$4,$5) AS value',
    [...auth(slug,identity),note,consent],'value'),
  coordination:(slug,identity)=>one('SELECT nexus_conference_coordination($1,$2,$3) AS value',auth(slug,identity),'value')
 };
}
