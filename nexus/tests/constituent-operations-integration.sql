-- Disposable PG17 proof; rollback all synthetic identities, affiliations and campaigns.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE staff uuid;person uuid; org uuid; campaign uuid; list uuid; consented uuid; pending uuid;
 value jsonb; denied boolean; unchanged boolean;
BEGIN
 PERFORM nexus_register_verified_identity('https://id.example.invalid','dig-ops-staff','staff@example.invalid','Synthetic Staff');
 PERFORM nexus_register_verified_identity('https://id.example.invalid','dig-ops-person','person@example.invalid','Synthetic Person');
 SELECT id INTO staff FROM nexus_members WHERE email_key='staff@example.invalid';
 SELECT id INTO person FROM nexus_members WHERE email_key='person@example.invalid';
 UPDATE nexus_members SET member_status='active' WHERE id=staff;
 INSERT INTO nexus_roles(member_id,role) VALUES(staff,'officer');
 -- A member account is never automatically a mailing subscriber.
 IF EXISTS(SELECT 1 FROM newsletter_subscribers WHERE email_normalized='person@example.invalid')
 THEN RAISE EXCEPTION 'membership created marketing consent'; END IF;
 INSERT INTO nexus_constituent_organizations(name,organization_kind)
 VALUES('Synthetic Public Agency','government') RETURNING id INTO org;
 INSERT INTO nexus_constituent_affiliations(member_id,organization_id,affiliation_kind)
 VALUES(person,org,'liaison');
 INSERT INTO nexus_membership_terms(member_id,starts_on,ends_on,kind,source)
 VALUES(person,'2026-01-01','2026-12-31','annual','synthetic');
 INSERT INTO nexus_constituent_cases(member_id,owner_member_id,category,title)
 VALUES(person,staff,'membership','Synthetic membership followup');
 value=nexus_constituent_summary('https://id.example.invalid','dig-ops-staff',person);
 IF value->>'displayName'<>'Synthetic Person' OR (value->>'openCases')::int<>1 OR
 jsonb_array_length(value->'affiliations')<>1 OR jsonb_array_length(value->'membershipTerms')<>1
 THEN RAISE EXCEPTION 'constituent snapshot incorrect %',value; END IF;
 denied=false;
 BEGIN
  PERFORM nexus_constituent_summary('https://id.example.invalid','dig-ops-person',person);
 EXCEPTION WHEN insufficient_privilege THEN denied=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'constituent self-assigned officer'; END IF;
 PERFORM nexus_constituent_record_activity('https://id.example.invalid','dig-ops-staff',person,'followup','Synthetic outreach');
 IF (SELECT count(*) FROM nexus_constituent_activities WHERE member_id=person)<>1
 THEN RAISE EXCEPTION 'activity not recorded'; END IF;
 denied=false;
 BEGIN UPDATE nexus_constituent_activities SET summary='tamper' WHERE member_id=person;
 EXCEPTION WHEN insufficient_privilege THEN denied=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'activity log mutable'; END IF;
 denied=false;
 BEGIN
  PERFORM nexus_constituent_record_activity('https://id.example.invalid','dig-ops-person',person,'followup','spoof');
 EXCEPTION WHEN insufficient_privilege THEN denied=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'non-staff can write activities'; END IF;

 INSERT INTO newsletter_lists(slug,title) VALUES('synthetic-test-list','Synthetic Audience') RETURNING id INTO list;
 INSERT INTO newsletter_subscribers(email,status,source,consent_at)
 VALUES('opted@example.invalid','subscribed','synthetic-test',now()) RETURNING id INTO consented;
 INSERT INTO newsletter_subscribers(email,status,source)
 VALUES('no-consent@example.invalid','pending','synthetic-test') RETURNING id INTO pending;
 INSERT INTO newsletter_list_memberships(list_id,subscriber_id)
 VALUES(list,consented),(list,pending);
 INSERT INTO newsletter_campaigns(subject,html_body,text_body,list_id)
 VALUES('Synthetic briefing','<p>Synthetic</p>','Synthetic content',list) RETURNING id INTO campaign;
 value=newsletter_campaign_preview('https://id.example.invalid','dig-ops-staff',campaign);
 IF (value->>'eligibleRecipients')::int<>1 OR value->>'readyToQueue'<>'true'
 THEN RAISE EXCEPTION 'audience included non-consent: %',value; END IF;
 denied=false;
 BEGIN
  PERFORM newsletter_campaign_queue('https://id.example.invalid','dig-ops-person',campaign);
 EXCEPTION WHEN insufficient_privilege THEN denied=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'non-staff could queue campaign'; END IF;
 value=newsletter_campaign_queue('https://id.example.invalid','dig-ops-staff',campaign);
 IF (value->>'recipients')::int<>1 THEN RAISE EXCEPTION 'queued non-consented addresses'; END IF;
 IF (SELECT count(*) FROM newsletter_deliveries WHERE campaign_id=campaign AND status='queued')<>1
 THEN RAISE EXCEPTION 'recipient queue mismatch'; END IF;
 denied=false;
 BEGIN UPDATE newsletter_campaigns SET text_body='changed' WHERE id=campaign;
 EXCEPTION WHEN insufficient_privilege THEN denied=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'approved body mutable'; END IF;
 denied=false;
 BEGIN PERFORM newsletter_campaign_queue('https://id.example.invalid','dig-ops-staff',campaign);
 EXCEPTION WHEN invalid_parameter_value THEN denied=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'approval was not idempotent/fail-closed'; END IF;
 UPDATE newsletter_subscribers SET status='unsubscribed' WHERE id=consented;
 IF (SELECT count(*) FROM newsletter_deliveries WHERE campaign_id=campaign AND status='suppressed')<>1
 THEN RAISE EXCEPTION 'opt-out did not suppress queued delivery'; END IF;
 IF (SELECT count(*) FROM newsletter_campaign_audit WHERE campaign_id=campaign)<>1
 THEN RAISE EXCEPTION 'unexpected duplicate approval'; END IF;
END $$;
ROLLBACK;
