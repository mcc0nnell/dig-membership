-- Clean-room DIG Nexus constituent operations, applied after schema 011.
-- Member relationships are independent of consent, payment and voting.
CREATE TABLE nexus_constituent_organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 180),
 organization_kind text NOT NULL CHECK(organization_kind IN ('government','nonprofit','education','other')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(name,organization_kind)
);
CREATE TABLE nexus_constituent_affiliations (
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 organization_id uuid NOT NULL REFERENCES nexus_constituent_organizations(id),
 affiliation_kind text NOT NULL CHECK(affiliation_kind IN ('employee','liaison','volunteer','other')),
 starts_on date,ends_on date,
 PRIMARY KEY(member_id,organization_id,affiliation_kind),
 CHECK(ends_on IS NULL OR starts_on IS NOT NULL AND ends_on>=starts_on)
);
CREATE TABLE nexus_constituent_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 owner_member_id uuid NOT NULL REFERENCES nexus_members(id),
 category text NOT NULL CHECK(category IN ('membership','governance','administrative','general')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','in_progress','closed')),
 opened_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nexus_constituent_cases_member_idx ON nexus_constituent_cases(member_id,state,updated_at DESC);
CREATE TABLE nexus_constituent_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES nexus_members(id),
 actor_id uuid NOT NULL REFERENCES nexus_members(id),
 action text NOT NULL CHECK(action IN ('followup','phone','meeting','case_note')),
 summary text NOT NULL CHECK(length(btrim(summary)) BETWEEN 1 AND 1000),
 happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nexus_constituent_activities_member_idx ON nexus_constituent_activities(member_id,happened_at DESC);
CREATE FUNCTION nexus_constituent_immutable_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'constituent activity is append only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER nexus_constituent_activity_immutable BEFORE UPDATE OR DELETE ON nexus_constituent_activities
 FOR EACH ROW EXECUTE FUNCTION nexus_constituent_immutable_activity();
CREATE FUNCTION nexus_operations_actor(p_issuer text,p_subject text)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT m.id FROM nexus_external_identities i JOIN nexus_members m ON m.id=i.member_id
 WHERE i.issuer=p_issuer AND i.subject=p_subject AND m.member_status='active'
 AND EXISTS(SELECT 1 FROM nexus_roles r WHERE r.member_id=m.id AND r.role IN ('admin','officer'))
 LIMIT 1
$$;
CREATE FUNCTION nexus_constituent_summary(p_issuer text,p_subject text,p_member uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_actor uuid;v_result jsonb;
BEGIN
 v_actor=nexus_operations_actor(p_issuer,p_subject);
 IF v_actor IS NULL THEN RAISE EXCEPTION 'staff only' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('id',m.id,'displayName',m.display_name,'agency',m.agency,
  'memberStatus',m.member_status,
  'membershipTerms',COALESCE((SELECT jsonb_agg(jsonb_build_object('startsOn',t.starts_on,
   'endsOn',t.ends_on,'kind',t.kind) ORDER BY t.ends_on DESC)
   FROM nexus_membership_terms t WHERE t.member_id=m.id),'[]'::jsonb),
  'committees',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',c.name,'position',cm.position))
   FROM nexus_committee_members cm JOIN nexus_committees c ON c.id=cm.committee_id
   WHERE cm.member_id=m.id),'[]'::jsonb),
  'affiliations',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',o.name,'kind',a.affiliation_kind))
   FROM nexus_constituent_affiliations a JOIN nexus_constituent_organizations o ON o.id=a.organization_id
   WHERE a.member_id=m.id),'[]'::jsonb),
  'openCases',(SELECT count(*) FROM nexus_constituent_cases c WHERE c.member_id=m.id AND c.state<>'closed'),
  'activities',(SELECT count(*) FROM nexus_constituent_activities a WHERE a.member_id=m.id))
 INTO v_result FROM nexus_members m WHERE m.id=p_member;
 RETURN v_result;
END $$;
CREATE FUNCTION nexus_constituent_record_activity(p_issuer text,p_subject text,p_member uuid,p_action text,p_summary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_actor uuid;v_new uuid;
BEGIN
 v_actor=nexus_operations_actor(p_issuer,p_subject);
 IF v_actor IS NULL THEN RAISE EXCEPTION 'staff only' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('followup','phone','meeting','case_note') OR length(btrim(p_summary)) NOT BETWEEN 1 AND 1000
 THEN RAISE EXCEPTION 'invalid staff activity' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nexus_members WHERE id=p_member)
 THEN RAISE EXCEPTION 'constituent not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO nexus_constituent_activities(member_id,actor_id,action,summary)
 VALUES(p_member,v_actor,p_action,btrim(p_summary)) RETURNING id INTO v_new;
 RETURN jsonb_build_object('recorded',true,'id',v_new);
END $$;
