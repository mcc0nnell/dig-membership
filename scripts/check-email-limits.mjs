/**
 * Read-only Salesforce /limits monitor. Credentials stay in the process env.
 * No member records or email addresses are retrieved. Never expose via WordPress.
 */
const emailKeys = ['SingleEmail', 'MassEmail'];
export function normalizedInstance(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.my.salesforce.com')
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Expected HTTPS Salesforce my.salesforce.com instance origin');
  }
  return url.origin;
}
export async function checkEmailLimits({instance, token, version='65.0', reserve=500, fetcher=fetch}) {
  if (!token || !/^\d{2}\.\d$/.test(version) || !Number.isInteger(reserve) || reserve < 0) {
    throw new Error('Missing token, invalid API version or reserve');
  }
  const base = normalizedInstance(instance);
  const response = await fetcher(`${base}/services/data/v${version}/limits`, {
    headers: {authorization: `Bearer ${token}`, accept: 'application/json'},
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Salesforce limit inspection failed: HTTP ${response.status}`);
  const data = await response.json();
  const allocations = {};
  for (const key of emailKeys) {
    const limit = data?.[key];
    const valid = Number.isSafeInteger(limit?.Max) && Number.isSafeInteger(limit?.Remaining)
      && limit.Max >= 0 && limit.Remaining >= 0 && limit.Remaining <= limit.Max;
    allocations[key] = valid ? {max: limit.Max, remaining: limit.Remaining} : null;
  }
  return {allocations, reserve, healthy: allocations.SingleEmail !== null
    && allocations.SingleEmail.remaining >= reserve};
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const reserve = Number(process.env.DIG_EMAIL_RESERVE ?? '500');
    const result = await checkEmailLimits({
      instance:process.env.SF_INSTANCE_URL, token:process.env.SF_ACCESS_TOKEN,
      version:process.env.SF_API_VERSION || '65.0', reserve
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.healthy) process.exitCode = 2;
  } catch (e) {
    console.error('Email limit check unavailable:', e.message);
    process.exitCode = 2;
  }
}
