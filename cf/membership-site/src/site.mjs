const css = `:root{color-scheme:light;font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f7fa;color:#15273c}*{box-sizing:border-box}body{margin:0}a{color:#124e8a}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #d38d1a;outline-offset:3px}header{background:#16385a;color:white;padding:1rem max(1rem,calc((100% - 48rem)/2))}header a{color:white;font-weight:750;text-decoration:none}main{max-width:48rem;margin:auto;padding:clamp(1.5rem,5vw,3.5rem) 1rem 4rem}h1{font-size:clamp(1.9rem,5vw,3rem);line-height:1.15}p{max-width:44rem}.panel{background:white;padding:clamp(1.2rem,4vw,2rem);border:1px solid #d7e0ea;border-radius:1.1rem;box-shadow:0 8px 24px #11365a10}label{display:block;font-weight:700;margin:1.2rem 0 .3rem}input[type=email],input[type=text]{width:100%;font-size:1rem;border:2px solid #8092a3;border-radius:.45rem;padding:.8rem}button{display:inline-block;margin-top:1rem;padding:.85rem 1.5rem;border:0;border-radius:.5rem;background:#134e85;color:white;font:inherit;font-weight:750;cursor:pointer;min-height:48px}button:disabled{opacity:.6;cursor:progress}.status{margin-top:1rem;padding:1rem;border-radius:.5rem;background:#eaf2fa;border-left:4px solid #134e85;min-height:3.6rem}.status:empty{display:none}.hint{font-size:.92rem;color:#425669}.visually-hidden{position:absolute;height:1px;width:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}footer{border-top:1px solid #d7e0ea;padding:1.3rem;text-align:center;font-size:.9rem}`;
function escapeHTML(x) {return String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function htmlPage(siteKey, verify = false) {
  const inner = verify ? `<h1>Confirm your membership</h1><p>This link can only be used once. We’ll confirm your membership without requiring a password.</p><div class="panel"><p id="status" class="status" role="status" aria-live="polite">Checking your link…</p></div><p><a href="/membership">Request another link</a></p>` : `<h1>Join Deaf in Government</h1><p>Connect with Deaf and hard-of-hearing public servants and allies. DIG membership enrollment is currently free.</p><div class="panel"><h2>Verify your email</h2><p>We’ll email you a one-time link. Membership activates only after you follow it.</p><form id="join-form"><label for="first">First name</label><input id="first" name="firstName" type="text" autocomplete="given-name" maxlength="40"><label for="last">Last name</label><input id="last" name="lastName" type="text" autocomplete="family-name" required maxlength="80"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="80" inputmode="email"><label class="visually-hidden" for="website">Leave this field empty</label><input class="visually-hidden" id="website" name="website" tabindex="-1" autocomplete="off"><div class="cf-turnstile" data-sitekey="${escapeHTML(siteKey)}"></div><button id="submit" type="submit">Email my verification link</button></form><p id="status" class="status" role="status" aria-live="polite"></p></div><p class="hint">No payment information is required. If you already have a membership, we'll check your existing record rather than opening a second current term.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${verify ? 'Verify membership' : 'Join DIG'} · Deaf in Government</title><style>${css}</style></head><body data-mode="${verify ? 'verify' : 'join'}"><header><a href="https://deafingov.org/">DIG · Deaf in Government</a></header><main id="main-content">${inner}</main><footer>Deaf in Government · Accessible, passwordless enrollment</footer>${verify ? '' : '<script defer src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>'}<script defer src="/membership.js"></script></body></html>`;
}
export const clientJS = `(() => {
  'use strict';
  const status = document.querySelector('#status');
  function show(message) { status.textContent = message; }
  const mode = document.body.dataset.mode;
  if (mode === 'verify') {
    const url = new URL(location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const token = fragment.get('t') || url.searchParams.get('t');
    const purpose = fragment.get('p') || url.searchParams.get('p');
    history.replaceState({}, '', '/membership'); // Remove bearer token from address bar/history.
    if (!token || purpose !== 'web-join') { show('The verification link is invalid. Request a new link.'); return; }
    fetch('/api/membership/verify', { method:'POST', credentials:'omit', headers:{'content-type':'application/json'}, body:JSON.stringify({token}) })
      .then(async r => ({ok:r.ok, data:await r.json()}))
      .then(({ok,data}) => { if (!ok || !data.ok) {show('This link has expired or has already been used. Request a new one.');return;}
        show(data.status === 'ACTIVE' ? 'Your DIG membership is active.' : 'Your membership was verified. Current status: ' + data.status + '.');
      }).catch(() => show('We could not complete verification. Please try again later.'));
    return;
  }
  const form = document.querySelector('#join-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = document.querySelector('#submit');
    const data = new FormData(form);
    const turnstileToken = data.get('cf-turnstile-response');
    if (!turnstileToken) {show('Complete the verification challenge first.');return;}
    submit.disabled = true; show('Sending your link…');
    try {
      const response = await fetch('/api/membership/request', {method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({email:data.get('email'),firstName:data.get('firstName'),lastName:data.get('lastName'),website:data.get('website'),turnstileToken})});
      const result = await response.json();
      show(response.ok && result.ok ? 'If this email can receive messages, check your inbox for a DIG verification link.' : 'We could not send the link. Please try again.');
      if (response.ok && window.turnstile) window.turnstile.reset();
    } catch (_) {show('We could not send the link. Please try again.');}
    finally {submit.disabled=false;}
  });
})();`;
