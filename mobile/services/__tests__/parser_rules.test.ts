// services/__tests__/parser_rules.test.ts — M3c Task 5. Follows the same
// transport-mocking approach as services/__tests__/api.test.ts: `apiClient`
// is a real axios instance, and every request below is answered by swapping
// `apiClient.defaults.adapter` — axios's own supported way to replace the
// transport — so no test ever opens a socket. The server this hits does not
// exist yet (see services/api.ts's header); offline is this app's normal
// operating condition, not a test-only stand-in for one.
// GAP-043 — THE SIGNATURE CHECK IS MOCKED HERE, AND ONLY HERE. Every fixture
// below is a body this file invents, and no test can produce a valid signature
// under the shipped public key, because that needs the private half and it is
// not in this repository. The real Ed25519 path is tested against a generated
// keypair in lib/ingest/__tests__/ruleset_signature.test.ts; what THIS file is
// for is the fetch path's behaviour on either side of that verdict, so the
// verdict is what gets controlled.
//
// DEFAULTS TO TRUE so every pre-existing test below goes on asserting exactly
// what it always did. The two tests that set it false are the new ones, and
// they are the reason the flag exists.
let mockSignatureValid = true;
jest.mock("@/lib/ingest/ruleset_signature", () => ({
  ...jest.requireActual<typeof import("@/lib/ingest/ruleset_signature")>(
    "@/lib/ingest/ruleset_signature",
  ),
  verifyRulesetSignature: (...args: unknown[]) => {
    mockSignatureCalls.push(args as [string, string | null | undefined]);
    return mockSignatureValid;
  },
}));

const mockSignatureCalls: [string, string | null | undefined][] = [];

import type { AxiosAdapter } from "axios";

import { closeDatabase } from "@/lib/db/database";
import {
  getActiveRuleset,
  getActiveVersion,
  upsertRuleset,
} from "@/lib/db/repos/parser_rulesets_repo";
import { MAX_RESPONSE_CHARS } from "@/lib/ingest/ruleset_schema";
import { RULESET_SIGNATURE_HEADER } from "@/lib/ingest/ruleset_signature";
import type { ProviderRuleset, ProviderTemplate } from "@/lib/ingest/ruleset_types";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";

import { apiClient } from "../api";
import { checkForRulesetUpdate } from "../parser_rules";

let db: SQLiteDatabase;
const originalAdapter = apiClient.defaults.adapter;

beforeEach(async () => {
  db = await freshDb();
  mockSignatureValid = true;
  mockSignatureCalls.length = 0;
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
  // A well-formed-looking signature header on every response, so the header
  // PLUMBING is exercised by every test here even though the verdict itself is
  // mocked. `respondWithoutSignature` below is the one that leaves it off.
  return async (config) => ({
    data: body,
    status,
    statusText: "",
    headers: { [RULESET_SIGNATURE_HEADER]: "ab".repeat(64) },
    config,
  });
}

/** A server that sends a bundle and no signature at all — what an attacker who
 * can serve the endpoint but does not hold the key is left with. */
function respondWithoutSignature(status: number, data: unknown): AxiosAdapter {
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

// ---------------------------------------------------------------------------
// GAP-043 — authenticity. docs/03 §11.2 rule 2.
// ---------------------------------------------------------------------------

// THE BUNDLE IN THIS TEST IS PERFECTLY VALID. It has a higher version, a
// well-formed provider and passes every schema check in the file — which is
// exactly the point: shape was never the thing in question. This is the bundle
// a compromised server, or a compromised TLS chain, would serve.
test("a schema-valid bundle that fails signature verification is NOT installed", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  mockSignatureValid = false;
  apiClient.defaults.adapter = respondWith(200, {
    version: 2,
    providers: [provider({ providerKey: "attacker" })],
  });

  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await checkForRulesetUpdate(1_000);

    expect(result).toEqual({ updated: false, version: 1 });
    // Failing CLOSED: the device keeps parsing with what it already had, and
    // does not fall back to no rules.
    const active = await getActiveRuleset();
    expect(active!.version).toBe(1);
    expect(active!.providers.map((p) => p.providerKey)).toEqual(["installed"]);
    expect(await rowCount()).toBe(1);
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

// No allowance for "unsigned while the server is being built": an allowance
// like that is what would still be switched on the day it went live.
test("a bundle with no signature header at all is refused", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  mockSignatureValid = false;
  apiClient.defaults.adapter = respondWithoutSignature(200, {
    version: 2,
    providers: [provider({ providerKey: "unsigned" })],
  });

  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await checkForRulesetUpdate(1_000);

    expect(result).toEqual({ updated: false, version: 1 });
    expect((await getActiveRuleset())!.version).toBe(1);
    // The header genuinely arrived as absent rather than as some default.
    expect(mockSignatureCalls.at(-1)?.[1]).toBeNull();
  } finally {
    warn.mockRestore();
  }
});

// Verification has to see the RAW text, byte for byte, because that is what is
// parsed a moment later. A verifier handed a re-serialized object would be
// checking a different artefact from the one that gets installed.
test("the signature is checked against the exact raw body, before anything is parsed", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  const bundle = { version: 2, providers: [provider({ providerKey: "new" })] };
  const raw = JSON.stringify(bundle);
  apiClient.defaults.adapter = respondWith(200, raw);

  await checkForRulesetUpdate(1_000);

  expect(mockSignatureCalls).toHaveLength(1);
  expect(mockSignatureCalls[0][0]).toBe(raw);
  expect(mockSignatureCalls[0][1]).toBe("ab".repeat(64));
});

// The cap is a denial-of-service control and runs first; verification must not
// be handed an uncapped body to hash.
test("an oversized body is refused without the signature ever being checked", async () => {
  await upsertRuleset({ version: 1, providers: [provider({ providerKey: "installed" })] });
  apiClient.defaults.adapter = respondWith(200, "x".repeat(MAX_RESPONSE_CHARS + 1));

  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await checkForRulesetUpdate(1_000);

    expect(result).toEqual({ updated: false, version: 1 });
    expect(mockSignatureCalls).toHaveLength(0);
  } finally {
    warn.mockRestore();
  }
});
