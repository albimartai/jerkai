import { redirect } from "next/navigation";

// /status is renamed to /data (Data Page Redesign & Connect, §0.1/§0.3,
// AC-DS2): this path stays reachable so no existing bookmark/browser-history
// entry breaks, but it no longer renders anything itself — proxy.ts's
// existing gate still gives an unauthenticated request its usual /signin
// redirect first (defense in depth for that half lives there now, not here;
// see proxy.ts's comment).
export default function Status() {
  redirect("/data");
}
