/**
 * Asynchronous Salesforce confirmation. An email service failure must not
 * invalidate an already verified or activated membership transaction.
 * Failed jobs require staff investigation and a deliberate retry.
 */
public with sharing class DigMembershipWelcomeEmailJob implements Queueable {
    private Id contactId;
    private String verifiedEmail;

    public DigMembershipWelcomeEmailJob(Id contactId, String verifiedEmail) {
        this.contactId = contactId;
        this.verifiedEmail = verifiedEmail;
    }

    public void execute(QueueableContext context) {
        try {
            MagicLinkService.sendWebsiteConfirmation(verifiedEmail, contactId);
        } catch (Exception e) {
            // Do not log personal email, raw token or entire exception payload.
            System.debug(LoggingLevel.ERROR, 'DIG_WEB_CONFIRMATION_FAILED: ' + e.getTypeName());
        }
    }
}
