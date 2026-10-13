-- Purely synthetic paid admissions: pending intents never occupy an event seat.
BEGIN;
INSERT INTO nexus_events(id,slug,title,starts_at,ends_at,capacity,registration_open,publication_status,
 ticket_price_cents,zeffy_campaign_id,zeffy_ticket_rate_id,zeffy_form_url)
VALUES('c1000000-0000-4000-8000-000000000001','paid-inventory-test','Synthetic Paid Conference',
 '2027-04-28T09:00:00-04:00','2027-04-30T17:00:00-04:00',1,true,'published',2500,
 'c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003',
 'https://www.zeffy.com/en-US/ticketing/synthetic-inventory'),
 ('d1000000-0000-4000-8000-000000000001','paid-late-test','Synthetic Expiry Conference',
 '2027-04-28T09:00:00-04:00','2027-04-30T17:00:00-04:00',2,true,'published',2500,
 'd2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000003',
 'https://www.zeffy.com/en-US/ticketing/synthetic-late');
DO $$
DECLARE a jsonb; b jsonb; payment jsonb; after_status text; v_id uuid; n integer;
BEGIN
 a=nexus_conference_register('paid-inventory-test','https://accounts.google.com','int-a','int-a@fixture.invalid','Paying A');
 b=nexus_conference_register('paid-inventory-test','https://accounts.google.com','int-b','int-b@fixture.invalid','Paying B');
 IF a->>'status'<>'pending_payment' OR b->>'status'<>'pending_payment'
 THEN RAISE EXCEPTION 'pending intents should not use inventory'; END IF;
 IF (SELECT count(*) FROM nexus_conference_enrollments WHERE event_id='c1000000-0000-4000-8000-000000000001' AND status='registered')<>0
 THEN RAISE EXCEPTION 'unpaid intent occupied a seat'; END IF;
 IF (SELECT count(*) FROM nexus_background_jobs j JOIN nexus_conference_enrollments en ON j.dedupe_key='intent-'||en.id::text WHERE j.task='conference_intent_expiry' AND j.state='queued' AND en.event_id='c1000000-0000-4000-8000-000000000001')<>2
 THEN RAISE EXCEPTION 'expiry jobs not scheduled independently'; END IF;
 IF nexus_conference_payment_link('paid-inventory-test','https://accounts.google.com','int-a')->>'provider'<>'zeffy'
 THEN RAISE EXCEPTION 'no Zeffy link for pending attendee'; END IF;
 BEGIN
  PERFORM nexus_conference_issue_ticket('paid-inventory-test','https://accounts.google.com','int-a',repeat('b',64));
  RAISE EXCEPTION 'unpaid QR granted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 payment=nexus_conference_zeffy_reconcile('paid-event-00000001','c4000000-0000-4000-8000-000000000004',
  'c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003',
  'int-a@fixture.invalid',2500,'usd','succeeded','online','none',false);
 IF payment->>'status'<>'paid' THEN RAISE EXCEPTION 'first payment not credited'; END IF;
 IF (SELECT count(*) FROM nexus_conference_enrollments WHERE event_id='c1000000-0000-4000-8000-000000000001' AND status='registered')<>1
 THEN RAISE EXCEPTION 'first paid admission not confirmed'; END IF;
 BEGIN
  PERFORM nexus_conference_payment_link('paid-inventory-test','https://accounts.google.com','int-b');
  RAISE EXCEPTION 'payment link exposed after local confirmed capacity full';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 payment=nexus_conference_zeffy_reconcile('paid-event-00000002','c5000000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003',
  'int-b@fixture.invalid',2500,'usd','succeeded','online','none',false);
 IF payment->>'status'<>'manual_review' THEN RAISE EXCEPTION 'second paid buyer incorrectly confirmed'; END IF;
 IF (SELECT reason FROM nexus_conference_zeffy_reviews WHERE zeffy_payment_id='c5000000-0000-4000-8000-000000000005')<>'capacity_conflict'
 THEN RAISE EXCEPTION 'paid overflow review missing'; END IF;
 IF (SELECT count(*) FROM nexus_conference_enrollments WHERE event_id='c1000000-0000-4000-8000-000000000001' AND status='registered')<>1
 THEN RAISE EXCEPTION 'oversold Nexus capacity'; END IF;
 BEGIN
  PERFORM nexus_conference_issue_ticket('paid-inventory-test','https://accounts.google.com','int-b',repeat('c',64));
  RAISE EXCEPTION 'overflow received QR';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM nexus_conference_cancel('paid-inventory-test','https://accounts.google.com','int-a');
  RAISE EXCEPTION 'paid enrollment silently cancelled without refund';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 payment=nexus_conference_zeffy_reconcile('refund-event-0000001','c4000000-0000-4000-8000-000000000004',
  'c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003',
  'int-a@fixture.invalid',2500,'usd','succeeded','online','full',false);
 IF payment->>'status'<>'manual_review' THEN RAISE EXCEPTION 'refund did not enter review'; END IF;
 IF (SELECT status FROM nexus_conference_enrollments WHERE event_id='c1000000-0000-4000-8000-000000000001' AND attendee_id=(SELECT id FROM nexus_conference_attendees WHERE email_key='int-a@fixture.invalid'))<>'paid_review'
 THEN RAISE EXCEPTION 'refunded admission still confirmed'; END IF;
 IF (SELECT reason FROM nexus_conference_zeffy_reviews WHERE zeffy_payment_id='c4000000-0000-4000-8000-000000000004')<>'refund_review'
 THEN RAISE EXCEPTION 'refund review not recorded'; END IF;
 PERFORM nexus_conference_register('paid-late-test','https://accounts.google.com','int-late','int-late@fixture.invalid','Late Buyer');
 UPDATE nexus_conference_enrollments SET payment_due_at=now()-interval '1 minute'
 WHERE event_id='d1000000-0000-4000-8000-000000000001';
 SELECT nexus_conference_expire_intents('paid-late-test') INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'stale intent not expired'; END IF;
 payment=nexus_conference_zeffy_reconcile('late-event-00000001','d4000000-0000-4000-8000-000000000004',
  'd2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000003',
  'int-late@fixture.invalid',2500,'usd','succeeded','online','none',false);
 IF payment->>'status'<>'manual_review' THEN RAISE EXCEPTION 'late Zeffy payment automatically admitted'; END IF;
 IF (SELECT status FROM nexus_conference_enrollments WHERE event_id='d1000000-0000-4000-8000-000000000001')<>'cancelled'
 THEN RAISE EXCEPTION 'cancelled intent silently reactivated'; END IF;
 BEGIN
  PERFORM nexus_conference_register('paid-late-test','https://accounts.google.com','int-late','int-late@fixture.invalid','Late Buyer');
  RAISE EXCEPTION 'late paid order silently re-registered';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO nexus_events(slug,title,starts_at,ends_at,ticket_price_cents,capacity)
   VALUES('unconfigured-paid-test','Unsafe Missing Zeffy Mapping','2027-04-28T09:00:00-04:00','2027-04-30T17:00:00-04:00',2500,10);
  RAISE EXCEPTION 'partially configured paid event accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

END $$;
ROLLBACK;
