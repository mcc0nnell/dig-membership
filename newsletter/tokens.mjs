// Opaque, expiring unsubscribe tokens. Only hashes are stored in Neon.
const encoder = new TextEncoder();
function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
export async function hashToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid token");
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}
export async function createUnsubscribeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = hex(bytes);
  return { token, tokenHash: await hashToken(token) };
}
export function unsubscribeResponse() {
  return new Response("You have been unsubscribed from DIG newsletters.", {
    status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
  });
}
