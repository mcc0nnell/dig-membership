/** Installed only by a DIG admin after the pilot and quota checks. */
global with sharing class DigMembershipRenewalEmailScheduler implements Schedulable {
    global void execute(SchedulableContext context) {
        Database.executeBatch(new DigMembershipRenewalEmailBatch(), 25);
    }
}
