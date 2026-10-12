@IsTest
private class DigWebsiteMembershipServiceTest {
    @IsTest static void verifyFreeEnrollmentAndIdempotence() {
        MagicLinkService.EnsureMembershipResult first =
            DigWebsiteMembershipService.activate('New-Member@example.test', 'New', 'Member');
        MagicLinkService.EnsureMembershipResult again =
            DigWebsiteMembershipService.activate('new-member@example.test', 'New', 'Member');
        System.assertEquals(true, first.changed);
        System.assertEquals(false, again.changed);
        System.assertEquals(first.contactId, again.contactId);
        List<Membership__c> terms = [
            SELECT Id, Level__c, PaidDate__c, Status__c, Source__c
            FROM Membership__c WHERE Contact__c = :first.contactId
        ];
        System.assertEquals(1, terms.size());
        System.assertEquals('WEBSITE_FREE', terms[0].Level__c);
        System.assertEquals(null, terms[0].PaidDate__c);
        System.assertEquals('Active', terms[0].Status__c);
        System.assertEquals('Web', terms[0].Source__c);
        Contact spine = [
            SELECT Is_Current_Member__c FROM Contact WHERE Id = :first.contactId
        ];
        System.assertEquals(true, spine.Is_Current_Member__c);
    }
    @IsTest static void preservesExistingPaidTerm() {
        Contact c = new Contact(LastName = 'Existing', Email = 'paid@example.test');
        insert c;
        Membership__c paid = new Membership__c(
            Contact__c = c.Id, StartDate__c = Date.today().addDays(-1),
            EndDate__c = Date.today().addDays(99), Level__c = 'INDIVIDUAL',
            PaidDate__c = Date.today(), Status__c = 'Active', Source__c = 'Manual'
        );
        insert paid;
        MagicLinkService.EnsureMembershipResult result =
            DigWebsiteMembershipService.activate('paid@example.test', 'Paid', 'Person');
        System.assertEquals(false, result.changed);
        System.assertEquals(1, [SELECT COUNT() FROM Membership__c WHERE Contact__c = :c.Id]);
    }
    @IsTest static void futureTermIsNotOverwritten() {
        Contact c = new Contact(LastName='Future', Email='future@example.test');
        insert c;
        insert new Membership__c(
            Contact__c=c.Id, StartDate__c=Date.today().addDays(10),
            EndDate__c=Date.today().addDays(375), Status__c='Pending',
            Level__c='INDIVIDUAL', Source__c='Manual'
        );
        MagicLinkService.EnsureMembershipResult result =
            DigWebsiteMembershipService.activate('future@example.test', 'Future', 'Member');
        System.assertEquals(false, result.changed);
        System.assertEquals('PENDING', result.membershipStatus);
        System.assertEquals(1, [SELECT COUNT() FROM Membership__c WHERE Contact__c=:c.Id]);
    }
    @IsTest static void duplicateContactsFailClosed() {
        insert new List<Contact>{
            new Contact(LastName='A', Email='duplicate@example.test'),
            new Contact(LastName='B', Email='duplicate@example.test')
        };
        Boolean rejected = false;
        try { DigWebsiteMembershipService.activate('duplicate@example.test', 'Duplicate', 'Person'); }
        catch (DigWebsiteMembershipService.ActivationException e) { rejected = true; }
        System.assertEquals(true, rejected);
    }
    @IsTest static void websiteMagicLinkVerifyConsumesToken() {
        String token = 'website-test-one-time-token';
        insert new Magic_Link__c(
            Email__c='website@example.test', Purpose__c='web-join',
            Token_Hash__c=MagicLinkService.sha256Hex(token),
            Expires_At__c=System.now().addMinutes(20),
            Active_Key__c='website@example.test|web-join',
            Website_First_Name__c='Website', Website_Last_Name__c='Member'
        );
        RestRequest r = new RestRequest();
        r.requestUri='/services/apexrest/v1/magic/verify';
        r.httpMethod='POST';
        r.requestBody=Blob.valueOf('{"token":"' + token + '","purpose":"web-join"}');
        RestContext.request=r;
        RestContext.response=new RestResponse();
        MagicLinkVerifyApi.VerifyResponse verified=MagicLinkVerifyApi.verify();
        System.assertEquals(true, verified.ok);
        System.assertEquals('ACTIVE', verified.membershipStatus);
        System.assertNotEquals(null, verified.membershipEnd);
        System.assertEquals(null, verified.contactId);
        System.assertEquals(null, verified.email);
        System.assertEquals(false, verified.isPortalAdmin);
        System.assertEquals(false, verified.governanceAdmin);
        System.assertEquals(0, verified.roles.size());
        System.assertEquals(false, verified.customPermissions.get('Portal_Admin'));
        System.assertEquals(false, verified.customPermissions.get('Gov_Admin'));
        MagicLinkVerifyApi.VerifyResponse replay=MagicLinkVerifyApi.verify();
        System.assertEquals(false, replay.ok);
    }
}
