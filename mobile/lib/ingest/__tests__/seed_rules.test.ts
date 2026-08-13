// lib/ingest/__tests__/seed_rules.test.ts — guards the bundled PH provider
// catalogue and the bootstrap seed path.
//
// ILLUSTRATIVE ONLY. Every notification-shaped string in this file — and every
// pattern in assets/parser_rules/seed.json that they exercise — is INVENTED for
// planning (docs/03-ingest-pipeline.md §11.4). Nobody has captured a real
// GCash, Maya or bank notification for this project. These are NOT verified
// provider formats: the real ones are captured from team devices and kept as a
// versioned corpus before launch (§11.3). The `_note` test below exists so that
// disclaimer cannot be quietly deleted from the shipped JSON.
import { closeDatabase } from "@/lib/db/database";
import {
  getActiveRuleset,
  getActiveVersion,
  upsertRuleset,
} from "@/lib/db/repos/parser_rulesets_repo";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { SEED_BUNDLE, seedParserRules } from "@/lib/ingest/seed_rules";
import { freshDb } from "@/test_support/db";
import seedJson from "@/assets/parser_rules/seed.json";
import type { SQLiteDatabase } from "@/lib/db/database";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

async function rowCount(): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM parser_rulesets",
  );
  return row?.count ?? 0;
}

/** The raw JSON as parsed, for the assertions that are about the FILE, not the typed view. */
const RAW = seedJson as unknown as Record<string, unknown>;

// ---------------------------------------------------------------------------
// The catalogue, written out as literals.
//
// Deliberately NOT derived from SEED_BUNDLE: a test that iterates whatever the
// file happens to contain asserts nothing at all, and would stay green while a
// provider silently disappeared from the shipped catalogue.
// ---------------------------------------------------------------------------

/** docs/03-ingest-pipeline.md §10, the twelve push providers. */
const CATALOGUE = [
  "gcash",
  "maya",
  "bpi",
  "bdo",
  "unionbank",
  "metrobank",
  "seabank",
  "gotyme",
  "cimb",
  "landbank",
  "shopeepay",
  "grabpay",
] as const;

/** §10's thirteenth row: the default Messages app, relaying bank SMS. */
const SMS_PROVIDER_KEY = "sms_relay";

const ALL_PROVIDER_KEYS: string[] = [...CATALOGUE, SMS_PROVIDER_KEY];

/**
 * Verbatim from the plan (rule 2) and task brief. Any edit to the shipped
 * string — including "softening" it — must fail this suite.
 */
const REQUIRED_NOTE =
  "Illustrative patterns only. Real notification formats must be captured from devices and " +
  "maintained as a versioned corpus before launch — see docs/03-ingest-pipeline.md §11.";

// ---------------------------------------------------------------------------
// Illustrative samples, one per template id.
//
// INVENTED. Their only job is to prove each shipped regex can actually bind an
// amount — a pattern that compiles, carries an `(?<amount>…)` group and matches
// nothing is the failure this catches.
// ---------------------------------------------------------------------------

const SAMPLES: Record<string, { text: string; amount: string }> = {
  gcash_send_v1: {
    text: "You have sent ₱1,500.00 to JUAN D. Ref. No. 90210123. Your new balance is ₱2,350.75.",
    amount: "₱1,500.00",
  },
  gcash_receive_v1: {
    text: "You have received ₱500.00 from MARIA S. Ref. No. 90210124. Your new balance is ₱2,850.75.",
    amount: "₱500.00",
  },
  gcash_cash_in_v1: {
    text: "Cash In of ₱1,000.00 from BPI was successful. Ref. No. 55512345. Your new balance is ₱3,850.75.",
    amount: "₱1,000.00",
  },
  gcash_pay_qr_v1: {
    text: "You paid ₱349.00 to SARI SARI STORE via QR. Ref. No. 88123456.",
    amount: "₱349.00",
  },
  gcash_buy_load_v1: {
    text: "You have successfully loaded ₱100.00 to 0917XXXXXXX. Ref. No. 77123456.",
    amount: "₱100.00",
  },
  maya_send_v1: {
    text: "You sent ₱1,200.00 to Juan Dela Cruz. Ref No. MY1234567. Your new balance is ₱4,300.00.",
    amount: "₱1,200.00",
  },
  maya_receive_v1: {
    text: "You received ₱800.00 from Maria Santos. Ref No. MY7654321. Your new balance is ₱5,100.00.",
    amount: "₱800.00",
  },
  maya_pay_v1: {
    text: "Payment of ₱349.00 to Jollibee was successful. Ref No. MY2222333.",
    amount: "₱349.00",
  },
  bpi_debit_v1: {
    text: "BPI: Your account ending 1234 was debited ₱2,000.00 on 08/02 via ATM. Ref No. BPI123456. Your available balance is ₱18,250.00.",
    amount: "₱2,000.00",
  },
  bpi_credit_v1: {
    text: "BPI: Your account ending 1234 was credited ₱5,000.00 via InstaPay from JUAN D. Ref No. BPI654321. Your available balance is ₱23,250.00.",
    amount: "₱5,000.00",
  },
  bdo_debit_v1: {
    text: "BDO: A purchase of ₱1,250.00 at SM SUPERMARKET was posted to your account. Ref No. BDO112233. Your available balance is ₱9,100.00.",
    amount: "₱1,250.00",
  },
  bdo_credit_v1: {
    text: "BDO: A credit of ₱3,000.00 from JUAN DELA CRUZ was posted to your account. Ref No. BDO445566. Your available balance is ₱12,100.00.",
    amount: "₱3,000.00",
  },
  unionbank_debit_v1: {
    text: "UnionBank: Your account was debited ₱750.00 for GRAB PH. Ref No. UB998877. Available balance is ₱4,120.50.",
    amount: "₱750.00",
  },
  unionbank_credit_v1: {
    text: "UnionBank: Your account was credited ₱10,000.00 from PAYROLL. Ref No. UB776655. Available balance is ₱14,120.50.",
    amount: "₱10,000.00",
  },
  metrobank_debit_v1: {
    text: "Metrobank: Your account has been debited ₱1,800.00 via POS at ROBINSONS. Ref No. MB334455. Your balance is ₱7,650.00.",
    amount: "₱1,800.00",
  },
  metrobank_credit_v1: {
    text: "Metrobank: Your account has been credited ₱2,500.00 from INSTAPAY TRANSFER. Ref No. MB556677. Your balance is ₱10,150.00.",
    amount: "₱2,500.00",
  },
  seabank_transfer_out_v1: {
    text: "Transfer of ₱600.00 to JUAN D was successful. Ref No. SB123456. Your balance is ₱2,400.00.",
    amount: "₱600.00",
  },
  seabank_transfer_in_v1: {
    text: "You have received ₱1,000.00 from MARIA S. Ref No. SB654321. Your balance is ₱3,400.00.",
    amount: "₱1,000.00",
  },
  seabank_interest_v1: {
    text: "Interest of ₱12.34 has been credited to your account. Your balance is ₱3,412.34.",
    amount: "₱12.34",
  },
  gotyme_send_v1: {
    text: "You've sent ₱450.00 to Ana Cruz. Ref No. GT123456. New balance: ₱1,050.00.",
    amount: "₱450.00",
  },
  gotyme_receive_v1: {
    text: "You've received ₱1,500.00 from GoTyme Payroll. Ref No. GT654321. New balance: ₱2,550.00.",
    amount: "₱1,500.00",
  },
  cimb_debit_v1: {
    text: "Transfer of ₱2,000.00 to JUAN D was completed. Ref No. CIMB1234. Your balance is ₱6,000.00.",
    amount: "₱2,000.00",
  },
  cimb_credit_v1: {
    text: "Your account was credited with ₱4,000.00 from INSTAPAY. Ref No. CIMB4321. Your balance is ₱10,000.00.",
    amount: "₱4,000.00",
  },
  landbank_debit_v1: {
    text: "LANDBANK: Debit of ₱900.00 via ATM was posted to your account. Ref No. LBP123456. Your balance is ₱5,600.00.",
    amount: "₱900.00",
  },
  landbank_credit_v1: {
    text: "LANDBANK: Credit of ₱15,000.00 from DBM PAYROLL was posted to your account. Ref No. LBP654321. Your balance is ₱20,600.00.",
    amount: "₱15,000.00",
  },
  shopeepay_pay_v1: {
    text: "Paid ₱250.00 for Order 220811 using ShopeePay. Ref No. SP123456.",
    amount: "₱250.00",
  },
  shopeepay_top_up_v1: {
    text: "Top-up of ₱500.00 to your ShopeePay wallet was successful. Ref No. SP654321. Your balance is ₱750.00.",
    amount: "₱500.00",
  },
  shopeepay_refund_v1: {
    text: "Refund of ₱199.00 for Order 220754 has been credited to your ShopeePay. Your balance is ₱949.00.",
    amount: "₱199.00",
  },
  grabpay_pay_v1: {
    text: "Paid ₱180.00 for GrabCar ride using GrabPay. Ref No. GP123456.",
    amount: "₱180.00",
  },
  grabpay_top_up_v1: {
    text: "Top Up of ₱1,000.00 to your GrabPay wallet was successful. Ref No. GP654321. Your balance is ₱1,180.00.",
    amount: "₱1,000.00",
  },
  sms_bank_debit_v1: {
    text: "BPI: Your account ending 1234 was debited PHP 2,000.00 on 08/02 via ATM. Ref No. 9012345678. Available balance PHP 18,250.00.",
    amount: "PHP 2,000.00",
  },
  sms_bank_credit_v1: {
    text: "BDO: Your account ending 5678 was credited PHP 7,500.00 via InstaPay from JUAN D. Ref No. 9087654321. Available balance PHP 25,750.00.",
    amount: "PHP 7,500.00",
  },
};

function templateById(id: string) {
  const found = SEED_BUNDLE.providers.flatMap((p) => p.templates).find((t) => t.id === id);
  if (!found) {
    throw new Error(`no template with id ${id} in the seed bundle`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// The disclaimer. First test in the file on purpose.
// ---------------------------------------------------------------------------

test("seed.json carries the illustrative-patterns disclaimer verbatim as its first key", () => {
  // First key, so it is the first thing anyone opening the file reads — not
  // buried under 400 lines of regex where it can be skimmed past.
  expect(Object.keys(RAW)[0]).toBe("_note");

  // Byte-exact. Softening the wording ("mostly illustrative", dropping the
  // corpus sentence) is exactly the failure this guards: it would let someone
  // ship believing these parsers had been validated against real devices.
  expect(RAW._note).toBe(REQUIRED_NOTE);

  // ...and it travels with the row, so a device dump or a support log carries
  // the same warning the file does.
  expect(JSON.stringify(SEED_BUNDLE)).toContain(REQUIRED_NOTE);
});

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

test("every provider in the §10 catalogue is present with at least two templates", () => {
  for (const key of ALL_PROVIDER_KEYS) {
    const provider = SEED_BUNDLE.providers.find((p) => p.providerKey === key);
    expect(provider).toBeDefined();
    // At least a send/debit and a receive/credit (plan rule 3). One template
    // means one direction, and half that provider's money is invisible.
    expect(provider!.templates.length).toBeGreaterThanOrEqual(2);
  }

  // No extras beyond the thirteen the catalogue names, so a stray half-finished
  // provider cannot ride along unreviewed.
  expect(SEED_BUNDLE.providers).toHaveLength(ALL_PROVIDER_KEYS.length);
});

test("every providerKey is unique", () => {
  const keys = SEED_BUNDLE.providers.map((p) => p.providerKey);
  // A duplicate key would have one provider silently shadow the other,
  // depending on which the router happens to reach first.
  expect(new Set(keys).size).toBe(keys.length);
});

test("every template id is unique across the whole bundle", () => {
  const ids = SEED_BUNDLE.providers.flatMap((p) => p.templates).map((t) => t.id);
  // Every parse records the template that produced it (spec §4 rule 5); two
  // templates sharing an id makes a parser regression untraceable.
  expect(new Set(ids).size).toBe(ids.length);
});

test("every provider ships at least one non-empty packageNames entry", () => {
  for (const provider of SEED_BUNDLE.providers) {
    // An empty array makes source_router (Task 3) never route to this provider —
    // the provider is shipped but dead, and nothing else would notice.
    expect(provider.packageNames.length).toBeGreaterThan(0);
    for (const name of provider.packageNames) {
      expect(name.trim()).not.toBe("");
      // Android package names are dotted; a bare app label here would never match.
      expect(name).toMatch(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);
    }
  }
});

test("the SMS provider entry is channel sms with non-empty senderIds", () => {
  const sms = SEED_BUNDLE.providers.find((p) => p.providerKey === SMS_PROVIDER_KEY);
  expect(sms).toBeDefined();
  expect(sms!.channel).toBe("sms");

  // Spec §3 rule 2: without sender IDs the Messages-app entry either routes
  // nothing, or routes a personal text from a friend as bank SMS.
  expect(sms!.senderIds).toBeDefined();
  expect(sms!.senderIds!.length).toBeGreaterThan(0);
  for (const id of sms!.senderIds!) {
    expect(id.trim()).not.toBe("");
  }
  // The prefixes §10 names explicitly.
  expect(sms!.senderIds).toEqual(expect.arrayContaining(["BPI", "BDO", "MB", "LBP"]));

  // Only the SMS entry carries sender IDs; a push provider with them would mean
  // the channel field and the routing data disagree.
  for (const provider of SEED_BUNDLE.providers) {
    if (provider.providerKey !== SMS_PROVIDER_KEY) {
      expect(provider.channel).toBe("push");
      expect(provider.senderIds).toBeUndefined();
    }
  }
});

test("GCash carries cash-in, pay-QR and buy-load templates on top of send and receive", () => {
  const gcash = SEED_BUNDLE.providers.find((p) => p.providerKey === "gcash");
  const ids = gcash!.templates.map((t) => t.id);
  // Plan rule 3 names these five by event, not by id — the ids are ours, but
  // the five distinct events must all be covered.
  expect(ids).toEqual(
    expect.arrayContaining([
      "gcash_send_v1",
      "gcash_receive_v1",
      "gcash_cash_in_v1",
      "gcash_pay_qr_v1",
      "gcash_buy_load_v1",
    ]),
  );
});

test("every provider covers both directions — at least one out template and one in template", () => {
  for (const provider of SEED_BUNDLE.providers) {
    const directions = provider.templates.map((t) => t.direction);
    expect(directions).toContain("out");
    expect(directions).toContain("in");
  }
});

// ---------------------------------------------------------------------------
// The patterns themselves
// ---------------------------------------------------------------------------

test("every template's match compiles as a regex and declares a named amount group", () => {
  for (const provider of SEED_BUNDLE.providers) {
    for (const template of provider.templates) {
      // Actually CONSTRUCT it: a string check for "(?<amount>" passes happily on
      // a source with an unbalanced paren, which throws at construction and gets
      // skipped at runtime (spec §4 rule 4) — a template that never fires.
      expect(() => new RegExp(template.match)).not.toThrow();
      expect(new RegExp(template.match).source).toContain("(?<amount>");
    }
  }
});

test("every template declares a valid direction and a confidence inside [0, 1]", () => {
  for (const provider of SEED_BUNDLE.providers) {
    expect(["push", "sms"]).toContain(provider.channel);
    expect(provider.version).toBe(1);

    for (const template of provider.templates) {
      // Every seed template fixes its own direction, so parser.ts never has to
      // fall back to weak keyword cues and take the §9.1 0.15 penalty.
      expect(["in", "out"]).toContain(template.direction);
      expect(typeof template.confidence).toBe("number");
      expect(template.confidence).toBeGreaterThan(0);
      expect(template.confidence).toBeLessThanOrEqual(1);
    }
  }
});

test("every template matches its illustrative sample and binds the amount", () => {
  const ids = SEED_BUNDLE.providers.flatMap((p) => p.templates).map((t) => t.id);

  // Bidirectional: a new template with no sample, or a sample for a template
  // that was deleted, both fail here rather than silently going unexercised.
  expect(Object.keys(SAMPLES).sort()).toEqual([...ids].sort());

  // A regex that compiles but matches nothing is the most likely defect in a
  // file of invented patterns. Collected into one object so a failure names
  // every offending template at once instead of stopping at the first.
  const bound: Record<string, string | undefined> = {};
  const expected: Record<string, string | undefined> = {};
  for (const id of ids) {
    const { text, amount } = SAMPLES[id];
    bound[id] = new RegExp(templateById(id).match).exec(text)?.groups?.amount;
    expected[id] = amount;
  }
  expect(bound).toEqual(expected);
});

test("thousands separators and both the ₱ and PHP prefixes are tolerated", () => {
  // Plan rule 4. Driven off the shipped patterns, one of each form.
  const peso = new RegExp(templateById("gcash_send_v1").match).exec(
    "You have sent ₱1,250.00 to JUAN D.",
  );
  expect(peso!.groups?.amount).toBe("₱1,250.00");

  const php = new RegExp(templateById("sms_bank_debit_v1").match).exec(
    "Your account was debited PHP 1,250.00.",
  );
  expect(php!.groups?.amount).toBe("PHP 1,250.00");
});

test("merchant and reference groups are optional — the same templates match without them", () => {
  // Plan rule 4. A template that only fires when a merchant or a reference
  // number is present silently misses half its provider's notifications, and
  // the miss looks exactly like "the user made no transactions".
  const bareSend = new RegExp(templateById("gcash_send_v1").match).exec(
    "You have sent ₱1,500.00 to JUAN D.",
  );
  expect(bareSend).not.toBeNull();
  expect(bareSend!.groups?.amount).toBe("₱1,500.00");
  expect(bareSend!.groups?.counterparty).toBe("JUAN D");
  expect(bareSend!.groups?.ref).toBeUndefined();
  expect(bareSend!.groups?.balance).toBeUndefined();

  const bareQr = new RegExp(templateById("gcash_pay_qr_v1").match).exec(
    "You paid ₱349.00 via QR.",
  );
  expect(bareQr).not.toBeNull();
  expect(bareQr!.groups?.amount).toBe("₱349.00");
  expect(bareQr!.groups?.merchant).toBeUndefined();

  const barePay = new RegExp(templateById("maya_pay_v1").match).exec(
    "Payment of ₱349.00 was successful.",
  );
  expect(barePay!.groups?.amount).toBe("₱349.00");
  expect(barePay!.groups?.merchant).toBeUndefined();

  const bareShopee = new RegExp(templateById("shopeepay_pay_v1").match).exec(
    "Paid ₱250.00 using ShopeePay.",
  );
  expect(bareShopee!.groups?.amount).toBe("₱250.00");
  expect(bareShopee!.groups?.merchant).toBeUndefined();

  // No trailing period at all — the shortest realistic collapsed notification.
  const bareDebit = new RegExp(templateById("bpi_debit_v1").match).exec(
    "Your account was debited ₱2,000.00",
  );
  expect(bareDebit!.groups?.amount).toBe("₱2,000.00");
  expect(bareDebit!.groups?.merchant).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Tunables: deliberately absent
// ---------------------------------------------------------------------------

test("seed.json omits tunables so DEFAULT_TUNABLES stays the single source of truth", () => {
  // The repo merges tunables on READ, so restating the fourteen constants here
  // would buy nothing and create a second copy that drifts the first time one
  // is recalibrated (spec §9.1) in ruleset_types.ts.
  expect(Object.keys(RAW)).not.toContain("tunables");
  expect(SEED_BUNDLE.tunables).toBeUndefined();
});

// ---------------------------------------------------------------------------
// seedParserRules()
// ---------------------------------------------------------------------------

test("seedParserRules installs version 1 on a fresh device, complete with default tunables", async () => {
  expect(await getActiveVersion()).toBe(0);

  await seedParserRules();

  expect(await getActiveVersion()).toBe(1);
  const read = await getActiveRuleset();
  expect(read!.version).toBe(1);
  expect(read!.providers.map((p) => p.providerKey)).toEqual(ALL_PROVIDER_KEYS);
  // Omitted on disk, complete on read — spec §11.5: the app parses fully
  // offline and on first run.
  expect(read!.tunables).toEqual(DEFAULT_TUNABLES);
});

test("seedParserRules is idempotent — a second run leaves exactly one row, still version 1", async () => {
  await seedParserRules();
  await seedParserRules();

  // `parser_rulesets.version` is UNIQUE, so a naive re-insert THROWS rather
  // than double-writing. Asserting the row count (not merely "it resolved")
  // is what distinguishes a real no-op from a swallowed exception.
  expect(await rowCount()).toBe(1);
  expect(await getActiveVersion()).toBe(1);
});

test("seedParserRules does not overwrite a higher server-supplied version", async () => {
  // A device that already fetched ruleset 2 must not be downgraded to the
  // bundled seed on the next cold start — that would silently regress every
  // parser on the device, on every launch, forever.
  await upsertRuleset({
    version: 2,
    providers: [
      {
        providerKey: "server_only_provider",
        packageNames: ["com.example.server"],
        version: 2,
        channel: "push",
        templates: [
          {
            id: "server_only_v1",
            match: "(?<amount>PHP [\\d,]+\\.\\d{2})",
            direction: "out",
            confidence: 1,
          },
        ],
      },
    ],
  });

  await seedParserRules();

  expect(await getActiveVersion()).toBe(2);
  const read = await getActiveRuleset();
  expect(read!.version).toBe(2);
  expect(read!.providers.map((p) => p.providerKey)).toEqual(["server_only_provider"]);
  // The seed was never written at all, not written-then-shadowed.
  expect(await rowCount()).toBe(1);
});
