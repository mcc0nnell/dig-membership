import { test } from "node:test";
import assert from "node:assert/strict";
import { sendNewsletter } from "./mailersend.mjs";
const env = {DIG_NEWSLETTER_SEND_ENABLED:"true", DIG_NEWSLETTER_MARKETING_READY:"true", MAILERSEND_API_TOKEN:"test", MAILERSEND_FROM_EMAIL:"news@example.test"};
const msg = {approved:true, consentVerified:true, suppressed:false, email:"reader@example.test", subject:"DIG News",text:"Hello",html:"<p>Hello</p>",unsubscribeUrl:"https://example.test/unsubscribe/token"};
test("sending is disabled by default", async () => {
  await assert.rejects(sendNewsletter({...env,DIG_NEWSLETTER_SEND_ENABLED:"false"},msg,()=>{throw Error("network called")}),/disabled/);
});
test("suppressed recipients never send", async () => {
  await assert.rejects(sendNewsletter(env,{...msg,suppressed:true},()=>{throw Error("network called")}),/not authorized/);
});
test("compliance gate prevents sending", async () => {
  await assert.rejects(sendNewsletter({...env,DIG_NEWSLETTER_MARKETING_READY:"false"},msg,()=>{throw Error("network called")}),/compliance gate/);
});
test("valid approved recipient posts expected payload", async () => {
  let sent;
  const fetchMock = async (url,options) => {
    sent = {url,options};
    return {ok:true,headers:{get:(k)=>k==="x-message-id"?"fake-id":null}};
  };
  const result=await sendNewsletter(env,msg,fetchMock);
  assert.equal(result.messageId,"fake-id");
  assert.equal(sent.url,"https://api.mailersend.com/v1/email");
  assert.equal(JSON.parse(sent.options.body).to[0].email,"reader@example.test");
});
