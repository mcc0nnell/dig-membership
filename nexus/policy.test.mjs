import { test } from "node:test";
import assert from "node:assert/strict";
import {can,nextRegistrationStatus,canPublishNewsletter} from "./policy.mjs";
const member={id:"m1",status:"active",roles:["member"]};
const officer={id:"o1",status:"active",roles:["officer"]};
test("directory is opt-in",()=>{
 assert.equal(can(member,"profile.read",{ownerId:"m2",directoryOptIn:false}),false);
 assert.equal(can(member,"profile.read",{ownerId:"m2",directoryOptIn:true}),true);
 assert.equal(can(member,"profile.update",{ownerId:"m2"}),false);
});
test("least privilege for communications",()=>{
 assert.equal(can(member,"newsletter.approve"),false);
 assert.equal(can(officer,"newsletter.approve"),true);
 assert.equal(can({...officer,status:"suspended"},"newsletter.approve"),false);
 assert.equal(canPublishNewsletter(officer,{status:"draft",previewApproved:true,audienceCount:10}),true);
 assert.equal(canPublishNewsletter(officer,{status:"draft",previewApproved:false,audienceCount:10}),false);
});
test("committee documents require membership",()=>{
 assert.equal(can(member,"document.read",{visibility:"committee",memberIds:["m2"]}),false);
 assert.equal(can(member,"document.read",{visibility:"committee",memberIds:["m1"]}),true);
});
test("registration capacity and cancellation",()=>{
 assert.equal(nextRegistrationStatus(null,{registrationOpen:true,capacity:2,registered:1}),"registered");
 assert.equal(nextRegistrationStatus("cancelled",{registrationOpen:true,capacity:2,registered:2}),"waitlisted");
 assert.throws(()=>nextRegistrationStatus("registered",{registrationOpen:true}),/Already/);
 assert.throws(()=>nextRegistrationStatus(null,{registrationOpen:false}),/closed/);
});
