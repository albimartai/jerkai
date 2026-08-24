"use client";

import { useEffect, useState } from "react";

// Device-local timestamp display (Status Sync Times — Local Timezone Display,
// NFR-88/89/90): mirrors todayLocal()'s pattern (app/ui/log-meal-form.tsx) —
// no explicit timeZone is ever passed, so this resolves to whatever the
// browser/OS considers local, for any device, not a hardcoded zone.
function formatLocal(iso: string): string {
  const date = new Date(iso);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

// Renders null for one mount tick (server can't know device-local time), then
// the formatted local string — same shape as LogMealPanel's entryDate gate
// (AC-M31), so there is nothing for SSR and CSR to disagree about.
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    // Reading the browser's local clock (NFR-89) — unavailable during SSR, so
    // this can't be derived at render time; a mount effect is the correct
    // place, matching todayLocal()'s caller (app/ui/log-meal-panel.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(formatLocal(iso));
  }, [iso]);

  if (text === null) return null;

  return <span>{text}</span>;
}
