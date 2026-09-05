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
import { MAX_RESPONSE_CHARS } from "@/lib/ingest/ruleset_schema";
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

/**
 * Resolves every request with the given status/body — never opens a socket.
 *
 * The body is SERIALIZED, matching what the transport really hands back:
 * `checkForRulesetUpdate` asks for text with axios's JSON transform off so it
 * can cap the body before anything parses it, so an adapter that resolved with
 * a ready-made object would be testing a code path the device never takes. A
 * string is passed straight through, which is how the malformed-JSON and
 * oversized cases below are written.
 */
function respondWith(status: number, data: unknown): AxiosAdapter {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  return async (config) => ({ data: body, status, statusText: "", headers: {}, config });
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

/** The newest stored payload, exactly as it sits on disk. */
async function storedPayload(): Promise<Record<string, unknown>> {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM parser_rulesets ORDER BY version DESC LIMIT 1",
  );
  return JSON.parse(row!.payload_json) as Record<string, unknown>;
}

/**
 * Installs version 1, answers the next request with `body`, and asserts the
 * device is exactly where it started: same version, same providers, no extra
 * row, and a warning so a rejected bundle is not silent.
 *
 * FAILING CLOSED IS THE ASSERTION. Rejecting a hostile bundle is only half of
 * it — the device has to keep parsing with the ruleset it already had, never
 * fall back to no rules and never to a half-applied one.
 */
async function expectDiscarded(body: unknown): Promise<void> {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  apiClient.defaults.adapter = respondWith(200, body);

  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await checkForRulesetUpdate(1_000);

    expect(result).toEqual({ updated: false, version: 1 });
    expect(await getActiveVersion()).toBe(1);
    const active = await getActiveRuleset();
    expect(active!.version).toBe(1);
    expect(active!.providers).toHaveLength(1);
    expect(active!.providers[0].providerKey).toBe("installed");
    expect(await rowCount()).toBe(1);
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// The eight named tests from the plan (Task 5, Step 1).
// ---------------------------------------------------------------------------

test("the request carries the current version as since_version", async () => {
  await upsertRuleset({ version: 5, providers: [provider({ providerKey: "installed" })] });

  const captured: { params?: unknown } = {};
  apiClient.defaults.adapter = async (config) => {
    captured.params = config.params;
    const data = JSON.stringify({ version: 5, providers: [] });
    return { data, status: 200, statusText: "OK", headers: {}, config };
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
    const data = JSON.stringify({ version: 1, providers: [] });
    return { data, status: 200, statusText: "OK", headers: {}, config };
  };

  const first = await checkForRulesetUpdate(1_000);
  // One minute later — well inside any reasonable "at most once per day"
  // interval.
  const second = await checkForRulesetUpdate(1_000 + 60_000);

  expect(callCount).toBe(1);
  expect(first).toEqual({ updated: false, version: 1 });
  expect(second).toEqual({ updated: false, version: 1 });
});

// ---------------------------------------------------------------------------
// Hostile bundles (GAP-014).
//
// The host behind `/v1/parser_rules` does not exist yet, so whoever eventually
// stands it up — or anyone who can intercept TLS to it — is the attacker here.
// Every payload below was ACCEPTED AND STORED by the pre-schema check, because
// that check only asked whether each `match` compiled. Each one now has to be
// discarded with the previous ruleset still in place; `expectDiscarded` asserts
// both halves.
// ---------------------------------------------------------------------------

test("a bundle whose providers are the wrong shape is discarded", async () => {
  // Every `match` here compiles, which is all the old check ever asked.
  await expectDiscarded({
    version: 2,
    providers: [
      {
        providerKey: 42,
        packageNames: "com.example.evil",
        version: "one",
        channel: "carrier_pigeon",
        templates: [{ id: null, match: "paid", confidence: "high" }],
      },
    ],
  });
});

test("a bundle that lowers autoCommitThreshold to 0 is discarded", async () => {
  // The one that matters most: 0 is a well-typed number and it books every
  // capture, however badly parsed, without the user ever seeing it.
  await expectDiscarded({
    version: 2,
    providers: [provider({ providerKey: "evil" })],
    tunables: { autoCommitThreshold: 0 },
  });
});

test("a bundle with thresholds out of order is discarded", async () => {
  await expectDiscarded({
    version: 2,
    providers: [provider({ providerKey: "evil" })],
    tunables: { prefilledThreshold: 0.95, autoCommitThreshold: 0.91 },
  });
});

test("a bundle with a NaN penalty is discarded", async () => {
  // JSON has no NaN literal, so this is how it actually arrives on the wire:
  // a string the old code never looked at, which `confidence_gate` would have
  // turned into NaN and compared against forever.
  await expectDiscarded({
    version: 2,
    providers: [provider({ providerKey: "evil" })],
    tunables: { penalties: { smsChannel: "not a number" } },
  });
});

test("a bundle carrying a catastrophic regex is discarded", async () => {
  await expectDiscarded({
    version: 2,
    providers: [
      provider({ providerKey: "evil", templates: [template({ match: "^(a+)+$" })] }),
    ],
  });
});

test("a response body over the size cap is discarded before it is parsed", async () => {
  // A bundle that would otherwise install cleanly, padded past the cap. Only
  // the size check can reject it, so this test is about the cap and nothing
  // else.
  const oversized = JSON.stringify({
    version: 2,
    providers: [provider({ providerKey: "evil" })],
    padding: "x".repeat(MAX_RESPONSE_CHARS),
  });
  expect(oversized.length).toBeGreaterThan(MAX_RESPONSE_CHARS);

  const parse = jest.spyOn(JSON, "parse");
  try {
    await expectDiscarded(oversized);

    // The cap has to run BEFORE the parse or it is not a cap: a body this size
    // must never have reached JSON.parse at all.
    const parsedAnythingOversized = parse.mock.calls.some(
      ([text]) => typeof text === "string" && text.length > MAX_RESPONSE_CHARS,
    );
    expect(parsedAnythingOversized).toBe(false);
  } finally {
    parse.mockRestore();
  }
});

test("a body that is not JSON at all is discarded", async () => {
  await expectDiscarded("<html>504 Gateway Timeout</html>");
});

test("unknown top-level keys are stripped rather than stored verbatim", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  apiClient.defaults.adapter = respondWith(200, {
    version: 2,
    providers: [provider({ providerKey: "new" })],
    payload: "x".repeat(2_000),
  });

  const result = await checkForRulesetUpdate(1_000);

  expect(result).toEqual({ updated: true, version: 2 });
  expect(Object.keys(await storedPayload()).sort()).toEqual(["providers", "version"]);
});

test("a bundle that only retunes thresholds inside their ranges still installs", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  apiClient.defaults.adapter = respondWith(200, {
    version: 2,
    providers: [provider({ providerKey: "new" })],
    tunables: { autoCommitThreshold: 0.95, prefilledThreshold: 0.7 },
  });

  const result = await checkForRulesetUpdate(1_000);

  expect(result).toEqual({ updated: true, version: 2 });
  const active = await getActiveRuleset();
  expect(active!.tunables.autoCommitThreshold).toBe(0.95);
  expect(active!.tunables.prefilledThreshold).toBe(0.7);
  // Untouched keys still come from DEFAULT_TUNABLES.
  expect(active!.tunables.reviewFloorThreshold).toBe(0.5);
});
