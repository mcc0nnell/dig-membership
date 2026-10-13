import {test} from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";
test("health responds without member data",async()=>{
 const r=await worker.fetch(new Request("https://example.invalid/api/health"));
 assert.equal(r.status,200);
 assert.equal((await r.json()).status,"ok");
});
test("member endpoint does not trust supplied headers",async()=>{
 const r=await worker.fetch(new Request("https://example.invalid/api/me",{headers:{"x-member-id":"1","x-role":"admin"}}));
 assert.equal(r.status,501);
});
