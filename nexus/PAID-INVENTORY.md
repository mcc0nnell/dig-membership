# NTC paid inventory: Zeffy sells tickets, Nexus confirms admissions

**Development only, default-off, no live Zeffy synchronization.** This is an
extension to the already-merged native attendee/magic-link path, not another
checkout or payment processor. Schema `013` must be applied **after** migration 012 (constituents) and
all preceding schemas, on a disposable PostgreSQL 17 database or approved isolated Neon
staging branch.

## The two boundaries

**Zeffy owns sellable inventory.** In Zeffy, explicitly configure the campaign
**total tickets** and the **per-rate number available** for the NTC occurrence.
A hosted Zeffy ticket is not reserved when Nexus registers someone. Zeffy's
own temporary 70-minute checkout hold begins only after the buyer clicks Buy,
per Zeffy's published help center. DIG Nexus has no supported Zeffy inventory
write or atomic reservation API in this implementation. **Never claim that
Nexus `pending_payment` reserves a Zeffy ticket.**

**Nexus owns verified admission eligibility.** A new paid attendee registers
as `pending_payment` for 24 hours, not `registered`; it consumes **zero Nexus
confirmed seats**. No workshop, QR or admission entitlement exists yet.
A signed webhook or authenticated purchaser recovery always refetches payment
from the Zeffy API and checks its approved campaign, rate, buyer email, amount,
currency, online status and absence of refund/dispute. The database then locks
the event row and changes **at most one pending attendee to `registered`**
for each available place. Confirmation mail is queued only after admission.

## Paid registration states

| Nexus status | Admission? | Next action |
| --- | --- | --- |
| `pending_payment` | No | Attendee may use Zeffy; no seat held. Request expires 24 hours after creation |
| `registered` | Yes, if verified paid | QR issuance and workshops allowed; one per verified transaction |
| `waitlisted` | No | Do not pay. Organizer must first reconcile Zeffy availability |
| `paid_review` | No | Organizer manually handles capacity conflict, refund, dispute or late payment |
| `cancelled` | No | Expired or voluntarily withdrawn unpaid request |

For **free** events, the existing immediate-confirmation and FIFO waitlist
promotion behavior is unchanged.

## Expiry, concurrency and refunds

- Every new `pending_payment` record automatically schedules a deduplicated,
  fenced `conference_intent_expiry` job in the existing PostgreSQL job queue.
  The **optional** Docker `jobs` profile remains disabled. When the operator
  enables it and verifies the lease worker, expired intents are cancelled;
  they did not consume seats before expiry, so the site remains safe even if
  worker processing is delayed. An expired intent cannot receive a checkout
  link or admission without a new approved flow.
- Paid webhook reconciliation, attendee cancellations and event registrations
  use the same PostgreSQL event-row lock. If two valid purchases compete for
  the last Nexus place, **one** becomes `registered`; the other is recorded as
  paid but `paid_review`, with `capacity_conflict` in the confidential review
  queue. Nexus does **not** automatically refund or promise Zeffy stock back.
- A late Zeffy payment after an intent has expired is recorded for review,
  never silently confirmed. An attendee cancellation of an already-paid place
  is rejected pending organizer refund processing. A verified Zeffy refund or
  dispute suspends Nexus admission and enters `refund_review`, but **does not**
  automatically reopen Zeffy inventory or promote paid-event waitlisted users.
- Free-event cancellation still promotes the oldest eligible waitlisted user.
  Paid-event promotions require manual reconciliation with Zeffy's current
  configured inventory and actual processed sales.

## Before opening ticket sales

1. Have a DIG operator verify the NTC venue/event capacity, including
   organizers, complimentary places, accessible seating and safety limits.
   Allocate a **single exact paid capacity** to this Zeffy campaign or rate.
2. In Zeffy, verify the actual campaign and ticket rate, their per-date or
   per-occurrence total limits, the number of tickets allowed per purchase,
   currency, price and whether any other Zeffy ticket types consume that stock.
   In particular, NTC is multi-day: a per-date Zeffy limit does **not** by
   itself establish one conference-wide three-day capacity. Resolve this before
   selling any registrations. Group or guest checkout attribution is not yet
   supported by Nexus.
3. Ensure `nexus_events.capacity` matches the allocation, and
   `zeffy_campaign_id` / `zeffy_ticket_rate_id` / `zeffy_form_url` match the
   approved dedicated form. Migration 013 refuses unlimited, partly configured
   paid events and unsafe free-to-paid conversions with existing enrollments.
4. Prove the actual webhook/API schema in staging; exercise a paid purchase,
   duplicate/late delivery, refund, dispute, mismatched email, sold-out form,
   registration cancellation, and inaccessible QR, including two near-simultaneous
   last-seat purchases. Test actual Zeffy paid counts against Nexus rows.
5. Establish a named DIG operator and documented refund/dispute service-level
   policy for each `capacity_conflict`, `late_payment`, `refund_review` and
   `unmatched_enrollment` record. **Never imply review means the payer has a
   confirmed seat.** Verify retention and restricted review access.
6. Enable the existing Caddy/Docker runtime and independent feature flags only
   after privacy, billing, accessibility, rate-limit and incident-response
   signoff. Monitor the opt-in queue's delayed/dead tasks. No production Neon,
   Zeffy, or transactional email settings were changed by these code tests.

## Synthetic proof

- `nexus/tests/paid-inventory-integration.sql`: two unpaid intents, no capacity
  usage, payment confirms one seat, later valid purchase held for review,
  duplicate/refund/late-payment safety, cancellation restriction and expiry.
- `nexus/tests/paid-inventory-concurrency.sh`: two distinct simultaneous
  PostgreSQL connections, one paid confirmed and one paid held for review.
  Refuses anything but explicitly marked disposable localhost `dig_nexus` DB.
- Existing conference, Zeffy, magic-link, organizer and job tests still run
  against PostgreSQL 17 with migration 013.

**Known limitation:** Zeffy's campaign stock and Nexus confirmed counts do not
have an atomic cross-system lock. They must be independently configured and
compared before public sales. A successful synthetic test is not a certification
of any real Zeffy campaign, API response, or event's actual remaining seats.
