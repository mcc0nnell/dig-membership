-- One-click and explicit unsubscribe redemption for already-issued opaque tokens.
-- Token hashes only; mailbox POST and browser confirmation both call the same
-- atomic database operation. Apply after newsletter schema 003.
CREATE FUNCTION newsletter_redeem_unsubscribe(p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_subscriber uuid;v_consumed timestamptz;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 SELECT t.subscriber_id,t.consumed_at INTO v_subscriber,v_consumed
 FROM newsletter_unsubscribe_tokens t
 WHERE t.token_hash=p_token_hash AND t.expires_at>now()
 FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF v_consumed IS NULL THEN
  UPDATE newsletter_subscribers SET status='unsubscribed',updated_at=now()
  WHERE id=v_subscriber AND status<>'unsubscribed';
  UPDATE newsletter_unsubscribe_tokens SET consumed_at=now()
  WHERE token_hash=p_token_hash AND consumed_at IS NULL;
 END IF;
 RETURN true;
END $$;

-- Atomic single-recipient claim, with an already-approved queued campaign and
-- a fresh consent check. Never reclaim status='sending': HTTP outcomes may be
-- ambiguous and automatic retries risk sending duplicates.
CREATE FUNCTION newsletter_claim_delivery() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v record;v_token text;
BEGIN
 SELECT d.campaign_id,d.subscriber_id,s.email,c.subject,c.text_body,c.html_body
 INTO v FROM newsletter_deliveries d
 JOIN newsletter_campaigns c ON c.id=d.campaign_id
 JOIN newsletter_subscribers s ON s.id=d.subscriber_id
 JOIN newsletter_list_memberships lm ON lm.subscriber_id=s.id AND lm.list_id=c.list_id
 WHERE d.status='queued' AND c.status='queued' AND c.approved_by IS NOT NULL
 AND c.approved_at IS NOT NULL AND s.status='subscribed' AND s.consent_at IS NOT NULL
 ORDER BY d.updated_at,d.campaign_id,d.subscriber_id
 FOR UPDATE OF d,s SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE newsletter_deliveries SET status='sending',attempts=attempts+1,updated_at=now()
 WHERE campaign_id=v.campaign_id AND subscriber_id=v.subscriber_id AND status='queued';
 IF NOT FOUND THEN RETURN NULL; END IF;
 v_token=encode(gen_random_bytes(32),'hex');
 INSERT INTO newsletter_unsubscribe_tokens(token_hash,subscriber_id,expires_at)
 VALUES(encode(digest(v_token,'sha256'),'hex'),v.subscriber_id,now()+interval '10 years');
 RETURN jsonb_build_object('campaignId',v.campaign_id,'subscriberId',v.subscriber_id,
  'email',v.email,'subject',v.subject,'text',v.text_body,'html',v.html_body,
  'unsubscribeToken',v_token);
END $$;

-- API acceptance is not delivery to an inbox. The name of the existing
-- 'sent' enum value reflects acknowledged MailerSend API acceptance only.
CREATE FUNCTION newsletter_acknowledge_delivery(
 p_campaign uuid,p_subscriber uuid,p_message_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF p_message_id IS NULL OR length(btrim(p_message_id)) NOT BETWEEN 1 AND 180 THEN
  RAISE EXCEPTION 'provider receipt required' USING ERRCODE='22023'; END IF;
 UPDATE newsletter_deliveries SET status='sent',provider_message_id=p_message_id,
  updated_at=now() WHERE campaign_id=p_campaign AND subscriber_id=p_subscriber
  AND status='sending' AND provider_message_id IS NULL;
 RETURN FOUND;
END $$;

-- Second consent preflight immediately before the provider request. This
-- reduces, but cannot eliminate, the gap between DB verification and remote
-- provider acceptance; provider suppression reconciliation remains required.
CREATE FUNCTION newsletter_send_preflight(p_campaign uuid,p_subscriber uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v record;
BEGIN
 SELECT d.status AS delivery_state,s.status AS subscriber_state,s.consent_at,
  c.status AS campaign_state,c.approved_at,c.approved_by,
  EXISTS(SELECT 1 FROM newsletter_list_memberships lm
   WHERE lm.list_id=c.list_id AND lm.subscriber_id=s.id) AS in_list
 INTO v FROM newsletter_deliveries d
 JOIN newsletter_subscribers s ON s.id=d.subscriber_id
 JOIN newsletter_campaigns c ON c.id=d.campaign_id
 WHERE d.campaign_id=p_campaign AND d.subscriber_id=p_subscriber
 FOR UPDATE OF d,s;
 IF NOT FOUND OR v.delivery_state<>'sending' THEN RETURN false; END IF;
 IF v.subscriber_state<>'subscribed' OR v.consent_at IS NULL OR
    v.campaign_state<>'queued' OR v.approved_at IS NULL OR
    v.approved_by IS NULL OR NOT v.in_list THEN
  UPDATE newsletter_deliveries SET status='suppressed',updated_at=now()
  WHERE campaign_id=p_campaign AND subscriber_id=p_subscriber AND status='sending';
  RETURN false;
 END IF;
 RETURN true;
END $$;
