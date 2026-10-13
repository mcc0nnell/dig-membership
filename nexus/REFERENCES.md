# Upstream patterns reviewed

Reference implementations, not copied code:
- CiviCRM: https://github.com/civicrm/civicrm-core — separate contact identity, membership lifecycle and payments.
- listmonk: https://github.com/knadh/listmonk — separate subscriber/list subscription state and campaign workflows.
- pretix: https://github.com/pretix/pretix — check-in eligibility, duplicate redemption and event ticket state.
- OpenSlides: https://github.com/OpenSlides/OpenSlides — governance and voting services separated from general member CRUD.

## DIG decisions
1. `nexus_members` represents identity. `nexus_membership_terms` represents paid/complimentary membership periods.
2. `nexus_communication_preferences` is independent of membership status. Newsletter delivery must also check provider suppressions.
3. Elections require explicit voter roll eligibility; terms alone never authorize a ballot. Ballot secrecy remains out of scope.
4. Check-in uses one unique record per registration. Server must authenticate staff and perform atomic checks.
5. Do not migrate existing newsletter_subscribers into member preferences automatically; reconcile email identity and consent explicitly.
6. Treat the old `nexus_members.member_status` as transitional; do not drop it until data and API migration are tested.

No upstream source code has been copied. Review licenses before reusing any implementation.
