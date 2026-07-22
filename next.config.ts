import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Public demo domain (docs/prd/public-demo.md, NFR-53): demo.jerkai.app
  // resolves to the /demo route subtree via host-based rewrite. Internal
  // links inside the demo tree always point at the canonical /demo/* paths
  // (see app/ui/nav-header.tsx, app/ui/weekly-ledger.tsx), so
  // jerkai.app/demo/weekly also works directly without this rewrite —
  // useful before the Vercel domain alias + DNS record are set up (a manual
  // step outside this repo; see the PR description).
  async rewrites() {
    return [
      { source: "/", has: [{ type: "host", value: "demo.jerkai.app" }], destination: "/demo/weekly" },
      { source: "/:path*", has: [{ type: "host", value: "demo.jerkai.app" }], destination: "/demo/:path*" },
    ];
  },
};

export default nextConfig;
