import { redirect } from "next/navigation";

import { auth } from "@/auth";
import Dashboard from "@/app/ui/dashboard";
import { fetchDashboardData } from "@/lib/dashboard/data";

// Always query at request time — this page must reflect the live database,
// never a build-time snapshot.
export const dynamic = "force-dynamic";

// Fetch the LARGEST window up front: the 30/90 toggle then re-renders
// client-side from data it already holds (AC-D16), and scrubbing never
// makes a network call (NFR-6).
const MAX_WINDOW_DAYS = 90;

export default async function Home() {
  // proxy.ts already gates this route; re-checking here keeps real biometric
  // data behind a session even if the proxy matcher ever regresses.
  const session = await auth();
  if (!session) {
    redirect("/signin");
  }

  const data = await fetchDashboardData(MAX_WINDOW_DAYS);

  return <Dashboard data={data} />;
}
