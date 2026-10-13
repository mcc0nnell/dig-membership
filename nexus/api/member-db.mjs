export function createMemberDb(client) {
 if(!client||typeof client.query!=='function')throw Error('database client required');
 return {async findByIdentity({issuer,subject}) {
  const result=await client.query('SELECT m.id, m.display_name AS "displayName", m.member_status AS "memberStatus" FROM nexus_external_identities i JOIN nexus_members m ON m.id=i.member_id WHERE i.issuer=$1 AND i.subject=$2',[issuer,subject]);
  return result.rows?.[0]??null;
 }};
}
