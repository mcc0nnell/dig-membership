-- Paid NTC inventory boundary: Zeffy manages sellable inventory; Nexus only
-- grants one confirmed admission after a verified payment. No live API changes.
ALTER TABLE nexus_conference_enrollments DROP CONSTRAINT nexus_conference_enrollments_status_check;
ALTER TABLE nexus_conference_enrollments ADD CONSTRAINT nexus_conference_enrollments_status_check
 CHECK(status IN ('registered','waitlisted','cancelled','pending_payment','paid_review'));
ALTER TABLE nexus_conference_enrollments ADD COLUMN payment_due_at timestamptz;
ALTER TABLE nexus_conference_enrollments ADD CONSTRAINT nexus_payment_due_check
 CHECK((status='pending_payment' AND payment_due_at IS NOT NULL) OR
       (status<>'pending_payment' AND payment_due_at IS NULL));
-- Migrate only reconciled datasets: never silently downgrade existing paid event
-- attendees or invalidate preexisting workshop reservations.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM nexus_conference_enrollments en
  JOIN nexus_events e ON e.id=en.event_id
  WHERE e.ticket_price_cents>0 AND en.status='registered'
    AND NOT EXISTS(SELECT 1 FROM nexus_conference_payment_orders o
     WHERE o.enrollment_id=en.id AND o.status='paid'))
 THEN RAISE EXCEPTION 'existing unpaid paid-event registrations need manual data reconciliation'; END IF;
END $$;
ALTER TABLE nexus_conference_zeffy_reviews DROP CONSTRAINT nexus_conference_zeffy_reviews_reason_check;
ALTER TABLE nexus_conference_zeffy_reviews ADD CONSTRAINT nexus_conference_zeffy_reviews_reason_check
 CHECK(reason IN ('unmatched_enrollment','capacity_conflict','late_payment','refund_review'));
CREATE OR REPLACE FUNCTION nexus_conference_register(p_slug text,p_issuer text,p_subject text,p_email text,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event nexus_events%ROWTYPE; v_attendee uuid; v_record nexus_conference_enrollments%ROWTYPE;
 v_status text; v_due timestamptz;
BEGIN
 IF p_issuer IS NULL OR p_subject IS NULL OR length(p_issuer) NOT BETWEEN 8 AND 512 OR
    length(p_subject) NOT BETWEEN 1 AND 512 OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR
    length(p_email) NOT BETWEEN 3 AND 254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 THEN RAISE EXCEPTION 'invalid verified identity or name' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND OR v_event.publication_status<>'published' OR NOT v_event.registration_open OR now()>=v_event.starts_at
 THEN RAISE EXCEPTION 'event registration closed' USING ERRCODE='P0002'; END IF;
 SELECT id INTO v_attendee FROM nexus_conference_attendees WHERE issuer=p_issuer AND subject=p_subject;
 IF v_attendee IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM nexus_conference_attendees WHERE id=v_attendee AND email_key=lower(btrim(p_email)))
  THEN RAISE EXCEPTION 'identity email changed; manual review required' USING ERRCODE='23505'; END IF;
 ELSE
  -- Same verified email on another identity must NOT silently link or duplicate registrations.
  INSERT INTO nexus_conference_attendees(issuer,subject,email,display_name)
   VALUES(p_issuer,p_subject,lower(btrim(p_email)),btrim(p_name)) RETURNING id INTO v_attendee;
 END IF;
 SELECT * INTO v_record FROM nexus_conference_enrollments WHERE event_id=v_event.id AND attendee_id=v_attendee;
 IF FOUND AND v_record.status='pending_payment' AND v_record.payment_due_at<=now() AND
   NOT EXISTS(SELECT 1 FROM nexus_conference_payment_orders o WHERE o.enrollment_id=v_record.id AND o.status='paid') THEN
   UPDATE nexus_conference_enrollments SET status='cancelled',payment_due_at=NULL,updated_at=now() WHERE id=v_record.id;
   v_record.status='cancelled';
 END IF;
 -- Never recycle the same enrollment/order after a Zeffy transaction exists:
 -- even an apparently cancelled request may have a late processed charge.
 IF FOUND AND v_record.status='cancelled' AND v_event.ticket_price_cents>0 AND
   EXISTS(SELECT 1 FROM nexus_conference_payment_orders o
     WHERE o.enrollment_id=v_record.id AND o.zeffy_payment_id IS NOT NULL)
 THEN RAISE EXCEPTION 'earlier Zeffy purchase requires manual reconciliation' USING ERRCODE='42501'; END IF;
 IF FOUND AND v_record.status<>'cancelled' THEN
  RETURN jsonb_build_object('status',v_record.status,'confirmationReference',v_record.confirmation_reference,'paymentDueAt',v_record.payment_due_at,'alreadyRegistered',true);
 END IF;
 -- Zeffy is the paid-event inventory authority. A Nexus intent never holds a seat.
 IF v_event.ticket_price_cents>0 THEN
   IF v_event.capacity IS NOT NULL AND
      (SELECT count(*) FROM nexus_conference_enrollments WHERE event_id=v_event.id AND status='registered')>=v_event.capacity
   THEN v_status='waitlisted'; v_due=NULL;
   ELSE v_status='pending_payment'; v_due=now()+interval '24 hours'; END IF;
 ELSIF v_event.capacity IS NULL OR (SELECT count(*) FROM nexus_conference_enrollments
   WHERE event_id=v_event.id AND status='registered')<v_event.capacity
 THEN v_status='registered'; ELSE v_status='waitlisted'; END IF;
 INSERT INTO nexus_conference_enrollments(event_id,attendee_id,status,payment_due_at)
 VALUES(v_event.id,v_attendee,v_status,v_due)
 ON CONFLICT(event_id,attendee_id) DO UPDATE SET status=excluded.status,payment_due_at=excluded.payment_due_at,
   confirmation_reference=encode(gen_random_bytes(16),'hex'),requested_at=now(),updated_at=now()
 RETURNING * INTO v_record;
 RETURN jsonb_build_object('status',v_record.status,'confirmationReference',v_record.confirmation_reference,'paymentDueAt',v_record.payment_due_at,'alreadyRegistered',false);
END $$;

CREATE OR REPLACE FUNCTION nexus_conference_payment_link(p_slug text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE e nexus_events%ROWTYPE; en nexus_conference_enrollments%ROWTYPE; v_payment_status text;
BEGIN
 SELECT * INTO e FROM nexus_events WHERE slug=p_slug;
 IF NOT FOUND OR e.publication_status<>'published' OR e.ticket_price_cents<=0 OR
 e.zeffy_campaign_id IS NULL OR e.zeffy_ticket_rate_id IS NULL OR e.zeffy_form_url IS NULL
 THEN RAISE EXCEPTION 'hosted payment not configured' USING ERRCODE='P0002'; END IF;
 SELECT n.* INTO en FROM nexus_conference_enrollments n
 JOIN nexus_conference_attendees a ON a.id=n.attendee_id
 WHERE n.event_id=e.id AND n.status IN ('registered','pending_payment') AND a.issuer=p_issuer AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION 'active enrollment required' USING ERRCODE='42501'; END IF;
 IF en.status='pending_payment' AND (en.payment_due_at IS NULL OR en.payment_due_at<=now())
 THEN RAISE EXCEPTION 'payment intent expired' USING ERRCODE='P0002'; END IF;
 SELECT status INTO v_payment_status FROM nexus_conference_payment_orders WHERE enrollment_id=en.id;
 IF v_payment_status IS NOT NULL AND v_payment_status<>'pending' THEN
  RETURN jsonb_build_object('provider','zeffy','status',v_payment_status,'url',null,
   'amountCents',e.ticket_price_cents,'currency',e.ticket_currency);
 END IF;
 -- Refuse to send more buyers to checkout after Nexus confirms its full allocation.
 -- Zeffy's configured stock is still authoritative; validate it manually before launch.
 IF e.capacity IS NOT NULL AND (SELECT count(*) FROM nexus_conference_enrollments
   WHERE event_id=e.id AND status='registered')>=e.capacity
 THEN RAISE EXCEPTION 'paid conference at capacity' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('url',e.zeffy_form_url,'amountCents',e.ticket_price_cents,
  'currency',e.ticket_currency,'provider','zeffy');
END $$;

CREATE OR REPLACE FUNCTION nexus_conference_zeffy_reconcile(p_event text,p_payment uuid,p_campaign uuid,
 p_rate uuid,p_email text,p_amount integer,p_currency text,p_status text,p_type text,p_refund text,p_disputed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE e nexus_events%ROWTYPE;en nexus_conference_enrollments%ROWTYPE;
 o nexus_conference_payment_orders%ROWTYPE; v_result text; v_reason text;
BEGIN
 SELECT * INTO e FROM nexus_events WHERE zeffy_campaign_id=p_campaign FOR UPDATE;
 IF NOT FOUND OR e.zeffy_ticket_rate_id IS DISTINCT FROM p_rate OR
 e.ticket_price_cents<>p_amount OR e.ticket_currency<>upper(p_currency)
 THEN RAISE EXCEPTION 'campaign or ticket rate mismatch' USING ERRCODE='22023'; END IF;
 IF p_type<>'online' OR p_status NOT IN ('succeeded','failed','pending')
 THEN RAISE EXCEPTION 'unsupported Zeffy payment' USING ERRCODE='22023'; END IF;
 SELECT n.* INTO en FROM nexus_conference_enrollments n
 JOIN nexus_conference_attendees a ON a.id=n.attendee_id
 WHERE n.event_id=e.id AND a.email_key=lower(btrim(p_email));
 IF NOT FOUND THEN RAISE EXCEPTION 'buyer registration not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO o FROM nexus_conference_payment_orders WHERE enrollment_id=en.id;
 IF FOUND AND (o.zeffy_payment_id IS NOT NULL AND o.zeffy_payment_id<>p_payment OR
  o.amount_cents<>p_amount OR o.currency<>upper(p_currency))
 THEN RAISE EXCEPTION 'buyer payment mismatch' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM nexus_conference_payment_orders WHERE zeffy_payment_id=p_payment AND enrollment_id<>en.id)
 THEN RAISE EXCEPTION 'payment reused' USING ERRCODE='22023'; END IF;
 IF length(p_event) NOT BETWEEN 8 AND 256 THEN RAISE EXCEPTION 'invalid event key' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM nexus_conference_zeffy_events WHERE event_id=p_event) THEN
  RETURN jsonb_build_object('status','already_processed'); END IF;
 INSERT INTO nexus_conference_payment_orders(enrollment_id,amount_cents,currency,status,zeffy_payment_id,zeffy_campaign_id)
 VALUES(en.id,p_amount,upper(p_currency),
  CASE WHEN p_disputed THEN 'disputed'
   WHEN p_refund<>'none' OR p_refund IS NULL THEN 'refunded'
   WHEN p_status='succeeded' THEN 'paid' ELSE 'pending' END,p_payment,p_campaign)
 ON CONFLICT(enrollment_id) DO UPDATE SET status=CASE
  WHEN nexus_conference_payment_orders.status='disputed' THEN 'disputed'
  WHEN EXCLUDED.status='disputed' THEN 'disputed'
  WHEN EXCLUDED.status='refunded' THEN 'refunded'
  WHEN nexus_conference_payment_orders.status='refunded' THEN 'refunded'
  ELSE EXCLUDED.status END,updated_at=now(),zeffy_payment_id=EXCLUDED.zeffy_payment_id
 RETURNING * INTO o;
 INSERT INTO nexus_conference_zeffy_events(event_id,order_id) VALUES(p_event,o.id);
 -- Admission is allocated only AFTER a verified successful Zeffy payment, while
 -- holding the same event lock as all registration/cancellation operations.
 IF o.status='paid' AND en.status='pending_payment' THEN
   IF en.payment_due_at IS NULL OR en.payment_due_at<=now() OR now()>=e.starts_at THEN
     v_reason='late_payment';
   ELSIF e.capacity IS NOT NULL AND (SELECT count(*) FROM nexus_conference_enrollments
     WHERE event_id=e.id AND status='registered')>=e.capacity THEN
     v_reason='capacity_conflict';
   ELSE
     UPDATE nexus_conference_enrollments SET status='registered',payment_due_at=NULL,updated_at=now()
     WHERE id=en.id;
     en.status='registered';
   END IF;
 ELSIF o.status='paid' AND en.status<>'registered' THEN
   v_reason='late_payment';
 END IF;
 -- Confirmed admission is suspended on refund/dispute; no automatic Zeffy refund
 -- or stock-release claim is made. Staff reconcile those externally.
 IF o.status IN ('refunded','disputed') AND en.status='registered' THEN
   UPDATE nexus_conference_enrollments SET status='paid_review',payment_due_at=NULL,updated_at=now()
   WHERE id=en.id;
   en.status='paid_review';
   v_reason='refund_review';
 END IF;
 IF v_reason IS NOT NULL THEN
   UPDATE nexus_conference_enrollments SET status='paid_review',payment_due_at=NULL,updated_at=now()
     WHERE id=en.id AND status<>'cancelled';
   INSERT INTO nexus_conference_zeffy_reviews(zeffy_payment_id,event_id,buyer_email,reason)
   VALUES(p_payment,e.id,lower(btrim(p_email)),v_reason)
   ON CONFLICT(zeffy_payment_id) DO UPDATE SET reason=excluded.reason,state='pending',updated_at=now();
 END IF;
 IF o.status='paid' AND en.status='registered' AND v_reason IS NULL THEN
  INSERT INTO nexus_conference_notifications(enrollment_id,kind) VALUES(en.id,'payment')
  ON CONFLICT(enrollment_id,kind) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN v_reason IS NOT NULL THEN 'manual_review' ELSE o.status END);
END $$;

CREATE OR REPLACE FUNCTION nexus_conference_zeffy_claim(p_slug text,p_issuer text,p_subject text,
 p_payment uuid,p_campaign uuid,p_rate uuid,p_email text,p_amount integer,p_currency text,
 p_status text,p_type text,p_refund text,p_disputed boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_event nexus_events%ROWTYPE; v_attendee uuid;
BEGIN
 SELECT * INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND OR v_event.zeffy_campaign_id IS DISTINCT FROM p_campaign OR
    v_event.zeffy_ticket_rate_id IS DISTINCT FROM p_rate
 THEN RAISE EXCEPTION 'event mismatch' USING ERRCODE='22023'; END IF;
 SELECT en.id INTO v_attendee FROM nexus_conference_enrollments en
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.event_id=v_event.id AND en.status IN ('pending_payment','registered') AND a.issuer=p_issuer
   AND a.subject=p_subject AND a.email_key=lower(btrim(p_email));
 IF NOT FOUND THEN RAISE EXCEPTION 'verified purchaser enrollment required' USING ERRCODE='42501'; END IF;
 IF p_status<>'succeeded' OR p_refund<>'none' OR p_disputed IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'payment requires manual review' USING ERRCODE='22023'; END IF;
 RETURN nexus_conference_zeffy_reconcile('selfclaim:'||p_payment::text,p_payment,p_campaign,p_rate,
   p_email,p_amount,p_currency,p_status,p_type,p_refund,p_disputed);
END $$;

CREATE OR REPLACE FUNCTION nexus_conference_cancel(p_slug text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event uuid; v_record nexus_conference_enrollments%ROWTYPE; v_price integer; w record;
BEGIN
 SELECT id,ticket_price_cents INTO v_event,v_price FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event not found' USING ERRCODE='P0002'; END IF;
 SELECT en.* INTO v_record FROM nexus_conference_enrollments en
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.event_id=v_event AND a.issuer=p_issuer AND a.subject=p_subject;
 IF NOT FOUND OR v_record.status='cancelled' THEN RETURN jsonb_build_object('status','cancelled','alreadyCancelled',true); END IF;
 -- Never cancel a paid admission, release its place, or suggest an automatic
 -- refund merely because the attendee clicked Cancel. Organizer review first.
 IF v_price>0 AND EXISTS(SELECT 1 FROM nexus_conference_payment_orders
   WHERE enrollment_id=v_record.id AND status='paid')
 THEN RAISE EXCEPTION 'paid cancellation requires organizer refund review' USING ERRCODE='42501'; END IF;
 UPDATE nexus_conference_enrollments SET status='cancelled',payment_due_at=NULL,updated_at=now() WHERE id=v_record.id;
 FOR w IN (SELECT session_id,status FROM nexus_conference_workshop_reservations
    WHERE enrollment_id=v_record.id AND status IN ('confirmed','waitlisted')) LOOP
  UPDATE nexus_conference_workshop_reservations SET status='cancelled',updated_at=now()
  WHERE enrollment_id=v_record.id AND session_id=w.session_id;
  IF w.status='confirmed' THEN
   UPDATE nexus_conference_workshop_reservations SET status='confirmed',updated_at=now()
   WHERE id=(SELECT r.id FROM nexus_conference_workshop_reservations r
    JOIN nexus_conference_enrollments en ON en.id=r.enrollment_id
    WHERE r.session_id=w.session_id AND r.status='waitlisted' AND en.status='registered'
       AND NOT EXISTS(SELECT 1 FROM nexus_conference_workshop_reservations overlapping
        JOIN nexus_conference_sessions occupied ON occupied.id=overlapping.session_id
        JOIN nexus_conference_sessions freeing ON freeing.id=w.session_id
        WHERE overlapping.enrollment_id=r.enrollment_id AND overlapping.status='confirmed'
          AND occupied.starts_at<freeing.ends_at AND occupied.ends_at>freeing.starts_at)
    ORDER BY r.requested_at,r.id LIMIT 1);
  END IF;
 END LOOP;
 DELETE FROM nexus_conference_accessibility_requests WHERE enrollment_id=v_record.id;
 IF v_record.status='registered' AND v_price=0 THEN
  UPDATE nexus_conference_enrollments SET status='registered',updated_at=now()
  WHERE id=(SELECT id FROM nexus_conference_enrollments WHERE event_id=v_event AND status='waitlisted'
   ORDER BY requested_at,id LIMIT 1);
 END IF;
 RETURN jsonb_build_object('status','cancelled','alreadyCancelled',false);
END $$;

CREATE OR REPLACE FUNCTION nexus_conference_self(p_slug text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_record record;
BEGIN
 SELECT en.id,en.status,en.confirmation_reference,en.payment_due_at,a.display_name,a.email,ev.title,ev.timezone,ev.ticket_price_cents
 INTO v_record FROM nexus_conference_enrollments en
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 JOIN nexus_events ev ON ev.id=en.event_id
 WHERE ev.slug=p_slug AND a.issuer=p_issuer AND a.subject=p_subject;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('eventTitle',v_record.title,'status',v_record.status,
  'confirmationReference',v_record.confirmation_reference,'displayName',v_record.display_name,
  'email',v_record.email,'timezone',v_record.timezone,
  'paymentRequired',v_record.ticket_price_cents>0,'paymentDueAt',v_record.payment_due_at,
  'paymentStatus',(SELECT o.status FROM nexus_conference_payment_orders o WHERE o.enrollment_id=v_record.id),
  'workshops',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',s.slug,'title',s.title,'status',w.status)
  ORDER BY s.starts_at,s.slug) FROM nexus_conference_workshop_reservations w
  JOIN nexus_conference_sessions s ON s.id=w.session_id
  WHERE w.enrollment_id=v_record.id AND w.status<>'cancelled'),'[]'::jsonb),
  'accessibilityRequest',(SELECT r.request_text FROM nexus_conference_accessibility_requests r
    WHERE r.enrollment_id=v_record.id));
END $$;

-- Stale pending intents do not hold a place; this merely closes a dormant flow.
-- It never changes a paid order and cannot release Zeffy's own checkout hold.
CREATE FUNCTION nexus_conference_expire_intents(p_slug text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE e nexus_events%ROWTYPE; n integer;
BEGIN
 SELECT * INTO e FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event unavailable' USING ERRCODE='P0002'; END IF;
 IF e.ticket_price_cents=0 THEN RETURN 0; END IF;
 UPDATE nexus_conference_enrollments en SET status='cancelled',payment_due_at=NULL,updated_at=now()
 WHERE en.event_id=e.id AND en.status='pending_payment' AND en.payment_due_at<=now()
   AND NOT EXISTS(SELECT 1 FROM nexus_conference_payment_orders o
      WHERE o.enrollment_id=en.id AND o.status='paid');
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;

-- Per-enrollment deduplicated cleanup job scheduled for every paid intent. The
-- separate existing jobs container remains disabled until explicitly approved.
ALTER TABLE nexus_background_jobs DROP CONSTRAINT nexus_background_jobs_task_check;
ALTER TABLE nexus_background_jobs ADD CONSTRAINT nexus_background_jobs_task_check
 CHECK(task IN ('runtime_expiry_cleanup','conference_intent_expiry'));
CREATE FUNCTION nexus_conference_schedule_intent_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bucket text;
BEGIN
 IF NEW.status='pending_payment' AND NEW.payment_due_at IS NOT NULL THEN
  bucket='intent-'||NEW.id::text;
  INSERT INTO nexus_background_jobs(task,dedupe_key,run_at)
    VALUES('conference_intent_expiry',bucket,NEW.payment_due_at)
  ON CONFLICT(task,dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
   SET state=CASE WHEN nexus_background_jobs.state IN ('done','dead') THEN 'queued'
     ELSE nexus_background_jobs.state END,
    run_at=excluded.run_at,
    attempts=CASE WHEN nexus_background_jobs.state IN ('done','dead') THEN 0 ELSE nexus_background_jobs.attempts END,
    finished_at=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nexus_conference_schedule_expiry AFTER INSERT OR UPDATE OF status,payment_due_at
 ON nexus_conference_enrollments FOR EACH ROW EXECUTE FUNCTION nexus_conference_schedule_intent_expiry();
-- Execute under the existing leased jobs worker; never touches Zeffy money.
CREATE FUNCTION nexus_conference_expire_due_intents() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE e record; n integer; total integer:=0;
BEGIN
 FOR e IN SELECT ev.slug FROM nexus_events ev
   WHERE ev.ticket_price_cents>0 AND EXISTS(SELECT 1 FROM nexus_conference_enrollments en
    WHERE en.event_id=ev.id AND en.status='pending_payment' AND en.payment_due_at<=now())
   ORDER BY ev.slug LOOP
    SELECT nexus_conference_expire_intents(e.slug) INTO n;
    total=total+n;
 END LOOP;
 RETURN total;
END $$;

-- Prevent an unlimited or partially configured paid event. Operators must set
-- Zeffy's total stock equal to the bounded Nexus event capacity manually.
CREATE FUNCTION nexus_conference_guard_paid_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.ticket_price_cents>0 AND (NEW.capacity IS NULL OR NEW.capacity<=0 OR
    NEW.zeffy_campaign_id IS NULL OR NEW.zeffy_ticket_rate_id IS NULL OR NEW.zeffy_form_url IS NULL)
 THEN RAISE EXCEPTION 'paid event requires finite capacity and complete Zeffy mapping' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' AND NEW.ticket_price_cents>0 THEN
  IF OLD.ticket_price_cents=0 AND EXISTS(SELECT 1 FROM nexus_conference_enrollments en
     WHERE en.event_id=OLD.id AND en.status IN ('registered','waitlisted'))
  THEN RAISE EXCEPTION 'existing free event requires manual conversion before paid admission' USING ERRCODE='22023'; END IF;
  IF NEW.capacity<(SELECT count(*) FROM nexus_conference_enrollments
    WHERE event_id=OLD.id AND status='registered')
  THEN RAISE EXCEPTION 'cannot reduce confirmed paid event capacity' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nexus_event_paid_capacity_guard BEFORE INSERT OR UPDATE OF ticket_price_cents,capacity,zeffy_campaign_id,zeffy_ticket_rate_id,zeffy_form_url
 ON nexus_events FOR EACH ROW EXECUTE FUNCTION nexus_conference_guard_paid_capacity();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM nexus_events WHERE ticket_price_cents>0 AND
   (capacity IS NULL OR capacity<=0 OR zeffy_campaign_id IS NULL OR zeffy_ticket_rate_id IS NULL OR zeffy_form_url IS NULL))
 THEN RAISE EXCEPTION 'existing paid events require finite capacity and Zeffy configuration'; END IF;
END $$;
