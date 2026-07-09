// Auth.js verifyRequest page — shown after a magic link is accepted for
// sending. Reaching this page means the address passed the allowlist;
// rejected addresses land back on /signin?error=AccessDenied instead.
export default function MagicLinkSentPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
      <p className="max-w-sm text-center text-sm text-zinc-500">
        A sign-in link is on its way. It expires in 24 hours — open it on this
        device to land back here signed in.
      </p>
    </main>
  );
}
