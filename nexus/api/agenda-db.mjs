// Public, read-only agenda projection. Never select attendee or accommodation data.
export function createAgendaDb(client) {
 if (!client || typeof client.query !== 'function') throw new TypeError('database client required');
 return {async getPublishedAgenda(slug) {
  const eventResult=await client.query(`
   SELECT id,slug,title,starts_at AS "startsAt",ends_at AS "endsAt",
          timezone,venue_name AS "venueName",venue_address AS "venueAddress"
   FROM nexus_events WHERE slug=$1 AND publication_status='published'`,[slug]);
  const event=eventResult.rows?.[0];
  if (!event) return null;
  const sessionResult=await client.query(`
   SELECT id,slug,title,summary,kind,track,room,
          starts_at AS "startsAt",ends_at AS "endsAt"
   FROM nexus_conference_sessions
   WHERE event_id=$1 AND published=true
   ORDER BY starts_at,room NULLS LAST,slug`,[event.id]);
  const sessions=sessionResult.rows??[];
  const byId=new Map(sessions.map(s=>[s.id,{...s,speakers:[]}]));
  if (sessions.length) {
   const speakerResult=await client.query(`
    SELECT ss.session_id AS "sessionId",s.display_name AS "displayName",s.bio,ss.role
    FROM nexus_conference_session_speakers ss
    JOIN nexus_conference_speakers s ON s.id=ss.speaker_id
    JOIN nexus_conference_sessions cs ON cs.id=ss.session_id
    WHERE cs.event_id=$1 AND cs.published=true AND s.public_profile=true
    ORDER BY ss.session_id,ss.display_order,s.display_name`,[event.id]);
   for (const speaker of speakerResult.rows??[]) {
    const {sessionId,...publicDetails}=speaker;
    byId.get(sessionId)?.speakers.push(publicDetails);
   }
  }
  const {id,...publicEvent}=event;
  return {...publicEvent,sessions:[...byId.values()].map(({id,...s})=>s)};
 }};
}
