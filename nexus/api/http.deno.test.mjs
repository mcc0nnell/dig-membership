import { assertEquals } from "jsr:@std/assert@1";
import worker from "./worker.mjs";

Deno.test("real HTTP health and identity denial", async () => {
 const controller = new AbortController();
 const server = Deno.serve({ hostname:"127.0.0.1", port:0, signal:controller.signal, onListen:()=>{} }, request => worker.fetch(request));
 try {
  const address = server.addr;
  const base = "http://127.0.0.1:" + address.port;
  const health = await fetch(base + "/api/health");
  assertEquals(health.status,200);
  assertEquals((await health.json()).status,"ok");
  const member = await fetch(base + "/api/me", {headers:{"x-role":"admin","x-member-id":"synthetic"}});
  assertEquals(member.status,503);
  assertEquals((await member.json()).error,"authentication_not_configured");
  const unknown = await fetch(base + "/api/members");
  assertEquals(unknown.status,404);
 } finally {
  controller.abort();
  await server.finished;
 }
});
