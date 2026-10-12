/**
 * Optional, staff-scheduled renewal reminders for WEBSITE_FREE web memberships only.
 * No schedule is installed automatically. Each batch scope must be <=25 recipients.
 * Sending results are checked individually; only successful sends mark a term.
 * Unmarked eligible terms can be retried on a later daily execution.
 */
public with sharing class DigMembershipRenewalEmailBatch implements Database.Batchable<SObject> {
    public class InvalidBatchSizeException extends Exception {}

    public Database.QueryLocator start(Database.BatchableContext context) {
        Date today = Date.today();
        Date maxDate = today.addDays(30);
        return Database.getQueryLocator([
            SELECT Id, Contact__c, Contact__r.Email, Contact__r.HasOptedOutOfEmail,
                StartDate__c, EndDate__c, Status__c, CancelledDate__c,
                Reminder_30_Sent_At__c, Reminder_7_Sent_At__c
            FROM Membership__c
            WHERE Level__c = 'WEBSITE_FREE' AND Source__c = 'Web'
                AND Status__c = 'Active' AND CancelledDate__c = null
                AND EndDate__c >= :today AND EndDate__c <= :maxDate
                AND Contact__r.Email != null AND Contact__r.HasOptedOutOfEmail = false
                AND (Reminder_30_Sent_At__c = null OR Reminder_7_Sent_At__c = null)
            ORDER BY EndDate__c ASC, Id ASC
        ]);
    }

    public void execute(Database.BatchableContext context, List<SObject> scope) {
        if (scope.isEmpty()) return;
        if (scope.size() > 25) {
            throw new InvalidBatchSizeException('Run with Database.executeBatch(job, 25)');
        }

        Date today = Date.today();
        // Re-read under row lock: two operator-triggered batches must not mail
        // the same term because their original query locators were stale.
        Set<Id> scopeIds = new Set<Id>();
        for (SObject record : scope) scopeIds.add(record.Id);
        List<Membership__c> lockedTerms = [
            SELECT Id, Contact__c, Contact__r.Email, Contact__r.HasOptedOutOfEmail,
                StartDate__c, EndDate__c, Status__c, CancelledDate__c,
                Reminder_30_Sent_At__c, Reminder_7_Sent_At__c
            FROM Membership__c WHERE Id IN :scopeIds FOR UPDATE
        ];
        Set<Id> contactIds = new Set<Id>();
        for (Membership__c item : lockedTerms) {
            if (item.Contact__c != null) contactIds.add(item.Contact__c);
        }
        // Protect existing renewals: do not remind if there is a later valid term.
        // A tie picks the same deterministic term regardless of batch boundaries.
        Map<Id, Id> latestTermByContact = new Map<Id, Id>();
        for (Membership__c term : [
            SELECT Id, Contact__c, EndDate__c
            FROM Membership__c
            WHERE Contact__c IN :contactIds
                AND CancelledDate__c = null AND Status__c != 'Cancelled'
                AND EndDate__c >= :today
            ORDER BY EndDate__c DESC, CreatedDate DESC, Id DESC
        ]) {
            if (!latestTermByContact.containsKey(term.Contact__c)) {
                latestTermByContact.put(term.Contact__c, term.Id);
            }
        }

        List<Messaging.Email> messages = new List<Messaging.Email>();
        List<Membership__c> selected = new List<Membership__c>();
        List<Integer> windows = new List<Integer>();
        for (Membership__c term : lockedTerms) {
            if (term.Contact__c == null || latestTermByContact.get(term.Contact__c) != term.Id
                || term.StartDate__c == null || term.StartDate__c > today
                || term.Contact__r.HasOptedOutOfEmail || String.isBlank(term.Contact__r.Email)) continue;
            Integer daysLeft = today.daysBetween(term.EndDate__c);
            Integer window = null;
            if (daysLeft >= 0 && daysLeft <= 7 && term.Reminder_7_Sent_At__c == null) {
                window = 7;
            } else if (daysLeft > 7 && daysLeft <= 30 && term.Reminder_30_Sent_At__c == null) {
                window = 30;
            }
            if (window == null) continue;
            messages.add(MagicLinkService.renewalReminder(term.Contact__c, term.EndDate__c, window));
            selected.add(term);
            windows.add(window);
        }
        if (messages.isEmpty()) return;

        Messaging.SendEmailResult[] results;
        try {
            results = Messaging.sendEmail(messages, false);
        } catch (Exception e) {
            // The next scheduled run retries still-unmarked terms. Never log member PII.
            System.debug(LoggingLevel.ERROR, 'DIG_RENEWAL_EMAIL_SEND_FAILURE: ' + e.getTypeName());
            return;
        }
        if (results.size() != selected.size()) {
            System.debug(LoggingLevel.ERROR, 'DIG_RENEWAL_EMAIL_RESULT_MISMATCH');
            return;
        }

        List<Membership__c> delivered = new List<Membership__c>();
        for (Integer i = 0; i < selected.size(); i++) {
            if (!results[i].isSuccess()) continue;
            Membership__c updateTerm = new Membership__c(Id = selected[i].Id);
            if (windows[i] == 7) updateTerm.Reminder_7_Sent_At__c = System.now();
            else updateTerm.Reminder_30_Sent_At__c = System.now();
            delivered.add(updateTerm);
        }
        if (!delivered.isEmpty()) {
            Database.SaveResult[] saved = Database.update(delivered, false);
            for (Database.SaveResult result : saved) {
                if (!result.isSuccess()) {
                    // The email may have been accepted already; staff must reconcile
                    // the Salesforce email log before manually retrying this row.
                    System.debug(LoggingLevel.ERROR, 'DIG_RENEWAL_EMAIL_MARKER_FAILURE');
                }
            }
        }
    }

    public void finish(Database.BatchableContext context) {}
}
