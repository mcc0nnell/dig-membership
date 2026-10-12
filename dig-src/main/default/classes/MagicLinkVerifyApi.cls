@RestResource(urlMapping='/v1/magic/verify')
global with sharing class MagicLinkVerifyApi {
    private static final Set<String> PORTAL_ADMIN_PERMISSION_SET_NAMES = new Set<String>{
        'DIG_Membership_Admin',
        'DIG_Ops_Membership',
        'DIG_Gov_Admin',
        'DIG_Board_Gov'
    };
    private static final Set<String> GOVERNANCE_ADMIN_PERMISSION_SET_NAMES = new Set<String>{
        'DIG_Gov_Admin',
        'DIG_Board_Gov'
    };

    global class VerifyRequest {
        public String token;
        public String purpose;
    }

    global class VerifyResponse {
        public Boolean ok;
        public String message;
        public Id contactId;
        public String membershipStatus;
        public Datetime membershipEnd;
        public String redirectPath;
        public String email;
        public Boolean isPortalAdmin;
        public Boolean governanceAdmin;
        public List<String> roles;
        public Map<String, Boolean> customPermissions;
    }

    private class AdminClaims {
        public Boolean isPortalAdmin = false;
        public Boolean governanceAdmin = false;
    }

    @HttpPost
    global static VerifyResponse verify() {
        RestResponse response = RestContext.response;
        if (response == null) {
            response = new RestResponse();
            RestContext.response = response;
        }

        VerifyRequest request = parseRequest();
        if (request == null || String.isBlank(request.token)) {
            response.statusCode = 400;
            return fail('Invalid or expired token.');
        }

        String tokenHash = MagicLinkService.sha256Hex(request.token);
        Datetime nowAt = System.now();

        List<Magic_Link__c> links = [
            SELECT Id, Email__c, Contact__c, Purpose__c, Redirect_Path__c, Used_At__c,
                Website_First_Name__c, Website_Last_Name__c
            FROM Magic_Link__c
            WHERE Token_Hash__c = :tokenHash
                AND Used_At__c = null
                AND Expires_At__c >= :nowAt
            LIMIT 1 FOR UPDATE
        ];

        if (links.isEmpty()) {
            response.statusCode = 200;
            return fail('Invalid or expired token.');
        }

        Magic_Link__c link = links[0];

        if (!String.isBlank(request.purpose)) {
            String reqPurpose = MagicLinkService.normalizePurpose(request.purpose);
            String linkPurpose = String.isBlank(link.Purpose__c) ? '' : link.Purpose__c.trim().toLowerCase();
            if (reqPurpose != linkPurpose) {
                response.statusCode = 200;
                return fail('Invalid or expired token.');
            }
        }

        // One-time-use policy: consume the token immediately on successful verification.
        link.Used_At__c = nowAt;
        update link;

        VerifyResponse ok = new VerifyResponse();
        ok.ok = true;
        ok.message = 'OK';
        ok.membershipEnd = null;

        String resolvedPurpose = MagicLinkService.normalizePurpose(request.purpose);
        if (String.isBlank(resolvedPurpose)) {
            resolvedPurpose = MagicLinkService.normalizePurpose(link.Purpose__c);
        }

        if (resolvedPurpose == 'web-join') {
            // Verified email proves control of the address; keep this separate from
            // Laravel portal sessions and never grant portal-admin privileges here.
            MagicLinkService.EnsureMembershipResult activated =
                DigWebsiteMembershipService.activate(
                    link.Email__c, link.Website_First_Name__c, link.Website_Last_Name__c
                );
            // This is an enrollment receipt, not a login or portal session.
            // Do not evaluate or return identity/admin claims on the public join path.
            ok.contactId = null;
            ok.membershipStatus = activated.membershipStatus;
            ok.membershipEnd = activated.membershipEnd;
            ok.email = null;
            ok.isPortalAdmin = false;
            ok.governanceAdmin = false;
            ok.roles = new List<String>();
            ok.customPermissions = new Map<String, Boolean>{
                'Portal_Admin' => false,
                'Gov_Admin' => false
            };
            // Membership activation must survive a confirmation-email failure.
            // This acknowledgement is never an authenticated session.
            if (activated.changed) {
                try {
                    System.enqueueJob(new DigMembershipWelcomeEmailJob(activated.contactId, link.Email__c));
                } catch (Exception emailFailure) {
                    System.debug(LoggingLevel.ERROR, 'WEB_JOIN_CONFIRMATION_FAIL: ' + emailFailure.getTypeName());
                }
            }
            ok.redirectPath = null;
            response.statusCode = 200;
            return ok;
        } else if (resolvedPurpose == 'join' || resolvedPurpose == 'renew') {
            MagicLinkService.EnsureMembershipResult ensureResult =
                MagicLinkService.ensureMembershipActive(link.Email__c);
            ok.contactId = ensureResult.contactId;
            ok.membershipStatus = String.isBlank(ensureResult.membershipStatus)
                ? 'NONE'
                : ensureResult.membershipStatus;
            ok.membershipEnd = ensureResult.membershipEnd;
            if (ensureResult.changed && resolvedPurpose == 'join') {
                MagicLinkService.sendWelcomeEmail(link.Email__c, ensureResult.contactId);
            }
        } else {
            ok.contactId = link.Contact__c;
            ok.membershipStatus = lookupMembershipStatus(link.Contact__c);
        }
        ok.email = normalizeEmail(link.Email__c);
        AdminClaims claims = resolveAdminClaims(ok.email);
        ok.isPortalAdmin = claims.isPortalAdmin;
        ok.governanceAdmin = claims.governanceAdmin;
        ok.roles = ok.isPortalAdmin ? new List<String>{ 'Portal_Admin' } : new List<String>();
        ok.customPermissions = new Map<String, Boolean>{
            'Portal_Admin' => ok.isPortalAdmin,
            'Gov_Admin' => ok.governanceAdmin
        };
        ok.redirectPath = link.Redirect_Path__c;
        response.statusCode = 200;
        return ok;
    }

    @TestVisible
    private static String lookupMembershipStatus(Id contactId) {
        if (contactId == null) {
            return 'none';
        }

        List<Membership__c> memberships = [
            SELECT Status__c
            FROM Membership__c
            WHERE Contact__c = :contactId
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];

        if (memberships.isEmpty() || String.isBlank(memberships[0].Status__c)) {
            return 'none';
        }
        return memberships[0].Status__c.trim().toLowerCase();
    }

    @TestVisible
    private static VerifyRequest parseRequest() {
        RestRequest request = RestContext.request;
        if (request == null || request.requestBody == null) {
            return null;
        }

        String body = request.requestBody.toString();
        if (String.isBlank(body)) {
            return null;
        }

        return (VerifyRequest) JSON.deserialize(body, VerifyRequest.class);
    }

    private static VerifyResponse fail(String message) {
        VerifyResponse out = new VerifyResponse();
        out.ok = false;
        out.message = message;
        out.membershipStatus = 'NONE';
        out.membershipEnd = null;
        out.redirectPath = null;
        out.contactId = null;
        out.email = null;
        out.isPortalAdmin = false;
        out.governanceAdmin = false;
        out.roles = new List<String>();
        out.customPermissions = new Map<String, Boolean>{
            'Portal_Admin' => false,
            'Gov_Admin' => false
        };
        return out;
    }

    @TestVisible
    private static String normalizeEmail(String value) {
        return String.isBlank(value) ? null : value.trim().toLowerCase();
    }

    @TestVisible
    private static AdminClaims resolveAdminClaims(String email) {
        AdminClaims claims = new AdminClaims();
        String normalized = normalizeEmail(email);
        if (normalized == null) {
            return claims;
        }

        List<User> users = [
            SELECT Id, Profile.Name, Profile.PermissionsModifyAllData
            FROM User
            WHERE IsActive = true
                AND Email = :normalized
        ];
        if (users.isEmpty()) {
            return claims;
        }

        Set<Id> userIds = new Set<Id>();
        Boolean isSystemAdmin = false;
        for (User userRecord : users) {
            userIds.add(userRecord.Id);
            if (userRecord.Profile.PermissionsModifyAllData == true) {
                isSystemAdmin = true;
            }
        }

        if (isSystemAdmin) {
            claims.isPortalAdmin = true;
            claims.governanceAdmin = true;
            return claims;
        }

        Set<String> assignedPermissionSets = new Set<String>();
        for (PermissionSetAssignment psa : [
            SELECT PermissionSet.Name
            FROM PermissionSetAssignment
            WHERE AssigneeId IN :userIds
        ]) {
            if (psa.PermissionSet != null && !String.isBlank(psa.PermissionSet.Name)) {
                assignedPermissionSets.add(psa.PermissionSet.Name);
            }
        }

        claims.isPortalAdmin = containsAny(assignedPermissionSets, PORTAL_ADMIN_PERMISSION_SET_NAMES);
        claims.governanceAdmin = containsAny(assignedPermissionSets, GOVERNANCE_ADMIN_PERMISSION_SET_NAMES);
        return claims;
    }

    private static Boolean containsAny(Set<String> source, Set<String> candidates) {
        for (String candidate : candidates) {
            if (source.contains(candidate)) {
                return true;
            }
        }
        return false;
    }
}
