-- Clean-room newsletter audience and approval state. Apply after Nexus schema 012.
-- Membership or attendance never implies newsletter consent.
ALTER TABLE newsletter_subscribers ADD CONSTRAINT newsletter_subscribed_requires_consent
 CHECK(status<>'subscribed' OR consent_at IS NOT NULL);
CREATE TABLE newsletter_lists (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=80),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE newsletter_list_memberships (
 list_id uuid NOT NULL REFERENCES newsletter_lists(id),
 subscriber_id uuid NOT NULL REFERENCES newsletter_subscribers(id),
 joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(list_id,subscriber_id)
);
ALTER TABLE newsletter_campaigns ADD COLUMN list_id uuid REFERENCES newsletter_lists(id);
ALTER TABLE newsletter_campaigns ADD COLUMN approved_by uuid REFERENCES nexus_members(id);
ALTER TABLE newsletter_campaigns ADD COLUMN approved_at timestamptz;
ALTER TABLE newsletter_campaigns ADD CONSTRAINT newsletter_campaign_approval_pair
 CHECK((approved_by IS NULL)=(approved_at IS NULL));
CREATE TABLE newsletter_campaign_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES newsletter_campaigns(id),
 actor_member_id uuid NOT NULL REFERENCES nexus_members(id),
 event text NOT NULL CHECK(event IN ('queued')),
 eligible_count integer NOT NULL CHECK(eligible_count>=0),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION newsletter_lock_approved_campaign() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'draft' AND (NEW.subject,NEW.html_body,NEW.text_body,NEW.list_id)
 IS DISTINCT FROM (OLD.subject,OLD.html_body,OLD.text_body,OLD.list_id)
 THEN RAISE EXCEPTION 'approved campaign is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER newsletter_approved_campaign_immutable
 BEFORE UPDATE ON newsletter_campaigns FOR EACH ROW EXECUTE FUNCTION newsletter_lock_approved_campaign();
-- Suppress queued sends on any opt-out, bounce or complaint. A future sender
-- still MUST recheck consent immediately before contacting its provider.
CREATE FUNCTION newsletter_suppress_unsubscribed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'subscribed' THEN
  UPDATE newsletter_deliveries SET status='suppressed',updated_at=now()
  WHERE subscriber_id=NEW.id AND status='queued';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER newsletter_subscriber_suppression
 AFTER UPDATE OF status ON newsletter_subscribers FOR EACH ROW
 WHEN(NEW.status IS DISTINCT FROM OLD.status)
 EXECUTE FUNCTION newsletter_suppress_unsubscribed();
CREATE FUNCTION newsletter_campaign_preview(p_issuer text,p_subject text,p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_list uuid;v_status text;v_count integer;
BEGIN
 IF nexus_operations_actor(p_issuer,p_subject) IS NULL THEN
  RAISE EXCEPTION 'staff only' USING ERRCODE='42501'; END IF;
 SELECT c.list_id,c.status INTO v_list,v_status FROM newsletter_campaigns c WHERE c.id=p_campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE='P0002'; END IF;
 SELECT count(*)::integer INTO v_count FROM newsletter_list_memberships m
 JOIN newsletter_subscribers s ON s.id=m.subscriber_id
 WHERE m.list_id=v_list AND s.status='subscribed' AND s.consent_at IS NOT NULL;
 RETURN jsonb_build_object('status',v_status,'eligibleRecipients',v_count,
  'readyToQueue',v_status='draft' AND v_list IS NOT NULL AND v_count>0);
END $$;
CREATE FUNCTION newsletter_campaign_queue(p_issuer text,p_subject text,p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_actor uuid;v_campaign newsletter_campaigns%ROWTYPE;v_count integer;
BEGIN
 v_actor=nexus_operations_actor(p_issuer,p_subject);
 IF v_actor IS NULL THEN RAISE EXCEPTION 'staff only' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_campaign FROM newsletter_campaigns WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE='P0002'; END IF;
 IF v_campaign.status<>'draft' OR v_campaign.list_id IS NULL OR
    length(btrim(v_campaign.subject)) NOT BETWEEN 1 AND 180 OR
    length(btrim(v_campaign.text_body))<1 OR length(btrim(v_campaign.html_body))<1
 THEN RAISE EXCEPTION 'campaign not ready' USING ERRCODE='22023'; END IF;
 INSERT INTO newsletter_deliveries(campaign_id,subscriber_id,status)
 SELECT p_campaign,m.subscriber_id,'queued' FROM newsletter_list_memberships m
 JOIN newsletter_subscribers s ON s.id=m.subscriber_id
 WHERE m.list_id=v_campaign.list_id AND s.status='subscribed' AND s.consent_at IS NOT NULL
 ON CONFLICT(campaign_id,subscriber_id) DO NOTHING;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<1 THEN RAISE EXCEPTION 'no consented recipients' USING ERRCODE='22023'; END IF;
 UPDATE newsletter_campaigns SET status='queued',approved_by=v_actor,approved_at=now() WHERE id=p_campaign;
 INSERT INTO newsletter_campaign_audit(campaign_id,actor_member_id,event,eligible_count)
 VALUES(p_campaign,v_actor,'queued',v_count);
 RETURN jsonb_build_object('status','queued','recipients',v_count);
END $$;
