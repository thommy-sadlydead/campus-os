import "server-only";

// Sends the app's own emails (password resets) through Resend's REST API,
// hand-rolled with fetch like src/lib/stripe.ts. Needs RESEND_API_KEY and
// EMAIL_FROM, an address on a domain verified in Resend. Without them,
// emailConfigured() is false and callers tell people to contact support
// instead. Replies go to CONTACT_EMAIL when it's set, so EMAIL_FROM can be a
// send-only address. For local testing only (ignored in production), EMAIL_LOG_ONLY=1
// prints each email to the server log instead of sending it.

const RESEND_URL = "https://api.resend.com/emails";

function logOnly(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.EMAIL_LOG_ONLY === "1";
}

export function emailConfigured(): boolean {
  return logOnly() || Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

/** Never throws: returns false (and logs why) if the email couldn't be sent. */
export async function sendEmail(message: { to: string; subject: string; text: string; html: string }): Promise<boolean> {
  if (!emailConfigured()) return false;
  if (logOnly()) {
    console.log(`[EMAIL_LOG_ONLY] To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
    return true;
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM!.trim(),
        to: [message.to],
        reply_to: process.env.CONTACT_EMAIL?.trim() || undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`Sending email failed: Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Sending email failed:", err);
    return false;
  }
}
