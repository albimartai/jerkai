"use client";

import { useEffect, useState } from "react";

import { getTargetsForCurrentUser } from "@/app/fuel/actions";
import type { TargetRow } from "@/lib/targets";

// AC-M45: fetchTargets()'s own row order is effective_date, id ascending (lib/targets.ts)
// — reversed client-side for newest-first display here, no new query shape.
export function TargetsHistory({ refreshToken }: { refreshToken: number }) {
  const [targets, setTargets] = useState<TargetRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTargetsForCurrentUser().then((rows) => {
      if (!cancelled) setTargets(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  if (targets === null) return null;

  if (targets.length === 0) {
    return <p className="text-sm text-zinc-400">No targets saved yet.</p>;
  }

  const newestFirst = targets.slice().reverse();

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          <th className="pb-2 font-medium">Effective</th>
          <th className="pb-2 font-medium">Calories</th>
          <th className="pb-2 font-medium">Protein</th>
        </tr>
      </thead>
      <tbody>
        {newestFirst.map((target) => (
          <tr key={target.id} className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="py-2 tabular-nums">{target.effectiveDate}</td>
            <td className="py-2 tabular-nums">{target.caloriesTarget}</td>
            <td className="py-2 tabular-nums">{target.proteinTargetG}g</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
