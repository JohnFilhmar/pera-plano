// app/(tabs)/plan/bills.tsx — the Bills list (m2c Task 5, rules 1, 6, 7).
//
// ROUTES LIVE UNDER `(tabs)/plan/`, not the plan's `app/plan/bills/`. Both would
// feed the same `/plan/*` URL space, and expo-router's typed-route generator
// emits only `/plan/bills/index` for a nested index inside a route group. Same
// call as m2b Tasks 4 and 8.
//
// The list itself now renders from components/plan/bills_panel.tsx.
import { BillsPanel } from "@/components/plan/bills_panel";

export default function BillsScreen() {
  return <BillsPanel />;
}
