/**
 * Membership activation for the public DIG website, never for unauthenticated form posts.
 * Invoked ONLY after MagicLinkVerifyApi has validated a one-time email token.
 * Uses Membership__c (the same term object consumed by the membership spine).
 */
public with sharing class DigWebsiteMembershipService {
    public class ActivationException extends Exception {}
    public static MagicLinkService.EnsureMembershipResult activate(
        String email, String firstName, String lastName
    ) {
        String normalizedEmail = String.isBlank(email) ? null : email.trim().toLowerCase();
        if (String.isBlank(normalizedEmail) || !normalizedEmail.contains('@')) {
            throw new ActivationException('Verified email is required.');
        }
        List<Contact> matches = [
            SELECT Id, Email FROM Contact WHERE Email = :normalizedEmail
            ORDER BY CreatedDate ASC LIMIT 2 FOR UPDATE
        ];
        // Existing duplicate Contacts require staff reconciliation; never choose arbitrarily.
        if (matches.size() > 1) {
            throw new ActivationException('Duplicate contacts require staff review.');
        }
        Contact contact;
        if (matches.isEmpty()) {
            if (String.isBlank(lastName) || lastName.trim().length() > 80
                || (!String.isBlank(firstName) && firstName.trim().length() > 40)) {
                throw new ActivationException('A valid name is required for new members.');
            }
            contact = new Contact(
                FirstName = String.isBlank(firstName) ? null : firstName.trim(),
                LastName = lastName.trim(), Email = normalizedEmail
            );
            insert contact;
        } else {
            contact = matches[0];
        }

        Date today = Date.today();
        List<Membership__c> existing = [
            SELECT Id, StartDate__c, EndDate__c, Status__c, Level__c, CancelledDate__c
            FROM Membership__c
            WHERE Contact__c = :contact.Id
            ORDER BY EndDate__c DESC NULLS LAST, CreatedDate DESC
            LIMIT 100
        ];
        // Never replace or silently downgrade an existing current membership.
        for (Membership__c term : existing) {
            if (term.CancelledDate__c == null && term.Status__c != 'Cancelled'
                && term.EndDate__c != null && term.EndDate__c >= today) {
                String existingStatus = term.StartDate__c != null && term.StartDate__c > today
                    ? 'PENDING' : term.Status__c;
                return result(contact.Id, existingStatus, term.EndDate__c, false);
            }
        }

        // Website enrollment is currently free. This policy is explicit metadata,
        // never a fake payment receipt or a synthetic PaidDate__c.
        DigOps_MembershipRules.LevelConfig level = DigOps_MembershipRules.getLevelConfig('WEBSITE_FREE');
        if (level.isPaidRequired != false || level.durationMonths == null || level.durationMonths <= 0) {
            throw new ActivationException('Free membership policy is not configured.');
        }
        Date endDate = today.addMonths(level.durationMonths).addDays(-1);
        Membership__c membership = new Membership__c(
            Contact__c = contact.Id,
            StartDate__c = today,
            EndDate__c = endDate,
            Status__c = 'Active',
            Level__c = 'WEBSITE_FREE',
            Source__c = 'Web'
        );
        insert membership; // MembershipTrigger recomputes Contact membership summary.
        return result(contact.Id, 'Active', endDate, true);
    }

    private static MagicLinkService.EnsureMembershipResult result(
        Id contactId, String status, Date endDate, Boolean changed
    ) {
        MagicLinkService.EnsureMembershipResult output = new MagicLinkService.EnsureMembershipResult();
        output.contactId = contactId;
        output.membershipStatus = String.isBlank(status) ? 'NONE' : status.toUpperCase();
        output.membershipEnd = endDate == null ? null :
            Datetime.newInstance(endDate, Time.newInstance(0, 0, 0, 0));
        output.changed = changed;
        return output;
    }
}
