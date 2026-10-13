-- Disposable fixture: single-use magic tokens and purchaser-verified payment recovery.
BEGIN;
INSERT INTO nexus_events(id,slug,title,starts_at,ends_at,capacity,registration_open,publication_status,
 ticket_price_cents,zeffy_campaign_id,zeffy_ticket_rate_id,zeffy_form_url)
VALUES('b1000000-0000-4000-8000-000000000001','magic-test','Magic Integration Event',
 '2027-04-28T09:00:00-04:00','2027-04-30T17:00:00-04:00',3,true,'published',2500,
 'b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000003',
 'https://www.zeffy.com/en-US/ticketing/synthetic-magic');
DO $$
DECLARE v jsonb;
BEGIN
 PERFORM nexus_magic_issue(repeat('a',64),' Magic@Example.Invalid ','magic-test');
 v=nexus_magic_consume(repeat('a',64));
 IF v->>'email'<>'magic@example.invalid' OR v->>'eventSlug'<>'magic-test'
 THEN RAISE EXCEPTION 'email login token not consumed'; END IF;
 IF nexus_magic_consume(repeat('a',64)) IS NOT NULL THEN RAISE EXCEPTION 'magic replay accepted'; END IF;
 PERFORM nexus_magic_issue(repeat('b',64),'magic@example.invalid','magic-test');
 PERFORM nexus_magic_issue(repeat('c',64),'magic@example.invalid','magic-test');
 IF nexus_magic_consume(repeat('b',64)) IS NOT NULL THEN RAISE EXCEPTION 'old magic link still valid'; END IF;
 UPDATE nexus_conference_magic_links SET requested_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' WHERE token_hash=repeat('c',64);
 IF nexus_magic_consume(repeat('c',64)) IS NOT NULL THEN RAISE EXCEPTION 'expired magic link accepted'; END IF;
 -- A valid Zeffy payment without a registered buyer must be held, never admitted.
 PERFORM nexus_conference_zeffy_review('b4000000-0000-4000-8000-000000000004',
  'b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000003',
  'magic@example.invalid',2500,'usd');
 IF (SELECT state FROM nexus_conference_zeffy_reviews WHERE zeffy_payment_id='b4000000-0000-4000-8000-000000000004')<>'pending'
 THEN RAISE EXCEPTION 'unmatched payment review missing'; END IF;
 PERFORM nexus_conference_zeffy_review_resolve('b4000000-0000-4000-8000-000000000004');
 IF (SELECT state FROM nexus_conference_zeffy_reviews WHERE zeffy_payment_id='b4000000-0000-4000-8000-000000000004')<>'resolved'
 THEN RAISE EXCEPTION 'reconciled payment still marked for review'; END IF;
 IF (SELECT count(*) FROM nexus_conference_payment_orders WHERE zeffy_payment_id='b4000000-0000-4000-8000-000000000004')<>0
 THEN RAISE EXCEPTION 'unmatched payment incorrectly granted admission'; END IF;
 PERFORM nexus_conference_register('magic-test','urn:dig:nexus:magic','magic-subject','magic@example.invalid','Magic Attendee');
 BEGIN
  PERFORM nexus_conference_zeffy_claim('magic-test','urn:dig:nexus:magic','unauthorized-subject',
   'b4000000-0000-4000-8000-000000000004',
   'b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000003',
   'magic@example.invalid',2500,'usd','succeeded','online','none',false);
  RAISE EXCEPTION 'unverified participant claimed payment';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM nexus_conference_zeffy_claim('magic-test','urn:dig:nexus:magic','magic-subject',
   'b4000000-0000-4000-8000-000000000004',
   'b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000003',
   'different@example.invalid',2500,'usd','succeeded','online','none',false);
  RAISE EXCEPTION 'different purchaser email allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM nexus_conference_zeffy_claim('magic-test','urn:dig:nexus:magic','magic-subject',
   'b4000000-0000-4000-8000-000000000004',
   'b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000003',
   'magic@example.invalid',2500,'usd','pending','online','none',false);
  RAISE EXCEPTION 'pending payment credited';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 v=nexus_conference_zeffy_claim('magic-test','urn:dig:nexus:magic','magic-subject',
   'b4000000-0000-4000-8000-000000000004',
   'b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000003',
   'magic@example.invalid',2500,'usd','succeeded','online','none',false);
 IF v->>'status'<>'paid' THEN RAISE EXCEPTION 'verified payment not credited'; END IF;
 v=nexus_conference_zeffy_claim('magic-test','urn:dig:nexus:magic','magic-subject',
   'b4000000-0000-4000-8000-000000000004',
   'b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000003',
   'magic@example.invalid',2500,'usd','succeeded','online','none',false);
 IF v->>'status'<>'already_processed' THEN RAISE EXCEPTION 'claim replay not idempotent'; END IF;
 PERFORM nexus_conference_zeffy_review_resolve('b4000000-0000-4000-8000-000000000004');
 IF (SELECT state FROM nexus_conference_zeffy_reviews WHERE zeffy_payment_id='b4000000-0000-4000-8000-000000000004')<>'resolved'
 THEN RAISE EXCEPTION 'reconciled payment still marked for review'; END IF;
 IF (SELECT count(*) FROM nexus_conference_payment_orders WHERE zeffy_payment_id=
   'b4000000-0000-4000-8000-000000000004')<>1 THEN RAISE EXCEPTION 'duplicate paid order'; END IF;
END $$;
ROLLBACK;
