/**
 * MailerSend delivery adapter for DIG Nexus.
 * Never call directly from a browser. No sends without explicit enabled flag.
 * Expects a validated, opted-in recipient supplied by the queue processor.
 */
export async function sendNewsletter(env, message, fetchImpl = fetch) {
  if (env.DIG_NEWSLETTER_SEND_ENABLED !== "true") throw new Error("Newsletter sending disabled");
  if (!env.MAILERSEND_API_TOKEN || !env.MAILERSEND_FROM_EMAIL) throw new Error("MailerSend configuration missing");
  if (!message?.approved || !message?.consentVerified || message?.suppressed) throw new Error("Recipient not authorized");
  if (!message?.email || !message?.subject || !message?.text || !message?.html || !message?.unsubscribeUrl) throw new Error("Incomplete email");
  const url = new URL(message.unsubscribeUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search ||
      !/^\/newsletter\/unsubscribe\/[0-9a-f]{64}$/.test(url.pathname))
    throw new Error("Unsubscribe must use a verified HTTPS one-click link");
  if (!env.PUBLIC_ORIGIN || url.origin!==env.PUBLIC_ORIGIN)
    throw new Error("Unsubscribe link must use the trusted public origin");
  const body = {
    from: { email: env.MAILERSEND_FROM_EMAIL, name: env.MAILERSEND_FROM_NAME || "Deaf in Government" },
    to: [{ email: message.email }],
    subject: message.subject,
    html: message.html + '<p><a href="' + url.href + '">Unsubscribe from DIG newsletters</a></p>',
    text: message.text + '\n\nUnsubscribe: ' + url.href,
    list_unsubscribe: url.href,
    tags: ["dig-newsletter"]
  };
  // MailerSend custom headers and unsubscribe support vary by plan.
  // Do not enable marketing campaigns until compliant unsubscribe headers are verified.
  if (env.DIG_NEWSLETTER_MARKETING_READY !== "true") throw new Error("Marketing compliance gate disabled");
  // MailerSend's custom List-Unsubscribe API parameter requires a supported plan.
  // Provider adds List-Unsubscribe-Post automatically for one-click HTTPS.
  // Do not assume all MailerSend accounts have this feature.
  if (env.DIG_NEWSLETTER_ONE_CLICK_VERIFIED !== "true" ||
      env.NEWSLETTER_UNSUBSCRIBE_ENABLED !== "true")
    throw new Error("Verified one-click unsubscribe and endpoint are required");
  const response = await fetchImpl("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.MAILERSEND_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const error = new Error("MailerSend request failed: HTTP " + response.status);
    error.status = response.status;
    error.retryAfter = retryAfter;
    throw error;
  }
  return { accepted: true, messageId: response.headers.get("x-message-id") || null };
}
