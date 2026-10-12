// DIG Nexus read-only Twenty API probe. Node 20+; no dependencies.
import { randomUUID } from 'node:crypto';
const base = process.env.TWENTY_URL?.replace(/\/$/, '');
const token = process.env.TWENTY_API_KEY;
if (!base || !/^https:\/\//.test(base) || !token) {
  console.error('Provide HTTPS TWENTY_URL and TWENTY_API_KEY');
  process.exit(2);
}
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      ...(body ? {'Content-Type':'application/json'} : {})
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.text();
  if (!response.ok) throw new Error('Twenty HTTP ' + response.status + ': ' + data.slice(0, 250));
  return JSON.parse(data);
}
const result = await api('/rest/people?limit=1');
console.log('Read succeeded; response keys:', Object.keys(result));
if (process.env.DIG_ALLOW_SYNTHETIC_WRITE === 'YES') {
  const id = randomUUID().slice(0,8);
  const created = await api('/rest/people','POST',{
    name:{firstName:'DIG',lastName:'Synthetic-'+id},
    emails:{primaryEmail:'dig-'+id+'@example.test'}
  });
  console.log('Synthetic person created:', created.data?.createPerson?.id ?? 'check response');
} else console.log('Write skipped by default');
