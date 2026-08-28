// test_support/jest_setup_after_env.ts — configuration that needs the test
// framework to already exist.
//
// SEPARATE FROM jest_setup.ts ON PURPOSE. `setupFiles` runs BEFORE Jest's
// framework is installed, so anything requiring `@testing-library/react-native`
// there dies with "expect is not defined" — and it takes every suite in the
// project with it, because the failure is at module load. `setupFilesAfterEnv`
// runs after, which is where anything touching RNTL belongs.
import { configure } from "@testing-library/react-native";

import { clearWalletDraft } from "@/lib/onboarding/wallet_draft";

// Safe-area insets, project-wide. See test_support/safe_area_mock.ts for why
// the two hooks need a no-provider answer here and why only they are replaced.
// Registered globally rather than per-suite because the surfaces that read
// insets (every onboarding step through OnboardingFrame, every picker through
// BottomSheet) are mounted directly by suites that have no interest in the
// system bars at all.
jest.mock("react-native-safe-area-context", () => {
  // Required lazily: `jest.mock` factories run before this file's own imports.
  const { createSafeAreaMock } = require("./safe_area_mock") as typeof import("./safe_area_mock");
  return createSafeAreaMock();
});

// RNTL's async utilities default to a ONE SECOND budget, which this suite has
// outgrown. A screen test here renders a real component tree over a real
// SQLite database, and under `--ci` parallelism several run at once competing
// for the same CPU — so a query that resolves in 200ms alone can take several
// seconds under load.
//
// The failures this fixes were the dangerous kind: green in isolation, red in
// the full run, and worded as product bugs ("filters don't compose", "the
// ledger is empty") rather than as timing. Chasing one of those as a real
// defect costs far more than the seconds spent waiting here — and a suite that
// is only sometimes green teaches everyone to re-run it instead of read it.
//
// This is a CEILING, not a delay. `waitFor` still returns the instant its
// condition holds, so a passing test is no slower; only a genuinely hung one
// waits the full budget. Jest's own `testTimeout` (package.json) sits above it
// so the more specific RNTL failure message wins.
configure({ asyncUtilTimeout: 15_000 });

// The onboarding wallet step's draft is a module-level value that deliberately
// survives an unmount (lib/onboarding/wallet_draft.ts) — which is exactly what
// makes it survive a TEST too, so the second test in a file would otherwise
// mount the step already holding the first one's proposals. Cleared project-
// wide rather than in the one suite that owns the screen, because any suite
// that renders it (the end-to-end setup flow, future step suites) inherits the
// same hazard, and a leak here surfaces as a wrong-looking product assertion
// rather than as shared state.
beforeEach(() => {
  clearWalletDraft();
});
