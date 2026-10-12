import {test} from "node:test";
import assert from "node:assert/strict";
import {membershipActiveOn,newsletterEligible,eligibleToVote,checkinDecision} from "./lifecycle.mjs";
const terms=[{startsOn:"2026-01-01",endsOn:"2026-12-31"}];
test("membership terms have inclusive dates",()=>{
 assert.equal(membershipActiveOn(terms,"2026-12-31"),true);
 assert.equal(membershipActiveOn(terms,"2027-01-01"),false);
 assert.throws(()=>membershipActiveOn(terms,"bad"),/Invalid/);
});
test("newsletter consent is independent of dues",()=>{
 assert.equal(newsletterEligible({status:"subscribed",consentAt:"2026-01-01",consentSource:"form"},false),true);
 assert.equal(newsletterEligible({status:"subscribed",consentAt:"2026-01-01",consentSource:"form"},true),false);
 assert.equal(newsletterEligible({status:"pending"},false),false);
});
test("election eligibility needs verified active voter roll",()=>{
 assert.equal(eligibleToVote({verified:true,suspended:false,terms,day:"2026-10-12",voterRollEligible:true}),true);
 assert.equal(eligibleToVote({verified:true,suspended:false,terms,day:"2027-10-12",voterRollEligible:true}),false);
 assert.equal(eligibleToVote({verified:true,suspended:false,terms,day:"2026-10-12",voterRollEligible:false}),false);
});
test("check-in rejects duplicates and cancelled registrations",()=>{
 assert.equal(checkinDecision({registrationStatus:"registered",alreadyCheckedIn:false}),"allowed");
 assert.equal(checkinDecision({registrationStatus:"registered",alreadyCheckedIn:true}),"duplicate");
 assert.equal(checkinDecision({registrationStatus:"cancelled",alreadyCheckedIn:false}),"denied");
});
