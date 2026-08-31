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
        // Verified mail.jerkai.app sending subdomain (docs/prd/resend-sending-domain-switch.md) —
        // delivers regardless of which address SYNC_ALERT_EMAIL_TO holds. Moved off the
        // bare jerkai.app root domain to isolate transactional-send reputation from the
        // site's own domain (2026-08-31).
        from: "JerkAI Sync <sync@mail.jerkai.app>",
        to: [to],
        subject,
        text: body,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`sync alert email failed: ${res.status} ${detail}`);
      return;
    }
    // Log the email id from Resend's response — the only verifiable record
    // that a send was accepted, since success is otherwise silent here.
    const id: unknown = (await res.json().catch(() => null))?.id;
    console.log(`sync alert sent: ${typeof id === "string" ? id : "(no id in Resend response)"}`);
  } catch (err) {
    console.error("sync alert email failed:", err);
  }
}
