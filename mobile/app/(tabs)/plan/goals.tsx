// app/(tabs)/plan/goals.tsx — the Goals list (m2b Task 4;
// docs/04-features/05-goals-savings.md).
//
// Flattened beside the `goals/` directory rather than `goals/index.tsx`, for
// the reason m2 Task 8 recorded: with `typedRoutes` on, expo-router's generator
// emits only `/plan/goals/index` for a nested index route inside a route group,
// never the bare `/plan/goals`. The repo already does this with
// `app/wallet/[id].tsx` beside `app/wallet/[id]/edit.tsx`.
//
// The list itself now renders from components/plan/goals_panel.tsx.
import { GoalsPanel } from "@/components/plan/goals_panel";

export default function GoalsScreen() {
  return <GoalsPanel />;
}
