// Narrow SQL-function adapter. No attendee/credit card data exposed to client-selected identifiers.
export function createTicketingDb(client){
 if(!client||typeof client.query!=='function')throw new TypeError('PostgreSQL client required');
 const one=async(sql,params,key='value')=>{
  const r=await client.query(sql,params);
  if(r.rows?.[0]?.[key]===undefined)throw Error('invalid ticketing response');
  return r.rows[0][key];
 };
 const who=(slug,identity)=>[slug,identity.issuer,identity.subject];
 return {
  paymentLink:(slug,id)=>one('SELECT nexus_conference_payment_link($1,$2,$3) AS value',who(slug,id)),
  reconcile:(event,payment)=>one('SELECT nexus_conference_zeffy_reconcile($1,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11) AS value',
   [event.id,payment.id,payment.campaign_id,payment.items[0].rate_id,payment.buyer.email,
   payment.items[0].amount,payment.currency,payment.status,payment.type,payment.refund_status,!!payment.dispute]),
  issue:(slug,id,hash)=>one('SELECT nexus_conference_issue_ticket($1,$2,$3,$4) AS value',[...who(slug,id),hash]),
  checkin:(slug,id,hash)=>one('SELECT nexus_conference_checkin($1,$2,$3,$4) AS value',[...who(slug,id),hash]),
  claimMail:()=>one('SELECT nexus_conference_claim_mail() AS value',[]),
  completeMail:(notificationId,accepted,providerId)=>one('SELECT nexus_conference_complete_mail($1::uuid,$2,$3) AS value',[notificationId,accepted,providerId]),
 };
}
