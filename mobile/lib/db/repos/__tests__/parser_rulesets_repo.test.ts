import { closeDatabase } from "@/lib/db/database";
import { freshDb } from "@/test_support/db";
import {
  DEFAULT_TRAIT_SIGNALS,
  DEFAULT_TUNABLES,
  type ProviderRuleset,
  type ProviderTemplate,
  type RulesetBundle,
} from "@/lib/ingest/ruleset_types";
import { getActiveRuleset, getActiveVersion, upsertRuleset } from "../parser_rulesets_repo";
import type { SQLiteDatabase } from "@/lib/db/database";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Fixtures
//
// ILLUSTRATIVE ONLY. Every notification-shaped string below is invented for
// this test file (docs/03-ingest-pipeline.md §11.4). These are NOT verified
// provider formats and must not be treated as parsing targets — the real
// formats are captured from devices and maintained as a versioned corpus
// before launch (§11.3).
// ---------------------------------------------------------------------------

/** Deliberately backslash-heavy: the escapes are what a sloppy JSON round-trip mangles. */
const GCASH_SEND_MATCH =
  "You have sent (?<amount>(?:₱|PHP\\s?)[\\d,]+\\.\\d{2}) to (?<counterparty>[A-Z][A-Z. ]+)\\. Ref\\. No\\. (?<ref>\\d{6,})";
const GCASH_SEND_SAMPLE = "You have sent ₱1,500.00 to JUAN D. Ref. No. 90210123";

const GCASH_SEND: ProviderTemplate = {
  id: "gcash_send_v1",
  match: GCASH_SEND_MATCH,
  direction: "out",
  confidence: 1.0,
};

const GCASH_RECEIVE: ProviderTemplate = {
  id: "gcash_receive_v1",
  match: "(?<amount>(?:₱|PHP\\s?)[\\d,]+\\.\\d{2}) has been credited to your account",
  direction: "in",
  // 0.70, not 1.00 — a repo that dropped the field and let it default to 1
  // must fail the round-trip test.
  confidence: 0.7,
};

function gcashProvider(): ProviderRuleset {
  return {
    providerKey: "gcash",
    packageNames: ["com.globe.gcash.android"],
    version: 3,
    channel: "push",
    templates: [GCASH_SEND, GCASH_RECEIVE],
  };
}

function smsProvider(): ProviderRuleset {
  return {
    providerKey: "sms_relay",
    packageNames: ["com.google.android.apps.messaging"],
    version: 2,
    channel: "sms",
    senderIds: ["BPI", "BDO", "MB", "LBP"],
    templates: [
      {
        id: "bpi_debit_v1",
        match: "was debited (?<amount>(?:₱|PHP\\s?)[\\d,]+\\.\\d{2})",
        direction: "out",
        confidence: 0.85,
      },
    ],
  };
}

/** A bundle with tunables deliberately different from DEFAULT_TUNABLES. */
function bundleWithCustomTunables(version: number, providers: ProviderRuleset[]): RulesetBundle {
  return {
    version,
    providers,
    tunables: {
      ...DEFAULT_TUNABLES,
      autoCommitThreshold: 0.95,
      penalties: { ...DEFAULT_TUNABLES.penalties, smsChannel: 0.2 },
    },
    traitSignals: DEFAULT_TRAIT_SIGNALS,
  };
}

function soloProviderBundle(version: number, providerKey: string): RulesetBundle {
  return {
    version,
    providers: [{ ...gcashProvider(), providerKey }],
    tunables: DEFAULT_TUNABLES,
    traitSignals: DEFAULT_TRAIT_SIGNALS,
  };
}

async function rowCount(): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM parser_rulesets",
  );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// The six named tests from the plan (Task 1, Step 1).
// ---------------------------------------------------------------------------

test("getActiveVersion is 0 on a fresh database", async () => {
  const version = await getActiveVersion();

  // Callers branch on 0 ("never fetched"). A null/undefined would make "never
  // fetched" indistinguishable from an error, and `since_version=null` would
  // be sent to the server as a broken query.
  expect(version).toBe(0);
  expect(typeof version).toBe("number");
});

test("upsertRuleset then getActiveRuleset round-trips the bundle including nested templates", async () => {
  await upsertRuleset(bundleWithCustomTunables(7, [gcashProvider(), smsProvider()]));

  const read = await getActiveRuleset();
  expect(read).not.toBeNull();
  expect(read!.version).toBe(7);
  expect(read!.providers).toHaveLength(2);

  const gcash = read!.providers[0];
  expect(gcash.providerKey).toBe("gcash");
  expect(gcash.packageNames).toEqual(["com.globe.gcash.android"]);
  expect(gcash.channel).toBe("push");
  expect(gcash.version).toBe(3);
  expect(gcash.templates).toHaveLength(2);

  // The nested assertions that matter: a repo storing only the top level, or
  // mangling the regex escapes, dies here rather than passing on "a bundle
  // came back".
  const sent = gcash.templates[0];
  expect(sent.id).toBe("gcash_send_v1");
  expect(sent.match).toBe(GCASH_SEND_MATCH);
  expect(sent.direction).toBe("out");
  expect(sent.confidence).toBe(1.0);

  // ...and the stored source is still a usable regex with working named groups.
  const executed = new RegExp(sent.match).exec(GCASH_SEND_SAMPLE);
  expect(executed).not.toBeNull();
  expect(executed!.groups?.amount).toBe("₱1,500.00");
  expect(executed!.groups?.counterparty).toBe("JUAN D");
  expect(executed!.groups?.ref).toBe("90210123");

  const received = gcash.templates[1];
  expect(received.id).toBe("gcash_receive_v1");
  expect(received.direction).toBe("in");
  expect(received.confidence).toBe(0.7);

  const sms = read!.providers[1];
  expect(sms.channel).toBe("sms");
  expect(sms.senderIds).toEqual(["BPI", "BDO", "MB", "LBP"]);
  expect(sms.templates[0].confidence).toBe(0.85);

  // Stored tunables win over the defaults.
  expect(read!.tunables.autoCommitThreshold).toBe(0.95);
  expect(read!.tunables.penalties.smsChannel).toBe(0.2);
});

test("a lower-version upsert is ignored", async () => {
  await upsertRuleset(bundleWithCustomTunables(5, [gcashProvider()]));
  await upsertRuleset(soloProviderBundle(2, "stale_server_response"));

  // Not merely "it didn't throw": the ACTIVE bundle must still be the higher one,
  // or a stale server response has silently regressed the device's parsers.
  const read = await getActiveRuleset();
  expect(read!.version).toBe(5);
  expect(read!.providers[0].providerKey).toBe("gcash");
  expect(read!.tunables.autoCommitThreshold).toBe(0.95);
  expect(await getActiveVersion()).toBe(5);

  // The downgrade was never written at all, not written-then-shadowed.
  expect(await rowCount()).toBe(1);
});

test("a higher-version upsert replaces the active bundle", async () => {
  await upsertRuleset(soloProviderBundle(1, "old_provider"));
  await upsertRuleset(soloProviderBundle(2, "new_provider"));

  const read = await getActiveRuleset();
  expect(read!.version).toBe(2);
  expect(read!.providers[0].providerKey).toBe("new_provider");
  expect(await getActiveVersion()).toBe(2);

  // Appending is the intended write shape — the superseded version stays on
  // disk so a bad ruleset can be rolled back (spec §11.2). What must change is
  // which row `getActiveRuleset` reads, asserted above.
  expect(await rowCount()).toBe(2);
});

test("a bundle with no tunables reads back with DEFAULT_TUNABLES", async () => {
  await upsertRuleset({ version: 1, providers: [gcashProvider()] });

  const read = await getActiveRuleset();
  // Not `undefined` — every downstream threshold would become NaN.
  expect(read!.tunables).toEqual(DEFAULT_TUNABLES);
  // Spot-check one literal so an empty DEFAULT_TUNABLES can't satisfy the line above.
  expect(read!.tunables.autoCommitThreshold).toBe(0.9);
  expect(read!.tunables.penalties.weakDirection).toBe(0.15);
});

test("DEFAULT_TUNABLES matches the spec values exactly", () => {
  // Every value written out as a LITERAL, copied from docs/03-ingest-pipeline.md
  // §6 (rules 1-2), §7 (rules 2-3), and §9.1-9.2. Deep-equalling against
  // anything derived from the export would be circular and would let any single
  // constant drift silently into every downstream stage.
  expect(DEFAULT_TUNABLES.dedupeStrongWindowMs).toBe(172_800_000); // §6.1 — 48 h
  expect(DEFAULT_TUNABLES.dedupeTwinWindowMs).toBe(180_000); // §6.2 — 180 s
  expect(DEFAULT_TUNABLES.transferPrimaryWindowMs).toBe(900_000); // §7.2.1 — 15 min
  expect(DEFAULT_TUNABLES.transferExtendedWindowMs).toBe(86_400_000); // §7.2.2 — 24 h
  expect(DEFAULT_TUNABLES.transferFeeFloorCentavos).toBe(2_500); // §7.3.2 — ₱25.00
  expect(DEFAULT_TUNABLES.transferFeeRate).toBe(0.01); // §7.3.2 — 1%
  expect(DEFAULT_TUNABLES.autoCommitThreshold).toBe(0.9); // §9.2 — ≥ 0.90
  expect(DEFAULT_TUNABLES.prefilledThreshold).toBe(0.6); // §9.2 — 0.60-0.89
  // §9.2 amendment, 2026-08-20 — the owner's rule verbatim: confidence
  // "higher than 50 should only be recognized for user to confirm".
  expect(DEFAULT_TUNABLES.reviewFloorThreshold).toBe(0.5);
  expect(DEFAULT_TUNABLES.penalties.weakDirection).toBe(0.15); // §9.1
  expect(DEFAULT_TUNABLES.penalties.amountAmbiguity).toBe(0.3); // §9.1
  expect(DEFAULT_TUNABLES.penalties.walletFallback).toBe(0.1); // §9.1
  expect(DEFAULT_TUNABLES.penalties.merchantMissing).toBe(0.05); // §9.1
  expect(DEFAULT_TUNABLES.penalties.smsChannel).toBe(0.05); // §9.1
  // ₱1.00 — docs/04-features/02-wallets.md §14 open question 1, an initial
  // value the M1 corpus is expected to correct.
  expect(DEFAULT_TUNABLES.balanceDriftToleranceCentavos).toBe(100);
  // The held/owed verdict's two gates, plus what a provider prior is worth.
  // No spec section to cite: these are chosen values, and the reasoning for
  // each is in ruleset_types.ts beside them.
  expect(DEFAULT_TUNABLES.walletTraits.owedMarginThreshold).toBe(300);
  expect(DEFAULT_TUNABLES.walletTraits.owedSampleFloor).toBe(3);
  expect(DEFAULT_TUNABLES.walletTraits.priorWeight).toBe(100);

  // The exact key set, so a tunable added or renamed without a spec value
  // pinned here fails instead of shipping unasserted.
  expect(Object.keys(DEFAULT_TUNABLES).sort()).toEqual([
    "autoCommitThreshold",
    "balanceDriftToleranceCentavos",
    "dedupeStrongWindowMs",
    "dedupeTwinWindowMs",
    "penalties",
    "prefilledThreshold",
    "reviewFloorThreshold",
    "transferExtendedWindowMs",
    "transferFeeFloorCentavos",
    "transferFeeRate",
    "transferPrimaryWindowMs",
    "walletTraits",
  ]);
  expect(Object.keys(DEFAULT_TUNABLES.walletTraits).sort()).toEqual([
    "owedMarginThreshold",
    "owedSampleFloor",
    "priorWeight",
  ]);
  expect(Object.keys(DEFAULT_TUNABLES.penalties).sort()).toEqual([
    "amountAmbiguity",
    "merchantMissing",
    "smsChannel",
    "walletFallback",
    "weakDirection",
  ]);
});

// ---------------------------------------------------------------------------
// Beyond the six: behaviours this repo has that the named list doesn't reach.
// ---------------------------------------------------------------------------

test("an equal-version upsert is ignored rather than violating the UNIQUE constraint", async () => {
  // `version` is UNIQUE in 001_core.sql, so an unguarded re-upsert of the
  // version already installed does not merely double-write — it THROWS. Task 2's
  // `seedParserRules()` is required to be idempotent, and re-running it is
  // exactly this call.
  await upsertRuleset(soloProviderBundle(3, "installed_provider"));
  await expect(upsertRuleset(soloProviderBundle(3, "same_version_different_body"))).resolves.toBeUndefined();

  const read = await getActiveRuleset();
  expect(read!.providers[0].providerKey).toBe("installed_provider");
  expect(await rowCount()).toBe(1);
});

test("two concurrent upserts of the same version write exactly one row", async () => {
  // Bootstrap can have `seedParserRules()` and a server fetch in flight at once.
  // A read-then-insert implementation lets both observe MAX(version) = 0 before
  // either writes, and the second INSERT then dies on the UNIQUE constraint —
  // at app start, where it is least recoverable.
  await Promise.all([
    upsertRuleset(soloProviderBundle(1, "seed")),
    upsertRuleset(soloProviderBundle(1, "server")),
  ]);

  expect(await rowCount()).toBe(1);
  expect(await getActiveVersion()).toBe(1);
});

test("a partial tunables object is completed from DEFAULT_TUNABLES", async () => {
  // A server that ships only the tunables it wants to change must not blank the
  // rest. Same failure as the missing-tunables case (NaN thresholds downstream),
  // one level deeper.
  await upsertRuleset({
    version: 1,
    providers: [gcashProvider()],
    tunables: { autoCommitThreshold: 0.95, penalties: { smsChannel: 0.2 } },
  });

  const read = await getActiveRuleset();
  expect(read!.tunables).toEqual({
    dedupeStrongWindowMs: 172_800_000,
    dedupeTwinWindowMs: 180_000,
    transferPrimaryWindowMs: 900_000,
    transferExtendedWindowMs: 86_400_000,
    transferFeeFloorCentavos: 2_500,
    transferFeeRate: 0.01,
    autoCommitThreshold: 0.95,
    prefilledThreshold: 0.6,
    reviewFloorThreshold: 0.5,
    balanceDriftToleranceCentavos: 100,
    walletTraits: { owedMarginThreshold: 300, owedSampleFloor: 3, priorWeight: 100 },
    penalties: {
      weakDirection: 0.15,
      amountAmbiguity: 0.3,
      walletFallback: 0.1,
      merchantMissing: 0.05,
      smsChannel: 0.2,
    },
  });
});

test("the balance-drift tolerance ships as ₱1.00 and is remotely retunable", async () => {
  // docs/04-features/02-wallets.md §14 open question 1 says this threshold is
  // UNKNOWN — "too tight makes noise, too loose hides parser rot" — and has to
  // be tuned against real parser accuracy during M1. An admittedly-unknown
  // number belongs in ruleset data, where the server can change it without an
  // app release, not in a constant that needs one. Below ₱1.00 is rounding;
  // above it is a real missed transaction.
  expect(DEFAULT_TUNABLES.balanceDriftToleranceCentavos).toBe(100);

  await upsertRuleset({
    version: 1,
    providers: [gcashProvider()],
    tunables: { balanceDriftToleranceCentavos: 5_000 },
  });
  const read = await getActiveRuleset();
  expect(read!.tunables.balanceDriftToleranceCentavos).toBe(5_000);
  // ...and retuning it alone leaves every other threshold on its shipped value.
  expect(read!.tunables.autoCommitThreshold).toBe(DEFAULT_TUNABLES.autoCommitThreshold);
});

test("a corrupt payload falls back to the newest parseable version instead of throwing", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await upsertRuleset(soloProviderBundle(1, "known_good"));
    // Simulates the one writer this repo does not control: a partially restored
    // backup or a hand-written row. Returning null here instead would leave the
    // pipeline with NO parsers at all, flooding the Review Queue.
    await db.runAsync(
      "INSERT INTO parser_rulesets (id, version, payload_json, installed_at) VALUES (?, ?, ?, ?)",
      ["corrupt-row", 2, '{"version": 2, "providers": [', 1_700_000_000_000],
    );

    const read = await getActiveRuleset();
    expect(read!.version).toBe(1);
    expect(read!.providers[0].providerKey).toBe("known_good");
    expect(warn).toHaveBeenCalled();

    // getActiveVersion stays the honest MAX(version): it is what the no-downgrade
    // guard compares against and what `?since_version=` sends to the server, so
    // the two must never disagree about what is installed.
    expect(await getActiveVersion()).toBe(2);
  } finally {
    warn.mockRestore();
  }
});

test("a bundle that names no trait signals reads back with the shipped pack", async () => {
  // SAME ARGUMENT AS withDefaultTunables, AND THE SAME PLACE IN THE LIFECYCLE:
  // filled on READ, so a ruleset installed before this feature existed picks up
  // whatever signal pack the app ships today rather than none at all.
  await upsertRuleset({
    version: 1,
    providers: [{ providerKey: "p", packageNames: ["com.p"], version: 1, channel: "push", templates: [] }],
  });

  const read = await getActiveRuleset();
  expect(read!.traitSignals).toEqual(DEFAULT_TRAIT_SIGNALS);
});

test("a bundle that names its own trait signals keeps them", async () => {
  await upsertRuleset({
    version: 1,
    providers: [{ providerKey: "p", packageNames: ["com.p"], version: 1, channel: "push", templates: [] }],
    traitSignals: [{ pattern: "utang", trait: "owed", weight: 500 }],
  });

  const read = await getActiveRuleset();
  expect(read!.traitSignals).toEqual([{ pattern: "utang", trait: "owed", weight: 500 }]);
});

test("a provider's owed prior survives the round trip", async () => {
  await upsertRuleset({
    version: 1,
    providers: [
      {
        providerKey: "somecard",
        packageNames: ["com.somecard"],
        version: 1,
        channel: "push",
        templates: [],
        traits: { owedBalance: "likely" },
      },
    ],
  });

  const read = await getActiveRuleset();
  expect(read!.providers[0].traits).toEqual({ owedBalance: "likely" });
});
