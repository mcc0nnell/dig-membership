@IsTest
private class DigMembershipEmailServiceTest {
    @IsTest static void rejectedMagicEmailDoesNotConsumeOrThrottleExistingLink() {
        Datetime nowAt = System.now();
        Magic_Link__c older = new Magic_Link__c(
            Email__c = 'roll-back@example.test',
            Purpose__c = 'login',
            Token_Hash__c = MagicLinkService.sha256Hex('older-token'),
            Expires_At__c = nowAt.addMinutes(20),
            Requested_At__c = nowAt.addMinutes(-10),
            Active_Key__c = 'roll-back@example.test|login'
        );
        insert older;
        MagicLinkService.forceMagicEmailFailureForTest = true;
        MagicLinkService.MagicLinkIssueResult result =
            MagicLinkService.issue('roll-back@example.test', 'login', '/me');
        MagicLinkService.forceMagicEmailFailureForTest = false;
        System.assertEquals(false, result.ok);
        System.assertEquals(null, result.expiresAt);
        Magic_Link__c unchanged = [
            SELECT Used_At__c FROM Magic_Link__c WHERE Id = :older.Id LIMIT 1
        ];
        System.assertEquals(null, unchanged.Used_At__c);
        System.assertEquals(1, [
            SELECT COUNT() FROM Magic_Link__c
            WHERE Email__c = 'roll-back@example.test' AND Purpose__c = 'login'
        ]);
    }

    @IsTest static void websiteReceiptUsesVerifiedContactAndHonorsOptOut() {
        Contact member = new Contact(
            LastName = 'Reader', Email = 'member@example.test', HasOptedOutOfEmail = false
        );
        Contact optedOut = new Contact(
            LastName = 'Private', Email = 'private@example.test', HasOptedOutOfEmail = true
        );
        insert new List<Contact>{member, optedOut};
        MagicLinkService.websiteBaseUrlOverrideForTest = 'https://deafingov.org';
        Test.startTest();
        MagicLinkService.sendWebsiteConfirmation('member@example.test', member.Id);
        System.assertEquals(1, Limits.getEmailInvocations());
        MagicLinkService.sendWebsiteConfirmation('other@example.test', member.Id);
        MagicLinkService.sendWebsiteConfirmation('private@example.test', optedOut.Id);
        System.assertEquals(1, Limits.getEmailInvocations());
        Test.stopTest();
    }

    @IsTest static void remindersOnlyForEligibleWebTermsAndMarkSuccess() {
        Contact seven = new Contact(LastName='Seven', Email='seven@example.test');
        Contact thirty = new Contact(LastName='Thirty', Email='thirty@example.test');
        Contact opted = new Contact(
            LastName='Opted', Email='opted@example.test', HasOptedOutOfEmail = true
        );
        insert new List<Contact>{seven, thirty, opted};
        Date nowDate = Date.today();
        Membership__c sevenTerm = new Membership__c(
            Contact__c=seven.Id, StartDate__c=nowDate.addMonths(-11),
            EndDate__c=nowDate.addDays(6),
            Level__c='WEBSITE_FREE', Source__c='Web', Status__c='Active'
        );
        Membership__c thirtyTerm = new Membership__c(
            Contact__c=thirty.Id, StartDate__c=nowDate.addMonths(-11),
            EndDate__c=nowDate.addDays(25),
            Level__c='WEBSITE_FREE', Source__c='Web', Status__c='Active'
        );
        Membership__c optedTerm = new Membership__c(
            Contact__c=opted.Id, StartDate__c=nowDate.addMonths(-11),
            EndDate__c=nowDate.addDays(6),
            Level__c='WEBSITE_FREE', Source__c='Web', Status__c='Active'
        );
        insert new List<Membership__c>{sevenTerm,thirtyTerm,optedTerm};

        Set<Id> ids = new Set<Id>{sevenTerm.Id, thirtyTerm.Id, optedTerm.Id};
        List<SObject> scope = new List<SObject>();
        for (Membership__c term : [
            SELECT Id, Contact__c, Contact__r.Email, Contact__r.HasOptedOutOfEmail,
                StartDate__c, EndDate__c, Status__c, CancelledDate__c,
                Reminder_30_Sent_At__c, Reminder_7_Sent_At__c
            FROM Membership__c WHERE Id IN :ids
        ]) scope.add(term);

        MagicLinkService.websiteBaseUrlOverrideForTest = 'https://deafingov.org';
        Test.startTest();
        new DigMembershipRenewalEmailBatch().execute(null, scope);
        System.assertEquals(1, Limits.getEmailInvocations());
        Test.stopTest();

        Map<Id, Membership__c> updated = new Map<Id, Membership__c>([
            SELECT Reminder_30_Sent_At__c, Reminder_7_Sent_At__c
            FROM Membership__c WHERE Id IN :ids
        ]);
        System.assertNotEquals(null, updated.get(sevenTerm.Id).Reminder_7_Sent_At__c);
        System.assertNotEquals(null, updated.get(thirtyTerm.Id).Reminder_30_Sent_At__c);
        System.assertEquals(null, updated.get(optedTerm.Id).Reminder_7_Sent_At__c);
    }
    @IsTest static void priorTermIsSuppressedWhenRenewedToLaterEndDate() {
        Contact person = new Contact(LastName='Renewed', Email='renewed@example.test');
        insert person;
        Membership__c prior = new Membership__c(
            Contact__c=person.Id, StartDate__c=Date.today().addMonths(-11),
            EndDate__c=Date.today().addDays(6), Status__c='Active',
            Level__c='WEBSITE_FREE', Source__c='Web'
        );
        insert prior;
        insert new Membership__c(
            Contact__c=person.Id, StartDate__c=Date.today().addDays(7),
            EndDate__c=Date.today().addDays(360), Status__c='Pending',
            Level__c='INDIVIDUAL', Source__c='Manual'
        );
        List<SObject> scope = new List<SObject>();
        for (Membership__c term : [
            SELECT Id, Contact__c, Contact__r.Email, Contact__r.HasOptedOutOfEmail,
                StartDate__c, EndDate__c, Status__c, CancelledDate__c,
                Reminder_30_Sent_At__c, Reminder_7_Sent_At__c
            FROM Membership__c WHERE Id = :prior.Id
        ]) scope.add(term);
        MagicLinkService.websiteBaseUrlOverrideForTest = 'https://deafingov.org';
        Test.startTest();
        new DigMembershipRenewalEmailBatch().execute(null, scope);
        System.assertEquals(0, Limits.getEmailInvocations());
        Test.stopTest();
    }

}
