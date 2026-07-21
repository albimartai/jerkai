import { todayLocal } from "@/app/ui/log-meal-form";

// AC-M29: "Today's meals" only when the shown date is device-local today; otherwise the
// ISO date is shown plainly (a friendlier long-form date is an out-of-scope fast-follow).
export function headingFor(entryDate: string): string {
  return entryDate === todayLocal() ? "Today's meals" : `Meals · ${entryDate}`;
}
