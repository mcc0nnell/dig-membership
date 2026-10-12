import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnsubscribeToken, hashToken, unsubscribeResponse } from "./tokens.mjs";
test("random tokens have independent fixed-length hashes", async () => {
 const a=await createUnsubscribeToken(), b=await createUnsubscribeToken();
 assert.match(a.token,/^[a-f0-9]{64}$/);
 assert.equal(await hashToken(a.token),a.tokenHash);
 assert.notEqual(a.token,b.token);
 assert.notEqual(a.token,a.tokenHash);
});
test("invalid token rejected", async () => {
 await assert.rejects(hashToken("bad"),/Invalid token/);
});
test("unsubscribe acknowledgement is private", () => {
 const r=unsubscribeResponse();
 assert.equal(r.status,200);
 assert.equal(r.headers.get("cache-control"),"no-store");
});
