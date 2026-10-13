-- DIG Nexus organizer V1. Apply after 005, to isolated staging first.
-- Only separately provisioned event staff or global admins may read/write drafts.
CREATE TABLE nexus_event_staff_assignments (
 event_id uuid NOT NULL REFERENCES nexus_events(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES nexus_members(id) ON DELETE CASCADE,
 staff_role text NOT NULL CHECK(staff_role IN ('manager','editor')),
 PRIMARY KEY(event_id,member_id)
);
-- Existing unowned speaker records are NOT automatically assigned to an event.
ALTER TABLE nexus_conference_speakers ADD COLUMN event_id uuid REFERENCES nexus_events(id);
CREATE INDEX nexus_conference_speakers_event_idx ON nexus_conference_speakers(event_id);
CREATE TABLE nexus_event_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES nexus_events(id),
 actor_member_id uuid NOT NULL REFERENCES nexus_members(id),
 action text NOT NULL,
 detail jsonb NOT NULL,
 happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nexus_event_audit_event_idx ON nexus_event_audit(event_id,happened_at DESC);
-- The application can append audit events but cannot rewrite history accidentally.
CREATE FUNCTION nexus_event_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'event audit is append-only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER nexus_event_audit_guard BEFORE UPDATE OR DELETE ON nexus_event_audit
 FOR EACH ROW EXECUTE FUNCTION nexus_event_audit_append_only();
-- Never expose organizer functions through a public SQL / PostgREST endpoint.
-- Dedicated server DB role must have only narrowly reviewed database privileges.
CREATE FUNCTION nexus_organizer_access(p_slug text,p_issuer text,p_subject text)
RETURNS TABLE(event_id uuid,actor_id uuid,staff_role text)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT e.id,m.id, CASE WHEN EXISTS(SELECT 1 FROM nexus_roles r WHERE r.member_id=m.id AND r.role='admin')
  THEN 'manager' ELSE a.staff_role END
 FROM nexus_events e JOIN nexus_external_identities i ON i.issuer=p_issuer AND i.subject=p_subject
 JOIN nexus_members m ON m.id=i.member_id
 LEFT JOIN nexus_event_staff_assignments a ON a.event_id=e.id AND a.member_id=m.id
 WHERE e.slug=p_slug AND m.member_status<>'suspended'
 AND (a.member_id IS NOT NULL OR EXISTS(SELECT 1 FROM nexus_roles r WHERE r.member_id=m.id AND r.role='admin'))
$$;

-- One query for the restricted editor. Never include attendee or accommodation records.
CREATE FUNCTION nexus_organizer_snapshot(p_slug text,p_issuer text,p_subject text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_event uuid; v_role text; v_result jsonb;
BEGIN
 SELECT a.event_id,a.staff_role INTO v_event,v_role FROM nexus_organizer_access(p_slug,p_issuer,p_subject) a;
 IF v_event IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('event',jsonb_build_object(
  'slug',e.slug,'title',e.title,'startsAt',e.starts_at,'endsAt',e.ends_at,
  'timezone',e.timezone,'venueName',e.venue_name,'publicationStatus',e.publication_status),
  'staffRole',v_role,
  'sessions',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',s.slug,'title',s.title,
   'summary',s.summary,'kind',s.kind,'track',s.track,'room',s.room,'startsAt',s.starts_at,
   'endsAt',s.ends_at,'capacity',s.capacity,'published',s.published) ORDER BY s.starts_at,s.slug)
   FROM nexus_conference_sessions s WHERE s.event_id=e.id),'[]'::jsonb),
  'speakers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',sp.id,'displayName',sp.display_name,
   'bio',sp.bio,'publicProfile',sp.public_profile) ORDER BY sp.display_name,sp.id)
   FROM nexus_conference_speakers sp WHERE sp.event_id=e.id),'[]'::jsonb),
  'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('sessionSlug',ss.slug,'speakerId',sp.id,'role',lk.role))
   FROM nexus_conference_session_speakers lk JOIN nexus_conference_sessions ss ON ss.id=lk.session_id
   JOIN nexus_conference_speakers sp ON sp.id=lk.speaker_id
   WHERE ss.event_id=e.id AND sp.event_id=e.id),'[]'::jsonb))
 INTO v_result FROM nexus_events e WHERE e.id=v_event;
 RETURN v_result;
END $$;

-- All writes are atomic, serialized by event lock, and attributed to the verified actor.
-- JSON values are untrusted; every operation is allow-listed and validated below.
CREATE FUNCTION nexus_organizer_apply(p_slug text,p_issuer text,p_subject text,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_event uuid; v_actor uuid; v_role text; v_start timestamptz; v_end timestamptz;
 v_slug text; v_uuid uuid; v_speaker uuid; v_session uuid; v_changed jsonb; v_count integer;
BEGIN
 SELECT a.event_id,a.actor_id,a.staff_role INTO v_event,v_actor,v_role FROM nexus_organizer_access(p_slug,p_issuer,p_subject) a;
 IF v_event IS NULL THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM nexus_events e WHERE e.id=v_event AND e.publication_status<>'archived' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event archived' USING ERRCODE='22023'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'invalid body' USING ERRCODE='22023'; END IF;
 IF p_action='save_session' THEN
  IF p_data->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR length(p_data->>'slug')>80 OR length(btrim(p_data->>'title')) NOT BETWEEN 1 AND 180
     OR p_data->>'kind' NOT IN ('keynote','workshop','breakout','panel','networking','plenary')
     OR length(COALESCE(p_data->>'summary',''))>4000 OR length(COALESCE(p_data->>'track',''))>100
     OR length(COALESCE(p_data->>'room',''))>100
     OR (p_data->>'capacity') IS NOT NULL AND ((p_data->>'capacity') !~ '^[0-9]{1,6}$' OR (p_data->>'capacity')::int<1)
  THEN RAISE EXCEPTION 'invalid session' USING ERRCODE='22023'; END IF;
  BEGIN
   v_start=(p_data->>'startsAt')::timestamptz; v_end=(p_data->>'endsAt')::timestamptz;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid time' USING ERRCODE='22023'; END;
  IF v_start IS NULL OR v_end IS NULL OR v_end<=v_start OR NOT EXISTS(
   SELECT 1 FROM nexus_events e WHERE e.id=v_event AND v_start>=e.starts_at AND v_end<=e.ends_at)
  THEN RAISE EXCEPTION 'session outside conference dates' USING ERRCODE='22023'; END IF;
  v_slug=p_data->>'slug';
  -- Approved live material cannot be silently altered by an editor.
  IF v_role<>'manager' AND EXISTS(SELECT 1 FROM nexus_conference_sessions
    WHERE event_id=v_event AND slug=v_slug AND published=true)
  THEN RAISE EXCEPTION 'published session requires manager' USING ERRCODE='42501'; END IF;
  INSERT INTO nexus_conference_sessions(event_id,slug,title,summary,kind,track,room,starts_at,ends_at,capacity)
   VALUES(v_event,v_slug,btrim(p_data->>'title'),COALESCE(p_data->>'summary',''),p_data->>'kind',
    NULLIF(btrim(p_data->>'track'),''),NULLIF(btrim(p_data->>'room'),''),v_start,v_end,(p_data->>'capacity')::integer)
   ON CONFLICT(event_id,slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,
   kind=excluded.kind,track=excluded.track,room=excluded.room,starts_at=excluded.starts_at,
   ends_at=excluded.ends_at,capacity=excluded.capacity;
  v_changed=jsonb_build_object('slug',v_slug);
 ELSIF p_action='set_session_publication' THEN
  IF v_role<>'manager' OR jsonb_typeof(p_data->'published')<>'boolean' THEN
   RAISE EXCEPTION 'publication requires manager' USING ERRCODE='42501'; END IF;
  UPDATE nexus_conference_sessions SET published=(p_data->>'published')::boolean
    WHERE event_id=v_event AND slug=p_data->>'slug' RETURNING id INTO v_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE='P0002'; END IF;
  v_changed=jsonb_build_object('slug',p_data->>'slug','published',p_data->'published');
 ELSIF p_action='set_event_publication' THEN
  IF v_role<>'manager' OR p_data->>'publicationStatus' NOT IN ('draft','published') THEN
   RAISE EXCEPTION 'publication requires manager' USING ERRCODE='42501'; END IF;
  UPDATE nexus_events SET publication_status=p_data->>'publicationStatus' WHERE id=v_event;
  v_changed=jsonb_build_object('publicationStatus',p_data->>'publicationStatus');
 ELSIF p_action='save_speaker' THEN
  IF length(btrim(p_data->>'displayName')) NOT BETWEEN 1 AND 120 OR length(COALESCE(p_data->>'bio',''))>4000
    OR jsonb_typeof(p_data->'publicProfile')<>'boolean' THEN
   RAISE EXCEPTION 'invalid speaker' USING ERRCODE='22023'; END IF;
  BEGIN v_uuid=(p_data->>'id')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid speaker id' USING ERRCODE='22023'; END;
  IF v_uuid IS NULL THEN RAISE EXCEPTION 'speaker id required' USING ERRCODE='22023'; END IF;
  -- Editors may write draft speaker bios, managers alone may toggle public visibility.
  IF v_role<>'manager' AND (p_data->>'publicProfile')::boolean THEN
   RAISE EXCEPTION 'public speaker requires manager' USING ERRCODE='42501'; END IF;
  IF v_role<>'manager' AND EXISTS(SELECT 1 FROM nexus_conference_speakers
     WHERE id=v_uuid AND event_id=v_event AND public_profile=true)
  THEN RAISE EXCEPTION 'published speaker requires manager' USING ERRCODE='42501'; END IF;
  INSERT INTO nexus_conference_speakers(id,event_id,display_name,bio,public_profile)
  VALUES(v_uuid,v_event,btrim(p_data->>'displayName'),COALESCE(p_data->>'bio',''),(p_data->>'publicProfile')::boolean)
  ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,
     public_profile=CASE WHEN v_role='manager' THEN excluded.public_profile ELSE nexus_conference_speakers.public_profile END
  WHERE nexus_conference_speakers.event_id=v_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'speaker belongs to another event' USING ERRCODE='42501'; END IF;
  v_changed=jsonb_build_object('speakerId',v_uuid,'publicProfile',p_data->'publicProfile');
 ELSIF p_action='set_session_speaker' THEN
  BEGIN v_speaker=(p_data->>'speakerId')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid speaker id' USING ERRCODE='22023'; END;
  SELECT id INTO v_session FROM nexus_conference_sessions WHERE event_id=v_event AND slug=p_data->>'sessionSlug';
  IF v_role<>'manager' AND EXISTS(SELECT 1 FROM nexus_conference_sessions
    WHERE id=v_session AND published=true)
  THEN RAISE EXCEPTION 'published session links require manager' USING ERRCODE='42501'; END IF;
  IF v_session IS NULL OR v_speaker IS NULL OR NOT EXISTS(SELECT 1 FROM nexus_conference_speakers WHERE id=v_speaker AND event_id=v_event)
  THEN RAISE EXCEPTION 'session or speaker not found in event' USING ERRCODE='P0002'; END IF;
  IF jsonb_typeof(p_data->'linked')<>'boolean' OR p_data->>'role' NOT IN ('presenter','moderator','facilitator')
  THEN RAISE EXCEPTION 'invalid link' USING ERRCODE='22023'; END IF;
  IF (p_data->>'linked')::boolean THEN
   INSERT INTO nexus_conference_session_speakers(session_id,speaker_id,role)
   VALUES(v_session,v_speaker,p_data->>'role') ON CONFLICT(session_id,speaker_id) DO UPDATE SET role=excluded.role;
  ELSE
   DELETE FROM nexus_conference_session_speakers WHERE session_id=v_session AND speaker_id=v_speaker;
  END IF;
  v_changed=jsonb_build_object('sessionSlug',p_data->>'sessionSlug','speakerId',v_speaker,'linked',p_data->'linked');
 ELSE
  RAISE EXCEPTION 'unknown action' USING ERRCODE='22023';
 END IF;
 INSERT INTO nexus_event_audit(event_id,actor_member_id,action,detail) VALUES(v_event,v_actor,p_action,v_changed);
 RETURN jsonb_build_object('ok',true,'change',v_changed);
END $$;
