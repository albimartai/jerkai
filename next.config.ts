import type { NextConfig } from "next";

// Public demo domain (docs/prd/public-demo.md, NFR-53): demo.jerkai.app
// resolves to the /demo route subtree via a host-based rewrite issued by
// proxy.ts itself (NextResponse.rewrite() on the demo.jerkai.app host),
// not by a rewrite declared here. A rewrite defined in this file runs AFTER
// Proxy in Next's execution order (node_modules/next/dist/docs/.../proxy.md,
// "Execution order") — it would never get a chance to fire once proxy.ts's
// session gate had already run on the original, un-rewritten path, and a
// prior version of this exact bug shipped that way (demo.jerkai.app/ 307'd
// to jerkai.app/signin instead of rendering the demo). Do not re-add a
// rewrite here for this host — it would be dead code at best and a second
// place for the same ordering bug to recur at worst. Internal links inside
// the demo tree always point at the canonical /demo/* paths (see
// app/ui/nav-header.tsx, app/ui/weekly-ledger.tsx), so jerkai.app/demo/weekly
// also works directly without any host-based routing at all.
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
