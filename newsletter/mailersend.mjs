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
  if (url.protocol !== "https:") throw new Error("Unsubscribe must use HTTPS");
  const body = {
    from: { email: env.MAILERSEND_FROM_EMAIL, name: env.MAILERSEND_FROM_NAME || "Deaf in Government" },
    to: [{ email: message.email }],
    subject: message.subject,
    html: message.html,
    text: message.text,
    tags: ["dig-newsletter"]
  };
  // MailerSend custom headers and unsubscribe support vary by plan.
  // Do not enable marketing campaigns until compliant unsubscribe headers are verified.
  if (env.DIG_NEWSLETTER_MARKETING_READY !== "true") throw new Error("Marketing compliance gate disabled");
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
