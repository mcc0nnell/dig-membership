export const PORTAL_CLIENT = `
const status = document.getElementById('member-status');
const join = document.getElementById('join-section');
const form = document.getElementById('join-form');
const feedback = document.getElementById('join-feedback');
const login = document.getElementById('sign-in');
const logout = document.getElementById('sign-out');

async function loadMember() {
  join.hidden = true;
  const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) {
    status.textContent = 'Not signed in. Continue with Google to check your DIG membership.';
    login.hidden = false;
    logout.hidden = true;
    return;
  }
  if (!response.ok) throw new Error('member lookup unavailable');
  const data = await response.json();
  login.hidden = true;
  logout.hidden = false;
  if (data.member) {
    const name = data.member.displayName || 'Member';
    const labels = {
      pending: 'Your membership request is pending review.',
      active: 'Your member record is active.',
      lapsed: 'Your membership has lapsed.',
      suspended: 'Your member record is suspended.'
    };
    status.textContent = name + ': ' +
      (labels[data.member.memberStatus] || 'Your membership status is unavailable.');
    return;
  }
  status.textContent = 'You are signed in, but this Google account is not linked to a DIG membership.';
  if (data.enrollmentAvailable === true) join.hidden = false;
  else status.textContent += ' Membership requests are not open yet.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  feedback.textContent = 'Submitting your membership request…';
  try {
    const response = await fetch('/api/enroll', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-dig-nexus-action': 'request-membership'
      },
      body: JSON.stringify({
        displayName: document.getElementById('display-name').value,
        requestMembership: true
      })
    });
    if (response.ok) {
      feedback.textContent = 'Request received. Membership is not yet approved.';
      await loadMember();
    } else if (response.status === 409) {
      feedback.textContent = 'This email is already associated with another identity. Contact DIG staff for review.';
    } else if (response.status === 401) {
      feedback.textContent = 'Your session expired. Sign in again before requesting membership.';
    } else {
      feedback.textContent = 'Could not submit your request. Please try again or contact DIG staff.';
    }
  } catch {
    feedback.textContent = 'Network error. Your request could not be confirmed.';
  } finally {
    button.disabled = false;
  }
});
loadMember().catch(() => {
  status.textContent = 'Membership status is temporarily unavailable. Please try again later.';
});
`;
