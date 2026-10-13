-- Atomic registration boundary; execute with a database role scoped to DIG Nexus.
-- No account linking by email, no implicit consent, membership remains pending.
CREATE OR REPLACE FUNCTION nexus_register_verified_identity(
 p_issuer text, p_subject text, p_email text, p_display_name text
) RETURNS TABLE(kind text, member_id uuid)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid; v_existing_email text;
BEGIN
 IF p_issuer IS NULL OR p_issuer !~ '^https://[^[:space:]/]+' OR length(p_issuer)>512
 OR p_subject IS NULL OR length(btrim(p_subject))=0 OR length(p_subject)>512
 OR p_email IS NULL OR length(p_email)>254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 OR p_display_name IS NULL OR length(btrim(p_display_name))=0 OR length(p_display_name)>120
 THEN RAISE EXCEPTION 'invalid registration arguments' USING ERRCODE='22023'; END IF;
 -- Serialize requests for the same identity AND normalized email in this transaction.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_issuer || ':' || p_subject, 0));
 PERFORM pg_advisory_xact_lock(hashtextextended(lower(btrim(p_email)), 1));
 SELECT i.member_id, m.email_key INTO v_id, v_existing_email
 FROM nexus_external_identities i JOIN nexus_members m ON m.id=i.member_id
 WHERE i.issuer=p_issuer AND i.subject=p_subject;
 IF FOUND THEN
   IF v_existing_email<>lower(btrim(p_email)) THEN
     RETURN QUERY SELECT 'email_conflict'::text, NULL::uuid;
   ELSE
     RETURN QUERY SELECT 'existing'::text, v_id;
   END IF;
   RETURN;
 END IF;
 IF EXISTS (SELECT 1 FROM nexus_members m WHERE m.email_key=lower(btrim(p_email))) THEN
   RETURN QUERY SELECT 'email_conflict'::text, NULL::uuid; RETURN;
 END IF;
 INSERT INTO nexus_members(email,display_name) VALUES(lower(btrim(p_email)),btrim(p_display_name)) RETURNING id INTO v_id;
 INSERT INTO nexus_external_identities(issuer,subject,member_id) VALUES(p_issuer,p_subject,v_id);
 RETURN QUERY SELECT 'created'::text,v_id;
END $$;
