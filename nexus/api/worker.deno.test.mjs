import {assertEquals} from "jsr:@std/assert@1";
import worker from "./worker.mjs";
Deno.test("Deno: public health is reachable",async()=>{
 const response=await worker.fetch(new Request("https://example.invalid/api/health"));
 assertEquals(response.status,200);
 assertEquals((await response.json()).status,"ok");
});
Deno.test("Deno: spoofed identity headers cannot access member data",async()=>{
 const response=await worker.fetch(new Request("https://example.invalid/api/me",{headers:{"x-member-id":"admin","x-role":"admin"}}));
 assertEquals(response.status,503);
 assertEquals((await response.json()).error,"authentication_not_configured");
});
Deno.test("Deno: unknown routes are denied",async()=>{
 const response=await worker.fetch(new Request("https://example.invalid/api/members"));
 assertEquals(response.status,404);
});
