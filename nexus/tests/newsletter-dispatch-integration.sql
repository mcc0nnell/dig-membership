-- Disposable PostgreSQL 17 only. Proves subscriber consent, suppression,
-- atomic single-claim, one-click token hashes and ambiguous-delivery fencing.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE staff uuid;listid uuid;campaignid uuid;subid uuid;claim jsonb;
 x boolean;hashvalue text;uncertain boolean;
BEGIN
 PERFORM nexus_register_verified_identity('https://id.example.invalid','newsletter-admin',
 'newsletter-admin@example.invalid','Synthetic Newsletter Admin');
 SELECT id INTO staff FROM nexus_members WHERE email_key='newsletter-admin@example.invalid';
 UPDATE nexus_members SET member_status='active' WHERE id=staff;
 INSERT INTO nexus_roles(member_id,role) VALUES(staff,'admin');
 INSERT INTO newsletter_lists(slug,title) VALUES('mailer-proof','Synthetic Mailer Proof') RETURNING id INTO listid;
 INSERT INTO newsletter_subscribers(email,status,source,consent_at)
 VALUES('mailer-synthetic@example.invalid','subscribed','test-consent',now()) RETURNING id INTO subid;
 INSERT INTO newsletter_list_memberships(list_id,subscriber_id) VALUES(listid,subid);
 INSERT INTO newsletter_campaigns(subject,html_body,text_body,list_id)
 VALUES('Synthetic newsletter','<p>Content</p>','Content',listid) RETURNING id INTO campaignid;
 PERFORM newsletter_campaign_queue('https://id.example.invalid','newsletter-admin',campaignid);
 claim=newsletter_claim_delivery();
 IF claim IS NULL OR claim->>'email'<>'mailer-synthetic@example.invalid'
 OR length(claim->>'unsubscribeToken')<>64
 THEN RAISE EXCEPTION 'claim did not bind consented address'; END IF;
 IF newsletter_claim_delivery() IS NOT NULL THEN
  RAISE EXCEPTION 'sending record was reclaimed and could duplicate'; END IF;
 IF NOT newsletter_send_preflight(campaignid,subid) THEN
  RAISE EXCEPTION 'approved consented claimed recipient not eligible at preflight'; END IF;
 SELECT token_hash INTO hashvalue FROM newsletter_unsubscribe_tokens WHERE subscriber_id=subid;
 IF hashvalue=claim->>'unsubscribeToken'
 OR hashvalue<>encode(digest(claim->>'unsubscribeToken','sha256'),'hex')
 THEN RAISE EXCEPTION 'raw unsubscribe token was stored'; END IF;
 IF NOT newsletter_redeem_unsubscribe(hashvalue) THEN
  RAISE EXCEPTION 'valid unsubscribe could not be redeemed'; END IF;
 IF NOT newsletter_redeem_unsubscribe(hashvalue) THEN
  RAISE EXCEPTION 'second unsubscribe was not safely idempotent'; END IF;
 IF (SELECT status FROM newsletter_subscribers WHERE id=subid)<>'unsubscribed'
 THEN RAISE EXCEPTION 'consent suppression missing'; END IF;
 IF newsletter_claim_delivery() IS NOT NULL THEN
  RAISE EXCEPTION 'unsubscribed subscriber was claimed'; END IF;
 IF newsletter_send_preflight(campaignid,subid) THEN
  RAISE EXCEPTION 'unsubscribed recipient passed preflight'; END IF;
 IF (SELECT status FROM newsletter_deliveries WHERE campaign_id=campaignid AND subscriber_id=subid)<>'suppressed'
 THEN RAISE EXCEPTION 'preflight failed to suppress in-flight send'; END IF;
 IF newsletter_acknowledge_delivery(campaignid,subid,'synthetic-api-receipt') THEN
  RAISE EXCEPTION 'suppressed in-flight delivery accepted a provider receipt'; END IF;
END $$;
ROLLBACK;
