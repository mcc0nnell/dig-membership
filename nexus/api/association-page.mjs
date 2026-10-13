import {ASSOCIATION_CLIENT} from './association-client.mjs';
import {ASSOCIATION_STYLE} from './association-style.mjs';

const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
export function associationPage(){
 return new Response(`<!doctype html><html lang="en">
 <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>Association operations | DIG Nexus</title><link rel="stylesheet" href="/association.css"></head>
 <body><a class="skip" href="#main">Skip to workspace</a>
 <header><div class="head-inner"><div><span class="eyebrow">DEAF IN GOVERNMENT · STAFF</span><strong>DIG Nexus</strong></div>
 <nav aria-label="Related areas"><a href="/portal">Member portal</a><a href="/organizer/ntc-2027">NTC organizer</a></nav></div></header>
 <main id="main"><div class="intro"><span class="eyebrow">PRIVATE OPERATIONS</span>
 <h1>Association workspace</h1>
 <p>Review member relationships and prepare consent-scoped communications. Membership, directory visibility and newsletter consent remain independent.</p></div>
 <p id="workspace-status" class="status" role="status" aria-live="polite">No member data has been loaded.</p>
 <div class="panels">
 <section aria-labelledby="member-title"><div class="section-head"><span class="eyebrow">CONSTITUENTS</span><h2 id="member-title">Member record</h2></div>
 <form id="member-search"><label for="member-id">Member reference (UUID)</label><input id="member-id" name="memberId" autocomplete="off"
  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required pattern="[a-fA-F0-9-]{36}">
 <button type="submit">Look up member</button></form>
 <div id="member-detail" hidden><h3>Private record</h3><dl id="member-fields"></dl><h3>Membership terms</h3><ul id="member-terms"></ul>
 <h3>Committees and affiliations</h3><ul id="member-relations"></ul>
 <div class="divider"></div>
 <h3>Record follow-up</h3><p class="hint">Do not enter accommodations, health details, or other sensitive member information.</p>
 <form id="activity-form"><label for="activity-kind">Activity type</label><select id="activity-kind" required>
 <option value="followup">Follow-up</option><option value="phone">Phone</option><option value="meeting">Meeting</option><option value="case_note">Administrative note</option></select>
 <label for="activity-summary">Summary</label><textarea id="activity-summary" rows="3" maxlength="1000" required></textarea>
 <button type="submit">Record activity</button></form></div></section>
 <section aria-labelledby="campaign-title"><div class="section-head"><span class="eyebrow">COMMUNICATIONS</span><h2 id="campaign-title">Campaign approvals</h2></div>
 <p class="hint">Preview the eligible audience without exposing subscriber addresses. Queuing is not sending.</p>
 <form id="campaign-search"><label for="campaign-id">Campaign reference (UUID)</label><input id="campaign-id" autocomplete="off"
 placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required pattern="[a-fA-F0-9-]{36}">
 <button type="submit">Preview campaign</button></form>
 <div id="campaign-detail" hidden><dl id="campaign-fields"></dl>
 <form id="campaign-queue"><label class="consent"><input id="campaign-confirm" type="checkbox" required>
 I have reviewed this campaign and want to queue only currently consented subscribers.</label>
 <button id="queue-submit" type="submit">Queue approved campaign</button></form>
 <p class="hint">No email will be sent by this action. The separate MailerSend delivery service remains disabled.</p></div></section>
 </div></main>
 <footer>Authorized DIG officers and administrators only. Activities are attributed and audited. No automatic newsletter enrollment.</footer>
 <script src="/association-client.mjs" type="module"></script>
 </body></html>`,{headers:{...headers,'content-type':'text/html; charset=utf-8','referrer-policy':'no-referrer','x-frame-options':'DENY',
 'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}
export const associationClient=()=>new Response(ASSOCIATION_CLIENT,{headers:{...headers,'content-type':'text/javascript; charset=utf-8'}});
export const associationStyle=()=>new Response(ASSOCIATION_STYLE,{headers:{...headers,'content-type':'text/css; charset=utf-8'}});
