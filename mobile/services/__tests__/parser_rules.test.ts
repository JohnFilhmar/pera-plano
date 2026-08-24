// services/__tests__/parser_rules.test.ts — M3c Task 5. Follows the same
// transport-mocking approach as services/__tests__/api.test.ts: `apiClient`
// is a real axios instance, and every request below is answered by swapping
// `apiClient.defaults.adapter` — axios's own supported way to replace the
// transport — so no test ever opens a socket. The server this hits does not
// exist yet (see services/api.ts's header); offline is this app's normal
// operating condition, not a test-only stand-in for one.
import type { AxiosAdapter } from "axios";

import { closeDatabase } from "@/lib/db/database";
import {
  getActiveRuleset,
  getActiveVersion,
  upsertRuleset,
} from "@/lib/db/repos/parser_rulesets_repo";
import type { ProviderRuleset, ProviderTemplate } from "@/lib/ingest/ruleset_types";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";

import { apiClient } from "../api";
import { checkForRulesetUpdate } from "../parser_rules";

let db: SQLiteDatabase;
const originalAdapter = apiClient.defaults.adapter;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
  apiClient.defaults.adapter = originalAdapter;
});

// ---------------------------------------------------------------------------
// Fixtures. ILLUSTRATIVE ONLY — invented shapes for this test file, not
// verified provider formats (docs/03-ingest-pipeline.md §11.3-11.4).
// ---------------------------------------------------------------------------

function template(overrides: Partial<ProviderTemplate> = {}): ProviderTemplate {
  return {
    id: "t1",
    match: "(?<amount>(?:₱|PHP\\s?)[\\d,]+\\.\\d{2})",
    direction: "out",
    confidence: 1,
    ...overrides,
  };
}

function provider(overrides: Partial<ProviderRuleset> = {}): ProviderRuleset {
  return {
    providerKey: "test_provider",
    packageNames: ["com.example.test"],
    version: 1,
    channel: "push",
    templates: [template()],
    ...overrides,
  };
}

/** Resolves every request with the given status/body — never opens a socket. */
function respondWith(status: number, data: unknown): AxiosAdapter {
  return async (config) => ({ data, status, statusText: "", headers: {}, config });
}

/** Fails the way a real connection failure does: rejects with no `.response` at all. */
function failNetwork(message: string): AxiosAdapter {
  return async () => {
    throw new Error(message);
  };
}

async function rowCount(): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM parser_rulesets",
  );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// The eight named tests from the plan (Task 5, Step 1).
// ---------------------------------------------------------------------------

test("the request carries the current version as since_version", async () => {
  await upsertRuleset({ version: 5, providers: [provider({ providerKey: "installed" })] });

  const captured: { params?: unknown } = {};
  apiClient.defaults.adapter = async (config) => {
    captured.params = config.params;
    return { data: { version: 5, providers: [] }, status: 200, statusText: "OK", headers: {}, config };
  };

  await checkForRulesetUpdate(1_000);

  expect(captured.params).toEqual({ since_version: 5 });
});

test("an empty providers array leaves the stored ruleset unchanged", async () => {
  await upsertRuleset({ version: 3, providers: [provider({ providerKey: "installed" })] });
  apiClient.defaults.adapter = respondWith(200, { version: 3, providers: [] });

  const result = await checkForRulesetUpdate(1_000);

  expect(result).toEqual({ updated: false, version: 3 });
  expect(await getActiveVersion()).toBe(3);
  const active = await getActiveRuleset();
  expect(active!.providers[0].providerKey).toBe("installed");
  expect(await rowCount()).toBe(1);
});

test("a higher-version valid bundle is stored", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "old" })] });
  apiClient.defaults.adapter = respondWith(200, {
    version: 2,
    providers: [provider({ providerKey: "new" })],
  });

  const result = await checkForRulesetUpdate(1_000);

  expect(result).toEqual({ updated: true, version: 2 });
  expect(await getActiveVersion()).toBe(2);
  const active = await getActiveRuleset();
  expect(active!.version).toBe(2);
  expect(active!.providers[0].providerKey).toBe("new");
  // The superseded version stays on disk (rollback-safety, §11.2) — the row
  // count grows rather than an in-place overwrite.
  expect(await rowCount()).toBe(2);
});

test("a lower-version bundle is ignored", async () => {
  await upsertRuleset({ version: 5, providers: [provider({ providerKey: "installed" })] });
  apiClient.defaults.adapter = respondWith(200, {
    version: 3,
    providers: [provider({ providerKey: "stale" })],
  });

  const result = await checkForRulesetUpdate(1_000);

  expect(result).toEqual({ updated: false, version: 5 });
  expect(await getActiveVersion()).toBe(5);
  const active = await getActiveRuleset();
  expect(active!.providers[0].providerKey).toBe("installed");
  expect(await rowCount()).toBe(1);
});

test("a bundle with an uncompilable regex is discarded and the previous ruleset survives", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  const badProvider = provider({
    providerKey: "bad",
    templates: [template({ match: "(unterminated" })],
  });
  apiClient.defaults.adapter = respondWith(200, { version: 2, providers: [badProvider] });

  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await checkForRulesetUpdate(1_000);

    expect(result).toEqual({ updated: false, version: 1 });
    expect(await getActiveVersion()).toBe(1);
    const active = await getActiveRuleset();
    expect(active!.providers[0].providerKey).toBe("installed");
    expect(await rowCount()).toBe(1);
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("a bundle with an empty providers array but a higher version is discarded", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  apiClient.defaults.adapter = respondWith(200, { version: 99, providers: [] });

  const result = await checkForRulesetUpdate(1_000);

  expect(result).toEqual({ updated: false, version: 1 });
  expect(await getActiveVersion()).toBe(1);
  const active = await getActiveRuleset();
  expect(active!.providers[0].providerKey).toBe("installed");
  expect(await rowCount()).toBe(1);
});

test("a network failure resolves without throwing", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  apiClient.defaults.adapter = failNetwork("Network Error");

  await expect(checkForRulesetUpdate(1_000)).resolves.toEqual({ updated: false, version: 1 });
  expect(await getActiveVersion()).toBe(1);
});

test("a check inside the interval does not re-request", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  let callCount = 0;
  apiClient.defaults.adapter = async (config) => {
    callCount += 1;
    return { data: { version: 1, providers: [] }, status: 200, statusText: "OK", headers: {}, config };
  };

  const first = await checkForRulesetUpdate(1_000);
  // One minute later — well inside any reasonable "at most once per day"
  // interval.
  const second = await checkForRulesetUpdate(1_000 + 60_000);

  expect(callCount).toBe(1);
  expect(first).toEqual({ updated: false, version: 1 });
  expect(second).toEqual({ updated: false, version: 1 });
});
