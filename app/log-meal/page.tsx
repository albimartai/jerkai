import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { NavHeader } from "@/app/ui/nav-header";
import { LogMealForm } from "@/app/ui/log-meal-form";

export const dynamic = "force-dynamic";

export default async function LogMeal() {
  // proxy.ts already gates this route; re-checking here keeps writes behind a session even
  // if the proxy matcher ever regresses (same defense-in-depth as the other pages).
  const session = await auth();
  if (!session) {
    redirect("/signin");
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 font-sans">
      <NavHeader />
      <LogMealForm />
    </main>
  );
}
