import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";

// Human-readable messages for the Auth.js error codes this flow can
// actually produce (pages.error points here, so failures arrive as
// /signin?error=<code>).
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "That email address isn't allowed to sign in.",
  Verification: "That sign-in link is invalid or has expired. Request a new one.",
  Configuration: "Sign-in is misconfigured on the server. Check the logs.",
};

function toAppPath(callbackUrl: string | undefined): string {
  if (!callbackUrl) return "/";
  if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) return callbackUrl;
  try {
    const url = new URL(callbackUrl);
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await auth();
  const { error, callbackUrl } = await searchParams;
  // Only ever bounce back to a same-app path — never a foreign origin. The
  // proxy's redirect puts an absolute URL here; keep just its path + query.
  const safeCallbackUrl = toAppPath(callbackUrl);

  if (session) {
    redirect(safeCallbackUrl);
  }

  async function requestMagicLink(formData: FormData) {
    "use server";
    await signIn("resend", {
      email: formData.get("email"),
      redirectTo: safeCallbackUrl,
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 font-sans">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">JerkAI</h1>
        <p className="text-sm text-zinc-500">Sign in to view your dashboard</p>
      </div>
      <form action={requestMagicLink} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="email"
          name="email"
          required
          autoFocus
          placeholder="you@example.com"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-400"
        />
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Email me a sign-in link
        </button>
      </form>
      {error && (
        <p className="max-w-xs text-center text-sm text-red-600 dark:text-red-400">
          {ERROR_MESSAGES[error] ?? "Sign-in failed. Try again."}
        </p>
      )}
    </main>
  );
}
