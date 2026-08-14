// test_support/jest_setup_after_env.ts — configuration that needs the test
// framework to already exist.
//
// SEPARATE FROM jest_setup.ts ON PURPOSE. `setupFiles` runs BEFORE Jest's
// framework is installed, so anything requiring `@testing-library/react-native`
// there dies with "expect is not defined" — and it takes every suite in the
// project with it, because the failure is at module load. `setupFilesAfterEnv`
// runs after, which is where anything touching RNTL belongs.
import { configure } from "@testing-library/react-native";

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
