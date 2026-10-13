-- Transactional integration for payment accounting, replay, QR and outbox.
BEGIN;
-- Earlier CI concurrency fixtures may have queued unrelated notifications.
-- Isolate the synthetic outbox within this rolled-back transaction.
UPDATE nexus_conference_notifications SET state='review' WHERE state='pending';
INSERT INTO nexus_events(id,slug,title,starts_at,ends_at,capacity,registration_open,
 publication_status,ticket_price_cents,zeffy_campaign_id,zeffy_ticket_rate_id,zeffy_form_url)
VALUES('10000000-0000-4000-8000-000000000001','ticket-test','Synthetic NTC Ticketing',
'2027-04-28T08:00:00-04:00','2027-04-30T20:00:00-04:00',3,true,'published',2500,
'20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',
'https://www.zeffy.com/en-US/ticketing/synthetic');
INSERT INTO nexus_members(id,email,display_name) VALUES
('40000000-0000-4000-8000-000000000004','staff@fixture.invalid','Synthetic Staff');
INSERT INTO nexus_external_identities(issuer,subject,member_id) VALUES
('https://accounts.google.com','ticketstaff','40000000-0000-4000-8000-000000000004');
INSERT INTO nexus_conference_checkin_staff(event_id,member_id) VALUES
('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004');
DO $$
DECLARE v jsonb; v_notice jsonb;
BEGIN
 PERFORM nexus_conference_register('ticket-test','https://accounts.google.com','ticketbuyer','ticketbuyer@fixture.invalid','Synthetic Buyer');
 IF (SELECT count(*) FROM nexus_conference_notifications WHERE kind='registration')<>1
 THEN RAISE EXCEPTION 'registration mail not enqueued'; END IF;
 v_notice=nexus_conference_claim_mail();
 IF v_notice->>'email'<>'ticketbuyer@fixture.invalid' OR v_notice->>'kind'<>'registration'
 THEN RAISE EXCEPTION 'outbox claim incorrect'; END IF;
 IF nexus_conference_claim_mail() IS NOT NULL THEN RAISE EXCEPTION 'mail double claim'; END IF;
 IF NOT nexus_conference_complete_mail((v_notice->>'notificationId')::uuid,true,'synthetic-accepted-id')
 THEN RAISE EXCEPTION 'mail completion failed'; END IF;
 IF nexus_conference_complete_mail((v_notice->>'notificationId')::uuid,true,'duplicate') IS NOT NULL
 THEN RAISE EXCEPTION 'mail completion replay succeeded'; END IF;
 v=nexus_conference_payment_link('ticket-test','https://accounts.google.com','ticketbuyer');
 IF v->>'provider'<>'zeffy' OR v->>'amountCents'<>'2500' THEN RAISE EXCEPTION 'wrong hosted link'; END IF;
 BEGIN
  PERFORM nexus_conference_issue_ticket('ticket-test','https://accounts.google.com','ticketbuyer',repeat('a',64));
  RAISE EXCEPTION 'unpaid QR issued';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM nexus_conference_zeffy_reconcile('event-mismatch-00001','50000000-0000-4000-8000-000000000005',
   '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',
   'ticketbuyer@fixture.invalid',999,'usd','succeeded','online','none',false);
  RAISE EXCEPTION 'wrong amount accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM nexus_conference_zeffy_reconcile('event-mismatch-00002','50000000-0000-4000-8000-000000000005',
   '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',
   'ticketbuyer@fixture.invalid',2500,'usd','succeeded','manual','none',false);
  RAISE EXCEPTION 'manual payment counted as paid';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 v=nexus_conference_zeffy_reconcile('event-paid-000000001','50000000-0000-4000-8000-000000000005',
 '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',
 'ticketbuyer@fixture.invalid',2500,'usd','succeeded','online','none',false);
 IF v->>'status'<>'paid' THEN RAISE EXCEPTION 'verified payment not credited'; END IF;
 IF nexus_conference_zeffy_reconcile('event-paid-000000001','50000000-0000-4000-8000-000000000005',
 '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',
 'ticketbuyer@fixture.invalid',2500,'usd','succeeded','online','none',false)->>'status'<>'already_processed'
 THEN RAISE EXCEPTION 'event replay not idempotent'; END IF;
 IF nexus_conference_payment_link('ticket-test','https://accounts.google.com','ticketbuyer')->>'url' IS NOT NULL
 THEN RAISE EXCEPTION 'paid attendee offered another checkout'; END IF;
 IF (SELECT count(*) FROM nexus_conference_notifications WHERE kind='payment')<>1
 THEN RAISE EXCEPTION 'payment notice missing'; END IF;
 PERFORM nexus_conference_issue_ticket('ticket-test','https://accounts.google.com','ticketbuyer',repeat('a',64));
 BEGIN
  PERFORM nexus_conference_checkin('ticket-test','https://accounts.google.com','unknown',repeat('a',64));
  RAISE EXCEPTION 'unauthorized staff check-in';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM nexus_conference_checkin('ticket-test','https://accounts.google.com','ticketstaff',repeat('b',64));
  RAISE EXCEPTION 'wrong QR valid';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 IF nexus_conference_checkin('ticket-test','https://accounts.google.com','ticketstaff',repeat('a',64))->>'status'<>'checked_in'
 THEN RAISE EXCEPTION 'check-in failed'; END IF;
 IF nexus_conference_checkin('ticket-test','https://accounts.google.com','ticketstaff',repeat('a',64))->>'status'<>'already_checked_in'
 THEN RAISE EXCEPTION 'QR replay changed attendance'; END IF;
 BEGIN
  PERFORM nexus_conference_issue_ticket('ticket-test','https://accounts.google.com','ticketbuyer',repeat('c',64));
  RAISE EXCEPTION 'QR rotated after check-in';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 v=nexus_conference_zeffy_reconcile('event-refund-000001','50000000-0000-4000-8000-000000000005',
 '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',
 'ticketbuyer@fixture.invalid',2500,'usd','succeeded','online','full',false);
 IF v->>'status'<>'refunded' THEN RAISE EXCEPTION 'refund not recorded'; END IF;
 IF (SELECT status FROM nexus_conference_payment_orders LIMIT 1)<>'refunded'
 THEN RAISE EXCEPTION 'paid state not reversed'; END IF;
END $$;
ROLLBACK;
