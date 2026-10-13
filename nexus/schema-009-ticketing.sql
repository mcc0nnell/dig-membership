-- DIG Nexus NTC ticketing. Apply AFTER 008 on isolated staging only.
-- No provider or email is ever enabled by this migration.
ALTER TABLE nexus_events ADD COLUMN ticket_price_cents integer NOT NULL DEFAULT 0 CHECK(ticket_price_cents BETWEEN 0 AND 10000000);
ALTER TABLE nexus_events ADD COLUMN ticket_currency char(3) NOT NULL DEFAULT 'USD' CHECK(ticket_currency='USD');
ALTER TABLE nexus_events ADD COLUMN zeffy_campaign_id uuid UNIQUE;
ALTER TABLE nexus_events ADD COLUMN zeffy_ticket_rate_id uuid;
ALTER TABLE nexus_events ADD COLUMN zeffy_form_url text;
ALTER TABLE nexus_events ADD CONSTRAINT nexus_zeffy_configuration CHECK (
 (zeffy_campaign_id IS NULL AND zeffy_ticket_rate_id IS NULL AND zeffy_form_url IS NULL) OR
 (zeffy_campaign_id IS NOT NULL AND zeffy_ticket_rate_id IS NOT NULL AND
 zeffy_form_url ~ '^https://(www[.])?zeffy[.]com/'));
CREATE TABLE nexus_conference_payment_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 enrollment_id uuid NOT NULL UNIQUE REFERENCES nexus_conference_enrollments(id),
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 currency char(3) NOT NULL CHECK(currency='USD'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','refunded','disputed')),
 zeffy_payment_id uuid UNIQUE,
 zeffy_campaign_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nexus_conference_zeffy_events (
 event_id text PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES nexus_conference_payment_orders(id),
 happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nexus_conference_tickets (
 enrollment_id uuid PRIMARY KEY REFERENCES nexus_conference_enrollments(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT now(),
 checked_in_at timestamptz,
 checked_in_by uuid REFERENCES nexus_members(id),
 CHECK((checked_in_at IS NULL)=(checked_in_by IS NULL))
);
CREATE TABLE nexus_conference_checkin_staff (
 event_id uuid NOT NULL REFERENCES nexus_events(id),
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 PRIMARY KEY(event_id,member_id)
);
CREATE TABLE nexus_conference_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 enrollment_id uuid NOT NULL REFERENCES nexus_conference_enrollments(id),
 kind text NOT NULL CHECK(kind IN ('registration','payment')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','review')),
 provider_message_id text,
 claimed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enrollment_id,kind)
);
-- Enqueue on initial registration or event waitlist promotion, never attendee marketing.
CREATE FUNCTION nexus_conference_enqueue_registration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='registered' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  INSERT INTO nexus_conference_notifications(enrollment_id,kind) VALUES(NEW.id,'registration')
  ON CONFLICT(enrollment_id,kind) DO UPDATE SET state='pending',provider_message_id=NULL,
    claimed_at=NULL,updated_at=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nexus_conference_enqueue_on_enrollment
 AFTER INSERT OR UPDATE OF status ON nexus_conference_enrollments
 FOR EACH ROW EXECUTE FUNCTION nexus_conference_enqueue_registration();

-- Checkout is hosted by Zeffy. A mere redirect/payment claim never marks paid.
-- Require a dedicated Zeffy campaign and exact rate mapping to the event.
CREATE FUNCTION nexus_conference_payment_link(p_slug text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE e nexus_events%ROWTYPE; en nexus_conference_enrollments%ROWTYPE; v_payment_status text;
BEGIN
 SELECT * INTO e FROM nexus_events WHERE slug=p_slug;
 IF NOT FOUND OR e.publication_status<>'published' OR e.ticket_price_cents<=0 OR
 e.zeffy_campaign_id IS NULL OR e.zeffy_ticket_rate_id IS NULL OR e.zeffy_form_url IS NULL
 THEN RAISE EXCEPTION 'hosted payment not configured' USING ERRCODE='P0002'; END IF;
 SELECT n.* INTO en FROM nexus_conference_enrollments n
 JOIN nexus_conference_attendees a ON a.id=n.attendee_id
 WHERE n.event_id=e.id AND n.status='registered' AND a.issuer=p_issuer AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION 'active enrollment required' USING ERRCODE='42501'; END IF;
 SELECT status INTO v_payment_status FROM nexus_conference_payment_orders WHERE enrollment_id=en.id;
 IF v_payment_status IS NOT NULL AND v_payment_status<>'pending' THEN
  RETURN jsonb_build_object('provider','zeffy','status',v_payment_status,'url',null,
   'amountCents',e.ticket_price_cents,'currency',e.ticket_currency);
 END IF;
 RETURN jsonb_build_object('url',e.zeffy_form_url,'amountCents',e.ticket_price_cents,
  'currency',e.ticket_currency,'provider','zeffy');
END $$;

-- Only call after HMAC signature verification AND fetching current payment from Zeffy API.
-- Reject ambiguous events, offline/manual payments, tips-only, wrong rate/currency or buyer mismatch.
CREATE FUNCTION nexus_conference_zeffy_reconcile(p_event text,p_payment uuid,p_campaign uuid,
 p_rate uuid,p_email text,p_amount integer,p_currency text,p_status text,p_type text,p_refund text,p_disputed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE e nexus_events%ROWTYPE;en nexus_conference_enrollments%ROWTYPE;
 o nexus_conference_payment_orders%ROWTYPE; v_result text;
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
 IF o.status='paid' AND en.status='registered' THEN
  INSERT INTO nexus_conference_notifications(enrollment_id,kind) VALUES(en.id,'payment')
  ON CONFLICT(enrollment_id,kind) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('status',o.status);
END $$;

-- Ticket raw value is never saved. Re-issuing invalidates prior QR before check-in.
CREATE FUNCTION nexus_conference_issue_ticket(p_slug text,p_issuer text,p_subject text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event nexus_events%ROWTYPE; v_en nexus_conference_enrollments%ROWTYPE; v_order nexus_conference_payment_orders%ROWTYPE;
BEGIN
 IF p_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid token hash' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event not found' USING ERRCODE='P0002'; END IF;
 SELECT en.* INTO v_en FROM nexus_conference_enrollments en JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.event_id=v_event.id AND en.status='registered' AND a.issuer=p_issuer AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION 'registered attendee required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_order FROM nexus_conference_payment_orders WHERE enrollment_id=v_en.id;
 IF v_event.ticket_price_cents>0 AND (NOT FOUND OR v_order.status<>'paid')
 THEN RAISE EXCEPTION 'payment required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM nexus_conference_tickets WHERE enrollment_id=v_en.id AND checked_in_at IS NOT NULL)
 THEN RAISE EXCEPTION 'already checked in' USING ERRCODE='22023'; END IF;
 INSERT INTO nexus_conference_tickets(enrollment_id,token_hash) VALUES(v_en.id,p_hash)
 ON CONFLICT(enrollment_id) DO UPDATE SET token_hash=excluded.token_hash,issued_at=now();
 RETURN jsonb_build_object('status','issued');
END $$;
CREATE FUNCTION nexus_conference_checkin(p_slug text,p_issuer text,p_subject text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event nexus_events%ROWTYPE; v_staff uuid; v_ticket nexus_conference_tickets%ROWTYPE;
 v_name text; v_paid boolean;
BEGIN
 SELECT * INTO v_event FROM nexus_events WHERE slug=p_slug FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event not found' USING ERRCODE='P0002'; END IF;
 SELECT m.id INTO v_staff FROM nexus_conference_checkin_staff staff
 JOIN nexus_external_identities i ON i.member_id=staff.member_id AND i.issuer=p_issuer AND i.subject=p_subject
 JOIN nexus_members m ON m.id=i.member_id AND m.member_status<>'suspended'
 WHERE staff.event_id=v_event.id;
 IF v_staff IS NULL THEN RAISE EXCEPTION 'staff scope required' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO v_ticket FROM nexus_conference_tickets t
 JOIN nexus_conference_enrollments en ON en.id=t.enrollment_id
 WHERE en.event_id=v_event.id AND t.token_hash=p_hash AND en.status='registered' FOR UPDATE OF t;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid ticket' USING ERRCODE='P0002'; END IF;
 IF v_event.ticket_price_cents>0 AND NOT EXISTS(SELECT 1 FROM nexus_conference_payment_orders
 WHERE enrollment_id=v_ticket.enrollment_id AND status='paid')
 THEN RAISE EXCEPTION 'ticket payment invalid' USING ERRCODE='P0002'; END IF;
 IF v_ticket.checked_in_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_checked_in'); END IF;
 UPDATE nexus_conference_tickets SET checked_in_at=now(),checked_in_by=v_staff WHERE enrollment_id=v_ticket.enrollment_id;
 SELECT a.display_name INTO v_name FROM nexus_conference_enrollments en JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 WHERE en.id=v_ticket.enrollment_id;
 INSERT INTO nexus_event_audit(event_id,actor_member_id,action,detail)
 VALUES(v_event.id,v_staff,'conference_checkin',jsonb_build_object('enrollmentId',v_ticket.enrollment_id));
 RETURN jsonb_build_object('status','checked_in','attendeeName',v_name);
END $$;

-- Workers claim one immutable mail job; failures transition to manual review, never blind retries.
CREATE FUNCTION nexus_conference_claim_mail() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid; v_info jsonb;
BEGIN
 SELECT n.id INTO v_id FROM nexus_conference_notifications n
 JOIN nexus_conference_enrollments en ON en.id=n.enrollment_id
 WHERE n.state='pending' AND en.status='registered'
 ORDER BY n.updated_at,n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1;
 IF v_id IS NULL THEN RETURN NULL; END IF;
 UPDATE nexus_conference_notifications SET state='sending',claimed_at=now(),updated_at=now() WHERE id=v_id;
 SELECT jsonb_build_object('notificationId',n.id,'kind',n.kind,'email',a.email,'displayName',a.display_name,
   'eventTitle',e.title,'confirmationReference',en.confirmation_reference,
   'ticketPaid', e.ticket_price_cents=0 OR EXISTS(SELECT 1 FROM nexus_conference_payment_orders o
     WHERE o.enrollment_id=en.id AND o.status='paid')) INTO v_info
 FROM nexus_conference_notifications n
 JOIN nexus_conference_enrollments en ON en.id=n.enrollment_id
 JOIN nexus_conference_attendees a ON a.id=en.attendee_id
 JOIN nexus_events e ON e.id=en.event_id WHERE n.id=v_id;
 RETURN v_info;
END $$;
CREATE FUNCTION nexus_conference_complete_mail(p_id uuid,p_accepted boolean,p_provider_id text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER AS $$
 UPDATE nexus_conference_notifications SET state=CASE WHEN p_accepted THEN 'accepted' ELSE 'review' END,
 provider_message_id=CASE WHEN p_accepted THEN p_provider_id ELSE NULL END,updated_at=now()
 WHERE id=p_id AND state='sending' RETURNING true
$$;
-- Freeze published price on any event with a payment order; manual reconciliations are required.
CREATE FUNCTION nexus_conference_guard_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.ticket_price_cents,NEW.ticket_currency,NEW.zeffy_campaign_id,NEW.zeffy_ticket_rate_id) IS DISTINCT FROM (OLD.ticket_price_cents,OLD.ticket_currency,OLD.zeffy_campaign_id,OLD.zeffy_ticket_rate_id)
 AND EXISTS(SELECT 1 FROM nexus_conference_payment_orders o
 JOIN nexus_conference_enrollments en ON en.id=o.enrollment_id WHERE en.event_id=OLD.id)
 THEN RAISE EXCEPTION 'ticket pricing locked after orders' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nexus_event_ticket_price_guard BEFORE UPDATE OF ticket_price_cents,ticket_currency,zeffy_campaign_id,zeffy_ticket_rate_id ON nexus_events
 FOR EACH ROW EXECUTE FUNCTION nexus_conference_guard_price();
