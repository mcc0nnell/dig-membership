public class DigOps_MembershipService {
    public static Boolean isRecomputeRunning = false;

    public static void recompute(Set<Id> contactIds) {
        if (contactIds == null || contactIds.isEmpty()) {
            return;
        }
        if (isRecomputeRunning) {
            return;
        }
        isRecomputeRunning = true;
        try {
            Date today = Date.today();
            DigOps_MembershipRules.Policy policy = DigOps_MembershipRules.getPolicy();

            Map<Id, Contact> contacts = new Map<Id, Contact>([
                SELECT Id, Is_Current_Member__c, Membership_Status_Summary__c, Current_Membership_Level__c,
                    Membership_End_Date__c, Member_Since__c, Membership_Last_Paid_Date__c
                FROM Contact
                WHERE Id IN :contactIds
            ]);

            List<Membership__c> memberships = [
                SELECT Id, Contact__c, StartDate__c, EndDate__c, Status__c, Level__c,
                    PaidDate__c, CancelledDate__c
                FROM Membership__c
                WHERE Contact__c IN :contactIds
            ];

            Map<Id, List<Membership__c>> membershipsByContact = new Map<Id, List<Membership__c>>();
            for (Membership__c membership : memberships) {
                if (!membershipsByContact.containsKey(membership.Contact__c)) {
                    membershipsByContact.put(membership.Contact__c, new List<Membership__c>());
                }
                membershipsByContact.get(membership.Contact__c).add(membership);
            }

            List<Contact> contactsToUpdate = new List<Contact>();
            List<Membership__c> membershipsToUpdate = new List<Membership__c>();

            for (Id contactId : contacts.keySet()) {
                Contact contact = contacts.get(contactId);
                List<Membership__c> contactMemberships = membershipsByContact.get(contactId);

                Membership__c currentTerm = null;
                Date earliestStart = null;
                Date latestPaid = null;

                if (contactMemberships != null) {
                    for (Membership__c membership : contactMemberships) {
                        Boolean isCancelled = isCancelled(membership);
                        if (!isCancelled) {
                            if (membership.StartDate__c != null) {
                                if (earliestStart == null || membership.StartDate__c < earliestStart) {
                                    earliestStart = membership.StartDate__c;
                                }
                            }
                            if (membership.EndDate__c != null) {
                                if (currentTerm == null || membership.EndDate__c > currentTerm.EndDate__c) {
                                    currentTerm = membership;
                                }
                            }
                        }
                        if (membership.PaidDate__c != null) {
                            if (latestPaid == null || membership.PaidDate__c > latestPaid) {
                                latestPaid = membership.PaidDate__c;
                            }
                        }
                    }
                }

                String computedStatus = null;
                String summaryStatus = 'None';
                Boolean isCurrentMember = false;
                String currentLevel = null;
                Date endDate = null;
                Date memberSince = null;

                if (currentTerm != null) {
                    DigOps_MembershipRules.LevelConfig levelConfig =
                        DigOps_MembershipRules.getLevelConfig(currentTerm.Level__c);
                    computedStatus = deriveStatus(currentTerm, levelConfig, policy, today);
                    currentLevel = currentTerm.Level__c;
                    endDate = currentTerm.EndDate__c;

                    if (policy.memberSinceResetsOnRejoin) {
                        memberSince = currentTerm.StartDate__c;
                    } else {
                        memberSince = earliestStart;
                    }

                    if (computedStatus == 'Active') {
                        summaryStatus = 'Active';
                        isCurrentMember = true;
                    } else if (computedStatus == 'Grace') {
                        summaryStatus = 'Grace';
                    } else if (computedStatus == 'Lapsed') {
                        summaryStatus = 'Lapsed';
                    } else if (computedStatus == 'Pending') {
                        summaryStatus = 'None';
                    } else if (computedStatus == 'Cancelled') {
                        summaryStatus = 'None';
                    }

                    if (shouldUpdateMembershipStatus(currentTerm, computedStatus)) {
                        membershipsToUpdate.add(new Membership__c(
                            Id = currentTerm.Id,
                            Status__c = computedStatus
                        ));
                    }
                } else {
                    memberSince = earliestStart;
                }

                Contact updated = new Contact(Id = contactId);
                Boolean hasChange = false;

                if (contact.Is_Current_Member__c != isCurrentMember) {
                    updated.Is_Current_Member__c = isCurrentMember;
                    hasChange = true;
                }
                if (contact.Membership_Status_Summary__c != summaryStatus) {
                    updated.Membership_Status_Summary__c = summaryStatus;
                    hasChange = true;
                }
                if (contact.Current_Membership_Level__c != currentLevel) {
                    updated.Current_Membership_Level__c = currentLevel;
                    hasChange = true;
                }
                if (contact.Membership_End_Date__c != endDate) {
                    updated.Membership_End_Date__c = endDate;
                    hasChange = true;
                }
                if (contact.Member_Since__c != memberSince) {
                    updated.Member_Since__c = memberSince;
                    hasChange = true;
                }
                if (contact.Membership_Last_Paid_Date__c != latestPaid) {
                    updated.Membership_Last_Paid_Date__c = latestPaid;
                    hasChange = true;
                }

                if (hasChange) {
                    contactsToUpdate.add(updated);
                }
            }

            if (!membershipsToUpdate.isEmpty()) {
                update membershipsToUpdate;
            }
            if (!contactsToUpdate.isEmpty()) {
                update contactsToUpdate;
            }
        } finally {
            isRecomputeRunning = false;
        }
    }

    private static Boolean isCancelled(Membership__c membership) {
        return membership.CancelledDate__c != null || membership.Status__c == 'Cancelled';
    }

    private static Boolean shouldUpdateMembershipStatus(Membership__c membership, String computedStatus) {
        if (computedStatus == null) {
            return false;
        }
        if (membership.Status__c == 'Cancelled' || membership.CancelledDate__c != null) {
            return false;
        }
        return membership.Status__c != computedStatus;
    }

    private static String deriveStatus(
        Membership__c membership,
        DigOps_MembershipRules.LevelConfig levelConfig,
        DigOps_MembershipRules.Policy policy,
        Date today
    ) {
        if (isCancelled(membership)) {
            return 'Cancelled';
        }
        Date startDate = membership.StartDate__c;
        Date endDate = membership.EndDate__c;
        Integer graceDays = levelConfig != null ? levelConfig.graceDays : policy.defaultGraceDays;
        Boolean paidRequired = levelConfig != null ? levelConfig.isPaidRequired : true;

        // A future term is pending, never lapsed or prematurely active.
        if (startDate != null && today < startDate) {
            return 'Pending';
        }
        if (paidRequired && membership.PaidDate__c == null) {
            if (endDate != null) {
                Date graceEnd = endDate.addDays(graceDays != null ? graceDays : 0);
                if (today > graceEnd) {
                    return 'Lapsed';
                }
            }
            if (startDate != null && today >= startDate) {
                return 'Pending';
            }
        }
        if (startDate != null && endDate != null && today >= startDate && today <= endDate) {
            if (!paidRequired || membership.PaidDate__c != null) {
                return 'Active';
            }
        }
        if (policy.useGraceStatus && endDate != null && today > endDate) {
            Date graceEnd = endDate.addDays(graceDays != null ? graceDays : 0);
            if (today <= graceEnd) {
                return 'Grace';
            }
        }
        if (endDate != null) {
            Date graceEnd = endDate.addDays(graceDays != null ? graceDays : 0);
            if (today > graceEnd) {
                return 'Lapsed';
            }
        }
        return 'Lapsed';
    }
}
