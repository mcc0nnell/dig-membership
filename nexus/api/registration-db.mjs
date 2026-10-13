// Adapter for a PostgreSQL client exposing query(sql, params), e.g. a pooled
// Hyperdrive-backed client. One database statement executes the entire
// registration function atomically; no multi-request transaction is required.
export function createRegistrationDb(client) {
 if (!client || typeof client.query!=="function") throw new TypeError("PostgreSQL query client required");
 return {
  async registerVerifiedIdentity({issuer,subject,email,displayName}) {
   const result=await client.query(
    "SELECT kind, member_id AS \"memberId\" FROM nexus_register_verified_identity($1,$2,$3,$4)",
    [issuer,subject,email,displayName]
   );
   const row=result.rows?.[0];
   if(!row || !["created","existing","email_conflict"].includes(row.kind))throw Error("invalid registration database response");
   return {kind:row.kind,memberId:row.memberId};
  }
 };
}
