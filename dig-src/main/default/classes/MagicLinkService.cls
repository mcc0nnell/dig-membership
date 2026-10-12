public with sharing class MagicLinkService {
    private static final Integer DEFAULT_TTL_MINUTES = 30;
    private static final Integer DEFAULT_TOKEN_BYTES = 32;
    private static final Integer MAX_PURPOSE_LENGTH = 40;
    private static final String DEFAULT_PURPOSE = 'login';
    private static final String GENERIC_REQUEST_MESSAGE = 'If that email exists, a link has been sent.';
    private static final String DEFAULT_REDIRECT_PATH = '/me';
    private static final String DEFAULT_EMAIL_SUBJECT = 'Your DIG sign-in link';
    private static final String DEFAULT_EMAIL_BODY =
        'Use this one-time sign-in link:\n\n{{MAGIC_LINK_URL}}';
    private static final String MAGIC_LINK_URL_PLACEHOLDER = '{{MAGIC_LINK_URL}}';
    private static final String MAGIC_LINK_TEMPLATE_DEVELOPER_NAME = 'DIG_Portal_Magic_Link';

    private static final String WELCOME_TEMPLATE_DEVELOPER_NAME = 'DIG_Portal_Welcome';
    private static final String DEFAULT_WELCOME_SUBJECT = 'Welcome to DIG!';
    private static final String DEFAULT_WELCOME_BODY =
        'Welcome to DIG!\n\nYour membership is now active. Sign in to the portal to get started:\n\n{{PORTAL_BASE_URL}}/me';

    @TestVisible
    private static Integer throttleWindowSeconds = 60;

    @TestVisible
    private static String lastIssuedTokenForTest;

    @TestVisible
    private static Boolean forceContactEnsureFailureForTest = false;

    @TestVisible
    private static Boolean suppressWelcomeEmailForTest = false;

    public class MagicLinkIssueResult {
        public Boolean ok;
        public Boolean throttled;
        public String message;
        public Datetime expiresAt;
    }

    public class MagicLinkResult {
        public Boolean ok;
        public String message;
    }

    public class EnsureMembershipResult {
        @AuraEnabled public Id contactId;
        @AuraEnabled public String membershipStatus;
        @AuraEnabled public Datetime membershipEnd;
        @AuraEnabled public Boolean changed;
    }

    private class EmailContent {
        public String subject;
        public String plainTextBody;
    }

    private class Config {
        public String portalBaseUrl;
        public String websiteBaseUrl;
        public Integer ttlMinutes;
        public String orgWideEmailAddressId;
    }

    public static MagicLinkIssueResult issue(
        String email,
        String purpose,
        String redirectPath,
        String requestIp,
        String userAgent,
        String firstName,
        String lastName
    ) {
        MagicLinkIssueResult result = initIssueResult();
        String normalizedEmail = normalizeEmail(email);
        String normalizedPurpose = normalizePurpose(purpose);
        if (String.isBlank(normalizedPurpose)) {
            normalizedPurpose = DEFAULT_PURPOSE;
        }
        String safeRedirectPath = sanitizeRedirectPath(redirectPath);

        Datetime nowAt = System.now();
        Datetime existingExpiry = activeExpiry(normalizedEmail, normalizedPurpose, nowAt);
        if (existingExpiry != null) {
            result.throttled = true;
            result.expiresAt = existingExpiry;
            return result;
        }

        if (String.isBlank(normalizedEmail)) {
            return result;
        }

        Config config = loadConfig();
        if (normalizedPurpose == 'web-join') {
            // Fail closed before issuing a link if the website domain is not configured.
            if (String.isBlank(config.websiteBaseUrl)
                || !config.websiteBaseUrl.startsWith('https://')) {
                throw new CalloutException('Website membership URL must be configured over HTTPS.');
            }
            if (String.isBlank(lastName) || lastName.trim().length() > 80
                || (!String.isBlank(firstName) && firstName.trim().length() > 40)) {
                throw new CalloutException('Website membership name is invalid.');
            }
        }
        // Idempotency policy: invalidate prior active tokens before creating a new one.
        invalidateActiveLinks(normalizedEmail, normalizedPurpose, nowAt);

        String rawToken = newTokenUrlSafe(DEFAULT_TOKEN_BYTES);
        String tokenHash = sha256Hex(rawToken);
        Datetime expiresAt = nowAt.addMinutes(config.ttlMinutes);

        Id contactId = lookupContactIdByEmail(normalizedEmail);

        try {
            String targetBaseUrl = config.portalBaseUrl;
            if (normalizedPurpose == 'web-join') {
                if (String.isBlank(config.websiteBaseUrl)
                    || !config.websiteBaseUrl.startsWith('https://')) {
                    throw new CalloutException('Website membership URL must be configured over HTTPS.');
                }
                targetBaseUrl = config.websiteBaseUrl;
            }
            String linkUrl = buildMagicUrl(targetBaseUrl, rawToken, normalizedPurpose, safeRedirectPath);

            Magic_Link__c magicLink = new Magic_Link__c(
                Email__c = normalizedEmail,
                Purpose__c = normalizedPurpose,
                Token_Hash__c = tokenHash,
                Expires_At__c = expiresAt,
                Contact__c = contactId,
                Redirect_Path__c = safeRedirectPath,
                Magic_Link_URL__c = linkUrl,
                Requested_At__c = nowAt,
                Request_IP__c = trimToLength(requestIp, 64),
                Request_UserAgent__c = trimToLength(userAgent, 255),
                Active_Key__c = buildActiveKey(normalizedEmail, normalizedPurpose),
                Website_First_Name__c = normalizedPurpose == 'web-join' ? trimToLength(firstName, 40) : null,
                Website_Last_Name__c = normalizedPurpose == 'web-join' ? trimToLength(lastName, 80) : null
            );
            insert magicLink;

            if (Test.isRunningTest()) {
                lastIssuedTokenForTest = rawToken;
            }

            sendMagicLinkEmail(normalizedEmail, linkUrl, config);
            result.expiresAt = expiresAt;
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'MAGIC_REQ_FAIL: ' + e.getTypeName() + ': ' + e.getMessage());
        }
        return result;
    }

    // Backwards-compatible overload used by the existing portal integrations.
    public static MagicLinkIssueResult issue(
        String email, String purpose, String redirectPath,
        String requestIp, String userAgent
    ) {
        return issue(email, purpose, redirectPath, requestIp, userAgent, null, null);
    }

    public static MagicLinkIssueResult issue(String email, String purpose, String redirectPath) {
        return issue(email, purpose, redirectPath, null, null);
    }

    public static MagicLinkResult requestMagicLink(
        String email,
        String purpose,
        String redirectPath,
        String requestIp,
        String userAgent
    ) {
        MagicLinkIssueResult issueResult = issue(email, purpose, redirectPath, requestIp, userAgent);
        MagicLinkResult result = new MagicLinkResult();
        result.ok = issueResult.ok;
        result.message = issueResult.message;
        return result;
    }

    /**
     * Returns the Expires_At__c of an existing unexpired link issued within the
     * throttle window, or null if no such link exists (meaning the caller should
     * proceed to create a new one).
     */
    @TestVisible
    private static Datetime activeExpiry(String normalizedEmail, String normalizedPurpose, Datetime nowAt) {
        if (String.isBlank(normalizedEmail) || String.isBlank(normalizedPurpose)) {
            return null;
        }
        if (throttleWindowSeconds == null || throttleWindowSeconds <= 0) {
            return null;
        }
        Datetime windowStart = nowAt.addSeconds(-throttleWindowSeconds);
        List<Magic_Link__c> recent = [
            SELECT Expires_At__c
            FROM Magic_Link__c
            WHERE Email__c = :normalizedEmail
                AND Purpose__c = :normalizedPurpose
                AND Used_At__c = null
                AND Expires_At__c >= :nowAt
                AND (
                    Requested_At__c >= :windowStart
                    OR (Requested_At__c = null AND CreatedDate >= :windowStart)
                )
            ORDER BY Expires_At__c DESC
            LIMIT 1
        ];
        return recent.isEmpty() ? null : recent[0].Expires_At__c;
    }

    @TestVisible
    private static void invalidateActiveLinks(String normalizedEmail, String normalizedPurpose, Datetime nowAt) {
        List<Magic_Link__c> activeLinks = [
            SELECT Id, Used_At__c
            FROM Magic_Link__c
            WHERE Email__c = :normalizedEmail
                AND Purpose__c = :normalizedPurpose
                AND Used_At__c = null
                AND Expires_At__c >= :nowAt
        ];
        if (activeLinks.isEmpty()) {
            return;
        }

        for (Magic_Link__c link : activeLinks) {
            link.Used_At__c = nowAt;
        }
        update activeLinks;
    }

    @TestVisible
    private static Id lookupContactIdByEmail(String normalizedEmail) {
        if (String.isBlank(normalizedEmail)) {
            return null;
        }
        try {
            List<Contact> contacts = [
                SELECT Id
                FROM Contact
                WHERE Email = :normalizedEmail
                ORDER BY LastModifiedDate DESC
                LIMIT 1
            ];
            return contacts.isEmpty() ? null : contacts[0].Id;
        } catch (Exception ignored) {
            return null;
        }
    }

    @TestVisible
    private static void sendMagicLinkEmail(
        String normalizedEmail,
        String linkUrl,
        Config config
    ) {
        EmailContent content = resolveMagicEmailContent(linkUrl);

        Messaging.SingleEmailMessage msg = new Messaging.SingleEmailMessage();
        msg.setToAddresses(new String[] { normalizedEmail });
        msg.setSubject(content.subject);
        msg.setPlainTextBody(content.plainTextBody);
        msg.setSaveAsActivity(false);

        if (canUseOrgWideEmailAddress(config.orgWideEmailAddressId)) {
            msg.setOrgWideEmailAddressId(config.orgWideEmailAddressId);
        }

        Messaging.sendEmail(new Messaging.SingleEmailMessage[] { msg }, false);
    }

    public static void sendWelcomeEmail(String email, Id contactId) {
        if (Test.isRunningTest() && suppressWelcomeEmailForTest) {
            return;
        }
        if (String.isBlank(email)) {
            return;
        }

        Config config = loadConfig();
        String subject = DEFAULT_WELCOME_SUBJECT;
        String body = DEFAULT_WELCOME_BODY.replace('{{PORTAL_BASE_URL}}', normalizeBaseUrl(config.portalBaseUrl));

        try {
            List<EmailTemplate> templates = [
                SELECT Subject, Body, HtmlValue
                FROM EmailTemplate
                WHERE DeveloperName = :WELCOME_TEMPLATE_DEVELOPER_NAME
                LIMIT 1
            ];
            if (!templates.isEmpty()) {
                EmailTemplate tpl = templates[0];
                if (!String.isBlank(tpl.Subject)) {
                    subject = tpl.Subject;
                }
                String tplBody = null;
                if (!String.isBlank(tpl.HtmlValue)) {
                    tplBody = tpl.HtmlValue;
                } else if (!String.isBlank(tpl.Body)) {
                    String bodyCheck = tpl.Body.trim().toLowerCase();
                    if (bodyCheck != 'true' && bodyCheck != 'false') {
                        tplBody = tpl.Body;
                    }
                }
                if (!String.isBlank(tplBody)) {
                    body = tplBody;
                }
            }
        } catch (Exception ignored) {
            // Fall back to default subject/body when template is unavailable.
        }

        Messaging.SingleEmailMessage msg = new Messaging.SingleEmailMessage();
        msg.setToAddresses(new String[] { email });
        msg.setSubject(subject);
        msg.setPlainTextBody(body);
        msg.setSaveAsActivity(false);
        if (canUseOrgWideEmailAddress(config.orgWideEmailAddressId)) {
            msg.setOrgWideEmailAddressId(config.orgWideEmailAddressId);
        }
        Messaging.sendEmail(new Messaging.SingleEmailMessage[] { msg }, false);
    }

    @TestVisible
    private static EmailContent resolveMagicEmailContent(String linkUrl) {
        EmailContent content = new EmailContent();
        content.subject = DEFAULT_EMAIL_SUBJECT;
        content.plainTextBody = DEFAULT_EMAIL_BODY.replace(MAGIC_LINK_URL_PLACEHOLDER, linkUrl);

        try {
            List<EmailTemplate> templates = [
                SELECT Subject, Body, HtmlValue
                FROM EmailTemplate
                WHERE DeveloperName = :MAGIC_LINK_TEMPLATE_DEVELOPER_NAME
                LIMIT 1
            ];
            if (!templates.isEmpty()) {
                EmailTemplate tpl = templates[0];
                if (!String.isBlank(tpl.Subject)) {
                    content.subject = tpl.Subject;
                }
                String templateBody = null;
                if (!String.isBlank(tpl.HtmlValue)) {
                    templateBody = tpl.HtmlValue;
                } else if (!String.isBlank(tpl.Body)) {
                    String bodyValue = tpl.Body.trim().toLowerCase();
                    if (bodyValue != 'true' && bodyValue != 'false') {
                        templateBody = tpl.Body;
                    }
                }
                if (!String.isBlank(templateBody)) {
                    if (templateBody.contains(MAGIC_LINK_URL_PLACEHOLDER)) {
                        content.plainTextBody = templateBody.replace(MAGIC_LINK_URL_PLACEHOLDER, linkUrl);
                    } else {
                        content.plainTextBody = templateBody + '\n\n' + linkUrl;
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall back to default subject/body when template is unavailable.
        }

        return content;
    }

    @TestVisible
    private static String buildMagicUrl(String portalBaseUrl, String rawToken, String purpose, String redirectPath) {
        String base = normalizeBaseUrl(portalBaseUrl);
        // Website joins use a fragment so the bearer token is never sent to
        // WordPress, its access logs, or an intermediate cache. Legacy portal
        // magic-link paths keep their existing query string for compatibility.
        String tokenSeparator = purpose == 'web-join' ? '/magic#t=' : '/magic?t=';
        String url = base
            + tokenSeparator
            + EncodingUtil.urlEncode(rawToken, 'UTF-8')
            + '&p='
            + EncodingUtil.urlEncode(purpose, 'UTF-8');
        if (!String.isBlank(redirectPath)) {
            url += '&r=' + EncodingUtil.urlEncode(redirectPath, 'UTF-8');
        }
        return url;
    }

    @TestVisible
    private static String normalizeEmail(String email) {
        return String.isBlank(email) ? null : email.trim().toLowerCase();
    }

    public static EnsureMembershipResult ensureMembershipActive(String normalizedEmail) {
        EnsureMembershipResult result = new EnsureMembershipResult();
        result.contactId = null;
        result.membershipStatus = 'NONE';
        result.membershipEnd = null;
        result.changed = false;

        String safeEmail = normalizeEmail(normalizedEmail);
        if (String.isBlank(safeEmail)) {
            return result;
        }

        Id contactId = null;
        try {
            if (Test.isRunningTest() && forceContactEnsureFailureForTest) {
                throw new QueryException('CONTACT_ACCESS_DENIED_FOR_TEST');
            }

            List<Contact> contacts = [
                SELECT Id, Email
                FROM Contact
                WHERE Email = :safeEmail
                LIMIT 1
            ];

            if (contacts.isEmpty()) {
                Contact created = new Contact(
                    LastName = 'Member',
                    Email = safeEmail
                );
                insert created;
                contactId = created.Id;
                System.debug(LoggingLevel.INFO, 'MEMBERSHIP_ENSURE: created_contact');
            } else {
                contactId = contacts[0].Id;
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'MEMBERSHIP_ENSURE_FAIL: ' + e.getTypeName() + ': ' + e.getMessage());
            return result;
        }

        result.contactId = contactId;

        try {
            Map<String, Schema.SObjectField> membershipFields = Schema.SObjectType.Membership__c.fields.getMap();
            String startField = resolveMembershipStartField(membershipFields);
            String endField = resolveMembershipEndField(membershipFields);
            Boolean hasPaidDateField = membershipFields.containsKey('PaidDate__c');

            String soql = 'SELECT Id, Status__c, CreatedDate';
            if (startField != null) {
                soql += ', ' + startField;
            }
            if (endField != null) {
                soql += ', ' + endField;
            }
            soql += ' FROM Membership__c WHERE Contact__c = :contactId ORDER BY CreatedDate DESC LIMIT 50';

            List<SObject> memberships = Database.query(soql);
            SObject latestMembership = memberships.isEmpty() ? null : memberships[0];

            for (SObject membershipRecord : memberships) {
                if (isMembershipRecordActive(membershipRecord, endField)) {
                    result.membershipStatus = 'ACTIVE';
                    result.membershipEnd = extractMembershipEnd(membershipRecord, endField);
                    return result;
                }
            }

            SObject targetMembership = latestMembership;
            Boolean hasExistingMembership = (targetMembership != null);
            if (!hasExistingMembership) {
                targetMembership = Membership__c.SObjectType.newSObject();
                targetMembership.put('Contact__c', contactId);
            }

            Datetime nowAt = System.now();
            targetMembership.put('Status__c', 'Active');
            if (startField != null) {
                putDateOrDateTime(targetMembership, startField, nowAt);
            }
            if (endField != null) {
                putDateOrDateTime(targetMembership, endField, nowAt.addYears(1));
            }
            if (hasPaidDateField) {
                targetMembership.put('PaidDate__c', Date.today());
            }

            if (hasExistingMembership) {
                update targetMembership;
                System.debug(LoggingLevel.INFO, 'MEMBERSHIP_ENSURE: renewed_membership');
            } else {
                insert targetMembership;
                System.debug(LoggingLevel.INFO, 'MEMBERSHIP_ENSURE: activated_membership');
            }

            result.changed = true;
            result.membershipStatus = 'ACTIVE';
            if (endField != null) {
                result.membershipEnd = extractMembershipEnd(targetMembership, endField);
            }
            return result;
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'MEMBERSHIP_ENSURE_FAIL: ' + e.getTypeName() + ': ' + e.getMessage());
            result.membershipStatus = 'NONE';
            result.membershipEnd = null;
            result.changed = false;
            return result;
        }
    }

    public static String normalizePurpose(String purpose) {
        if (String.isBlank(purpose)) {
            return null;
        }
        return trimToLength(purpose.trim().toLowerCase(), MAX_PURPOSE_LENGTH);
    }

    @TestVisible
    private static String sanitizeRedirectPath(String redirectPath) {
        if (String.isBlank(redirectPath)) {
            return DEFAULT_REDIRECT_PATH;
        }
        String path = trimToLength(redirectPath.trim(), 255);
        if (String.isBlank(path)) {
            return DEFAULT_REDIRECT_PATH;
        }
        if (!path.startsWith('/')) {
            return DEFAULT_REDIRECT_PATH;
        }
        if (path.contains('://') || path.contains('\\')) {
            return DEFAULT_REDIRECT_PATH;
        }
        return path;
    }

    @TestVisible
    private static String normalizeBaseUrl(String portalBaseUrl) {
        String base = String.isBlank(portalBaseUrl) ? 'https://portal.deafingov.org' : portalBaseUrl.trim();
        while (base.endsWith('/')) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    @TestVisible
    private static Boolean isValidOrgWideEmailAddressId(String oweaId) {
        if (String.isBlank(oweaId)) {
            return false;
        }
        String trimmed = oweaId.trim();
        Integer len = trimmed.length();
        return (len == 15 || len == 18) && trimmed.startsWith('0D2');
    }

    @TestVisible
    private static Boolean canUseOrgWideEmailAddress(String oweaId) {
        if (!isValidOrgWideEmailAddressId(oweaId)) {
            return false;
        }
        try {
            List<OrgWideEmailAddress> owAddresses = [
                SELECT Id
                FROM OrgWideEmailAddress
                WHERE Id = :oweaId
                LIMIT 1
            ];
            return !owAddresses.isEmpty();
        } catch (Exception ignored) {
            return false;
        }
    }

    @TestVisible
    private static String trimToLength(String value, Integer maxLength) {
        if (String.isBlank(value)) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() <= maxLength) {
            return trimmed;
        }
        return trimmed.substring(0, maxLength);
    }

    @TestVisible
    private static String buildActiveKey(String normalizedEmail, String normalizedPurpose) {
        if (String.isBlank(normalizedEmail) || String.isBlank(normalizedPurpose)) {
            return null;
        }
        return trimToLength(normalizedEmail + '|' + normalizedPurpose, 120);
    }

    @TestVisible
    private static String resolveMembershipStartField(Map<String, Schema.SObjectField> membershipFields) {
        if (membershipFields.containsKey('Start__c')) {
            return 'Start__c';
        }
        if (membershipFields.containsKey('StartDate__c')) {
            return 'StartDate__c';
        }
        return null;
    }

    @TestVisible
    private static String resolveMembershipEndField(Map<String, Schema.SObjectField> membershipFields) {
        if (membershipFields.containsKey('End__c')) {
            return 'End__c';
        }
        if (membershipFields.containsKey('EndDate__c')) {
            return 'EndDate__c';
        }
        return null;
    }

    @TestVisible
    private static Boolean isMembershipRecordActive(SObject membershipRecord, String endField) {
        String status = (String) membershipRecord.get('Status__c');
        if (String.isBlank(status) || status.trim().toLowerCase() != 'active') {
            return false;
        }

        if (String.isBlank(endField)) {
            return true;
        }

        Object endValue = membershipRecord.get(endField);
        if (endValue == null) {
            return true;
        }
        if (endValue instanceof Date) {
            return ((Date) endValue) > System.today();
        }
        if (endValue instanceof Datetime) {
            return ((Datetime) endValue).date() > System.today();
        }
        return false;
    }

    @TestVisible
    private static Datetime extractMembershipEnd(SObject membershipRecord, String endField) {
        if (membershipRecord == null || String.isBlank(endField)) {
            return null;
        }
        Object endValue = membershipRecord.get(endField);
        if (endValue == null) {
            return null;
        }
        if (endValue instanceof Datetime) {
            return (Datetime) endValue;
        }
        if (endValue instanceof Date) {
            return Datetime.newInstance((Date) endValue, Time.newInstance(0, 0, 0, 0));
        }
        return null;
    }

    @TestVisible
    private static void putDateOrDateTime(SObject record, String fieldName, Datetime value) {
        if (record == null || String.isBlank(fieldName) || value == null) {
            return;
        }
        Schema.DisplayType fieldType = Schema.SObjectType.Membership__c.fields.getMap().get(fieldName).getDescribe().getType();
        if (fieldType == Schema.DisplayType.Date) {
            record.put(fieldName, value.date());
            return;
        }
        if (fieldType == Schema.DisplayType.DateTime) {
            record.put(fieldName, value);
        }
    }

    public static String newTokenUrlSafe(Integer bytes) {
        Integer targetBytes = (bytes == null || bytes <= 0) ? DEFAULT_TOKEN_BYTES : bytes;
        String hex = '';
        while (hex.length() < targetBytes * 2) {
            hex += EncodingUtil.convertToHex(Crypto.generateAesKey(256));
        }

        Blob randomBytes = EncodingUtil.convertFromHex(hex.substring(0, targetBytes * 2));
        String token = EncodingUtil.base64Encode(randomBytes);
        token = token.replace('+', '-').replace('/', '_').replace('=', '');
        return token;
    }

    public static String sha256Hex(String value) {
        String input = value == null ? '' : value;
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(input))).toLowerCase();
    }

    @TestVisible
    private static Config loadConfig() {
        Config config = new Config();
        config.portalBaseUrl = 'https://portal.deafingov.org';
        config.websiteBaseUrl = null;
        config.ttlMinutes = DEFAULT_TTL_MINUTES;
        config.orgWideEmailAddressId = null;

        DIG_PortalAuthConfig__mdt configMdt = DIG_PortalAuthConfig__mdt.getInstance('DEFAULT');
        if (configMdt == null) {
            for (DIG_PortalAuthConfig__mdt candidate : DIG_PortalAuthConfig__mdt.getAll().values()) {
                configMdt = candidate;
                break;
            }
        }
        if (configMdt == null) {
            return config;
        }

        if (!String.isBlank(configMdt.PortalBaseUrl__c)) {
            config.portalBaseUrl = configMdt.PortalBaseUrl__c.trim();
        }
        if (!String.isBlank(configMdt.WebsiteMembershipBaseUrl__c)) {
            config.websiteBaseUrl = configMdt.WebsiteMembershipBaseUrl__c.trim();
        }
        if (configMdt.MagicLinkTtlMinutes__c != null) {
            Integer configuredTtl = Integer.valueOf(configMdt.MagicLinkTtlMinutes__c);
            if (configuredTtl > 0) {
                config.ttlMinutes = configuredTtl;
            }
        }
        if (!String.isBlank(configMdt.OrgWideEmailAddressId__c)) {
            config.orgWideEmailAddressId = configMdt.OrgWideEmailAddressId__c.trim();
        }

        return config;
    }

    private static MagicLinkResult fail(MagicLinkResult result, String message) {
        result.ok = false;
        result.message = message;
        return result;
    }

    private static MagicLinkIssueResult initIssueResult() {
        MagicLinkIssueResult result = new MagicLinkIssueResult();
        result.ok = true;
        result.throttled = false;
        result.message = GENERIC_REQUEST_MESSAGE;
        result.expiresAt = null;
        return result;
    }
}
