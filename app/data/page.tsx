import { redirect } from "next/navigation";

// /data is renamed to /connect (Rename /data Page to /connect, §0.1/§1,
// AC-DS23): this path stays reachable so no existing bookmark/browser-history
// entry breaks, but it no longer renders anything itself — proxy.ts's
// existing gate still gives an unauthenticated request its usual /signin
// redirect first (defense in depth for that half lives there now, not here;
// see proxy.ts's comment).
export default function Data() {
  redirect("/connect");
}
