// Registration core. The caller must supply a VERIFIED identity and a transactional DB adapter.
// Never accept member identity, status, roles, or consent from client JSON.
export function normalizeEmail(email) {
 if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid_email");
 return email.trim().toLowerCase();
}
export function parseRegistration(body) {
 if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_body");
 const displayName=body.displayName;
 if (typeof displayName !== "string" || displayName.trim().length < 1 || displayName.trim().length > 120) throw new Error("invalid_display_name");
 if (Object.keys(body).some(k=>!["displayName"].includes(k))) throw new Error("unexpected_field");
 return {displayName:displayName.trim()};
}
export async function registerMember({identity,body,db}) {
 if (!identity?.verified || !identity.emailVerified || typeof identity.subject !== "string" || !identity.subject) return {status:401,error:"unauthorized"};
 if (!db || typeof db.registerVerifiedIdentity !== "function") return {status:503,error:"registration_unavailable"};
 let data;
 try { data=parseRegistration(body); } catch { return {status:400,error:"invalid_registration"}; }
 let email;
 try { email=normalizeEmail(identity.email); } catch { return {status:401,error:"unauthorized"}; }
 // Adapter must enforce atomic idempotency by (issuer, subject), NOT just email.
 // Existing email with a different subject must fail closed for account linking review.
 const result=await db.registerVerifiedIdentity({issuer:identity.issuer,subject:identity.subject,email,displayName:data.displayName});
 if (result.kind==="created") return {status:201,memberId:result.memberId};
 if (result.kind==="existing") return {status:200,memberId:result.memberId};
 if (result.kind==="email_conflict") return {status:409,error:"identity_conflict"};
 throw new Error("invalid_adapter_result");
}
