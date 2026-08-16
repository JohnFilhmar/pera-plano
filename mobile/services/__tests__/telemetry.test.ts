// services/__tests__/telemetry.test.ts — M3c Task 6 Step 1.
//
// The client is mocked with `jest.spyOn(apiClient, "post")` — never a
// dynamic import, never a real socket (see services/__tests__/api.test.ts's
// header for why this suite never opens one). Everything else (app_settings,
// parse_stats) runs against the real sql.js-backed test database, because
// the promise this file exists to keep — "counts only, never content,"
// shown to the user on the Settings and Privacy Centre screens — has to hold
// against the ACTUAL serialized request body a real send would produce, not
// a stand-in for one.
//
// Test 1 (whitelist) and test 2 (privacy regression) are the two guards the
// brief says must never be deleted or loosened. Both were verified to
// actually fail before this file reached its final state: a merchant name
// and a device id were temporarily added to the request body, both tests
// went red, then the addition was reverted. See task-6-report.md.
import { closeDatabase } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { getParseStats, recordParseResult } from "@/lib/diagnostics/parse_stats_repo";
import { freshDb } from "@/test_support/db";

import { apiClient } from "../api";
import { sendParseStats } from "../telemetry";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date(2026, 7, 15, 12, 0).getTime();

/** Exactly the seven contract §6 fields — the whitelist this suite must never loosen. */
const ALLOWED_BODY_KEYS = [
  "appVersion",
  "rulesetVersion",
  "providerKey",
  "parsed",
  "failed",
  "periodStart",
  "periodEnd",
].sort();

/**
 * Field/value substrings that must never appear anywhere in the serialized
 * request body — scanned over `JSON.stringify(body)`, not `Object.keys`, so
 * a value smuggled a level deeper than the top level is still caught.
 */
const FORBIDDEN_SUBSTRINGS = [
  "merchant",
  "counterparty",
  "amount",
  "referenceno",
  "balance",
  "wallet",
  "note",
  "title",
  "subtext",
  "bigtext",
  "installid",
  "deviceid",
  "installationid",
  "advertisingid",
  "authorization",
  "juan dela cruz",
  "gcash - via",
];

function okResponse(status = 202) {
  return { data: {}, status, statusText: "", headers: {}, config: {} as never };
}

let postSpy: jest.SpiedFunction<typeof apiClient.post>;

beforeEach(async () => {
  await freshDb();
  postSpy = jest.spyOn(apiClient, "post").mockResolvedValue(okResponse());
});

afterEach(async () => {
  postSpy.mockRestore();
  await closeDatabase();
});

test("body keys are exactly the seven contract fields — whitelist assertion, must never be deleted or loosened", async () => {
  await setSetting("last_parser_ruleset_version", 4);
  await recordParseResult("gcash", true, NOW);

  const result = await sendParseStats(NOW);

  expect(result).toEqual({ sent: true });
  expect(postSpy).toHaveBeenCalledTimes(1);
  const [url, body] = postSpy.mock.calls[0]!;
  expect(url).toBe("/v1/telemetry/parse_stats");
  expect(Object.keys(body as object).sort()).toEqual(ALLOWED_BODY_KEYS);
  expect(body).toEqual({
    appVersion: expect.any(String),
    rulesetVersion: 4,
    providerKey: "gcash",
    parsed: 1,
    failed: 0,
    periodStart: 0,
    periodEnd: NOW,
  });
});

test("PRIVACY REGRESSION: no merchant, amount, text, or identifier appears anywhere in the serialized body", async () => {
  await recordParseResult("gcash", true, NOW);
  await recordParseResult("gcash", false, NOW);
  await recordParseResult("bpi-sms", true, NOW);

  await sendParseStats(NOW);

  const serialized = postSpy.mock.calls.map((call) => JSON.stringify(call[1])).join("\n").toLowerCase();
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    expect(serialized).not.toContain(forbidden);
  }
});

test("opt-out: telemetry_enabled off makes no request at all and returns sent: false", async () => {
  await setSetting("telemetry_enabled", false);
  await recordParseResult("gcash", true, NOW);

  const result = await sendParseStats(NOW);

  expect(result).toEqual({ sent: false });
  expect(postSpy).not.toHaveBeenCalled();
});

test("a successful send clears the stats window so counts are not double-reported", async () => {
  await recordParseResult("gcash", true, NOW);
  await recordParseResult("bpi-sms", false, NOW);

  const result = await sendParseStats(NOW);

  expect(result).toEqual({ sent: true });
  expect(await getParseStats(0)).toEqual([]);
  expect(await getSetting("last_telemetry_sent_at")).toBe(NOW);
});

test("a failed send does not clear the stats window — a network rejection loses nothing", async () => {
  postSpy.mockRejectedValueOnce({ status: 0, message: "Network Error" });
  await recordParseResult("gcash", true, NOW);

  const result = await sendParseStats(NOW);

  expect(result).toEqual({ sent: false });
  expect(await getParseStats(0)).toEqual([{ providerKey: "gcash", parsed: 1, failed: 0 }]);
  expect(await getSetting("last_telemetry_sent_at")).toBeNull();
});

test("a send inside the interval does not re-request", async () => {
  await recordParseResult("gcash", true, NOW);
  const first = await sendParseStats(NOW);
  expect(first).toEqual({ sent: true });
  expect(postSpy).toHaveBeenCalledTimes(1);

  // Well inside whatever interval sendParseStats enforces, and stats have
  // since accumulated again — still must not fire a second request.
  await recordParseResult("gcash", true, NOW + HOUR_MS);
  const second = await sendParseStats(NOW + HOUR_MS);

  expect(second).toEqual({ sent: false });
  expect(postSpy).toHaveBeenCalledTimes(1);
});

test("zero stats sends nothing", async () => {
  const result = await sendParseStats(NOW);

  expect(result).toEqual({ sent: false });
  expect(postSpy).not.toHaveBeenCalled();
});
