// Same-day sync-failure alerting via Resend (the same account that will later
// send Auth.js magic links). Alert delivery must never take down the ingest
// path itself, so every failure mode here degrades to a console.error —
// which surfaces in Vercel's function logs.

export async function sendSyncFailureAlert(subject: string, body: string): Promise<void> {
  const key = process.env.AUTH_RESEND_KEY;
  const to = process.env.SYNC_ALERT_EMAIL_TO;
  if (!key || !to) {
    console.error(
      "sync alert not sent: AUTH_RESEND_KEY and/or SYNC_ALERT_EMAIL_TO is not set",
    );
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // onboarding@resend.dev delivers only to the Resend account owner's
        // address — fine for a single-user app; switch to a verified
        // jerkai.app sender when the domain is added to Resend.
        from: "JerkAI Sync <onboarding@resend.dev>",
        to: [to],
        subject,
        text: body,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`sync alert email failed: ${res.status} ${detail}`);
    }
  } catch (err) {
    console.error("sync alert email failed:", err);
  }
}
