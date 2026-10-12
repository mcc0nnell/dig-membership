(() => {
  'use strict';
  const config = window.DIGMembership || {};
  const api = typeof config.gateway === 'string' ? config.gateway.replace(/\/$/, '') : '';
  if (!api || !api.startsWith('https://')) return;

  async function post(path, body) {
    const response = await fetch(api + path, {
      method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    return { ok: response.ok && result.ok === true, data: result };
  }
  function announce(root, message) {
    const status = root.querySelector('[data-dig-status]');
    if (status) status.textContent = message;
  }
  for (const root of document.querySelectorAll('[data-dig-mode]')) {
    if (root.dataset.digMode === 'join') {
      const form = root.querySelector('form');
      const submit = root.querySelector('button[type="submit"]');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const values = new FormData(form);
        const turnstileToken = values.get('cf-turnstile-response');
        if (!turnstileToken) { announce(root, 'Complete the verification challenge first.'); return; }
        submit.disabled = true;
        announce(root, 'Sending your verification link…');
        try {
          const result = await post('/api/membership/request', {
            firstName: values.get('firstName'), lastName: values.get('lastName'),
            email: values.get('email'), website: values.get('website'), turnstileToken
          });
          announce(root, result.ok
            ? 'Check your email for a DIG verification link. You may need to check your spam folder.'
            : 'We could not send the link. Please try again later.');
          if (window.turnstile && typeof window.turnstile.reset === 'function') window.turnstile.reset();
        } catch (_error) {
          announce(root, 'We could not send the link. Please try again later.');
        } finally { submit.disabled = false; }
      });
    }
    if (root.dataset.digMode === 'verify') {
      const locationURL = new URL(window.location.href);
      const fragment = new URLSearchParams(locationURL.hash.replace(/^#/, ''));
      const token = fragment.get('t') || locationURL.searchParams.get('t');
      const purpose = fragment.get('p') || locationURL.searchParams.get('p');
      // Strip bearer data before any network request; preserve the current WP permalink.
      locationURL.hash = '';
      for (const key of ['t', 'p', 'r']) locationURL.searchParams.delete(key);
      window.history.replaceState({}, '', locationURL.pathname + locationURL.search);
      if (!token || purpose !== 'web-join') {
        announce(root, 'This verification link is invalid. Request a new link.');
        continue;
      }
      post('/api/membership/verify', { token }).then(result => {
        if (!result.ok) {
          announce(root, 'This link is invalid, expired, or already used. Request a new one.');
          return;
        }
        announce(root, result.data.status === 'ACTIVE'
          ? 'Your DIG membership is active.'
          : 'Your email is verified. Your membership status is ' + (result.data.status || 'pending') + '.');
      }).catch(() => announce(root, 'Verification is temporarily unavailable. Please try again later.'));
    }
  }
})();
