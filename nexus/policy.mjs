// Pure authorization and state transition functions; server must authenticate identity.
export const ROLES = Object.freeze(["member","officer","editor","event_staff","admin"]);
export function can(actor, action, resource = {}) {
  if (!actor || actor.status !== "active") return false;
  const roles = new Set(actor.roles || []);
  if (roles.has("admin")) return true;
  if (action === "profile.read") return actor.id === resource.ownerId || !!resource.directoryOptIn;
  if (action === "profile.update") return actor.id === resource.ownerId;
  if (action === "newsletter.compose") return roles.has("editor") || roles.has("officer");
  if (action === "newsletter.approve") return roles.has("officer");
  if (action === "event.manage") return roles.has("event_staff") || roles.has("officer");
  if (action === "event.register") return roles.has("member") || roles.has("officer");
  if (action === "committee.read") return resource.memberIds?.includes(actor.id) || roles.has("officer");
  if (action === "governance.manage") return roles.has("officer");
  if (action === "document.read") {
    if (resource.visibility === "members") return true;
    if (resource.visibility === "officers") return roles.has("officer");
    if (resource.visibility === "committee") return resource.memberIds?.includes(actor.id) || roles.has("officer");
  }
  return false;
}
export function nextRegistrationStatus(current, event) {
  if (current && current !== "cancelled") throw new Error("Already registered");
  if (!event.registrationOpen) throw new Error("Registration closed");
  if (event.capacity !== null && event.capacity !== undefined && event.registered >= event.capacity) return "waitlisted";
  return "registered";
}
// The caller must lock the event row and count registrations in the same transaction.
export function canPublishNewsletter(actor, campaign) {
  return can(actor,"newsletter.approve") && campaign.status === "draft" && campaign.previewApproved === true && campaign.audienceCount > 0;
}
