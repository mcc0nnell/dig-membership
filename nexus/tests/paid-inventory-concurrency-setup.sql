-- Disposable PostgreSQL fixture for independent concurrent payment confirmations.
INSERT INTO nexus_events(id,slug,title,starts_at,ends_at,capacity,registration_open,publication_status,
 ticket_price_cents,zeffy_campaign_id,zeffy_ticket_rate_id,zeffy_form_url)
VALUES('e1000000-0000-4000-8000-000000000001','paid-race-event','Paid Last Seat Race',
 '2027-04-28T09:00:00-04:00','2027-04-30T17:00:00-04:00',1,true,'published',2500,
 'e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000003',
 'https://www.zeffy.com/en-US/ticketing/synthetic-race');
SELECT nexus_conference_register('paid-race-event','https://accounts.google.com','race-paid-a','race-paid-a@fixture.invalid','Paid Race A');
SELECT nexus_conference_register('paid-race-event','https://accounts.google.com','race-paid-b','race-paid-b@fixture.invalid','Paid Race B');
