// mobile/lib/ai/eval/__tests__/fixture_tools_isolation.test.ts
//
// THE DATABASE LAYER IS BOOBY-TRAPPED FOR THIS WHOLE FILE. Every read of the
// user's ledger goes through `@/lib/db/database`, so if loading the fixture
// tools loads that module by ANY path, including a helper borrowed from a real
// handler that imports it, this suite fails to load. A check of
// `fixture_tools.ts`'s own source text cannot see an import one hop away.
import { FIXTURE_NOW_ISO } from "../fixture_ledger";
import { runFixtureTool } from "../fixture_tools";

jest.mock("@/lib/db/database", () => {
  throw new Error("the fixture tools reached @/lib/db/database");
});

test("the fixture tools load and answer without the database layer", async () => {
  const result = await runFixtureTool("list_transactions", { limit: 50 }, Date.parse(FIXTURE_NOW_ISO));

  expect(result.ok).toBe(true);
});
