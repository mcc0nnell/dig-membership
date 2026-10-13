// Pure lifecycle decisions: separate identity, entitlements, and communications.
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export function membershipActiveOn(terms, day) {
 if (!datePattern.test(day) || !Number.isFinite(Date.parse(day + "T00:00:00Z"))) throw new Error("Invalid day");
 return terms.some(t => datePattern.test(t.startsOn) && datePattern.test(t.endsOn) && t.startsOn <= day && day <= t.endsOn);
}
export function newsletterEligible(preference, suppression) {
 return preference?.status === "subscribed" && !!preference.consentAt && !!preference.consentSource && !suppression;
}
export function eligibleToVote({ verified, suspended, terms, day, voterRollEligible }) {
 return verified === true && suspended !== true && voterRollEligible === true && membershipActiveOn(terms,day);
}
export function checkinDecision({registrationStatus,alreadyCheckedIn}) {
 if (alreadyCheckedIn) return "duplicate";
 if (registrationStatus !== "registered") return "denied";
 return "allowed";
}
// Enforce check-in atomically via registration row lock + UNIQUE(registration_id).
