import { redirect } from "next/navigation";

// /status is renamed to /connect (Data Page Redesign & Connect, §0.1/§0.3;
// amended by Rename /data Page to /connect, §0.2, to redirect here directly
// rather than chaining through the freed /data path, AC-DS24): this path
// stays reachable so no existing bookmark/browser-history entry breaks, but
// it no longer renders anything itself — proxy.ts's existing gate still
// gives an unauthenticated request its usual /signin redirect first (defense
// in depth for that half lives there now, not here; see proxy.ts's comment).
export default function Status() {
  redirect("/connect");
}
