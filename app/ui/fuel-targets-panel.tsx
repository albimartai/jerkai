"use client";

import { useState } from "react";

import { TargetsForm } from "@/app/ui/targets-form";
import { TargetsHistory } from "@/app/ui/targets-history";

export function FuelTargetsPanel() {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="space-y-8">
      <TargetsForm onSaved={() => setRefreshToken((token) => token + 1)} />
      <TargetsHistory refreshToken={refreshToken} />
    </div>
  );
}
