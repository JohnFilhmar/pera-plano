# Wallet Trait Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the wallet type question from onboarding and everywhere else, replacing it with one inferred trait (`owedBalance`) and one derived trait (`manualOnly`).

**Architecture:** Expand, migrate, contract. Migration 013 adds the new columns while `type` stays; every reader is moved onto the new traits one task at a time; migration 014 rebuilds `wallets` without `type` only once nothing reads it. Inference is a pure scorer fed by ruleset priors, ruleset-supplied phrase signals, and balance movement, accumulated per wallet on device and gated by hysteresis. Where the scorer cannot decide and the money is material, the existing review queue asks the user one question.

**Tech Stack:** Expo / React Native, TypeScript strict, expo-sqlite, TanStack Query, Jest, NativeWind.

**Spec:** `docs/superpowers/specs/2026-08-27-wallet-trait-inference-design.md`

## Global Constraints

- Files and DB columns are `snake_case`; React components and their files are `PascalCase`; types and classes are `PascalCase`; constants are `UPPER_SNAKE_CASE`.
- No AI attribution in any commit message, branch name, or PR body.
- Money is `Centavos` (integer). Evidence scores are integers — weights scaled by 100 — so no float reaches SQLite.
- Components never import a repository. Screens (route files) may; components go through hooks in `hooks/queries` and `hooks/mutations`.
- Never edit migrations 001–012. Add a new numbered migration.
- **Jest cache gotcha:** `babel-plugin-inline-import` inlines `*.sql` at build time and the transform cache keys on the importing `.ts` file, not the `.sql`. After editing any migration SQL, run `npx jest --clearCache` once before testing.
- Test command: `npx jest <path>` from `mobile/`. Typecheck: `npm run typecheck` from `mobile/`.
- Every task ends with the full suite green and the tree typechecking. No task may leave `main` broken.
- Materiality threshold for asking the user: balance ≥ ₱1,000 (`100_000` centavos) or ≥ 5% of the Wallets-tab total, whichever is lower.

---

## File Structure

**Created:**
- `mobile/lib/wallets/classification.ts` — pure scorer. Evidence in, verdict out. No DB, no clock, no native call.
- `mobile/lib/wallets/__tests__/classification.test.ts`
- `mobile/lib/db/repos/wallet_traits_repo.ts` — reads/writes `wallet_trait_evidence`, applies verdicts to `wallets`.
- `mobile/lib/db/repos/__tests__/wallet_traits_repo.test.ts`
- `mobile/lib/db/migrations/013_wallet_traits.sql` — additive.
- `mobile/lib/db/migrations/014_drop_wallet_type.sql` — the rebuild.
- `mobile/lib/db/__tests__/migrations_runner.test.ts`
- `mobile/components/review/wallet_kind_body.tsx` — the review card body for the one question.
- `mobile/components/wallets/wallet_icon.tsx` — replaces `wallet_type_icon.tsx`.

**Modified (in task order):** `lib/db/migrations.ts`, `types/domain.ts`, `lib/db/mappers.ts`, `lib/db/repos/wallets_repo.ts`, `lib/ingest/ruleset_types.ts`, `lib/ingest/seed_rules.ts`, `assets/parser_rules/seed.json`, `lib/ingest/pipeline.ts`, `lib/review/resolve_actions.ts`, `components/review/review_card.tsx`, `lib/wallets/summary.ts`, `app/(tabs)/wallets.tsx`, `app/wallet/[id].tsx`, `app/wallet/[id]/edit.tsx`, `components/wallets/wallet_card.tsx`, `components/wallets/wallet_form.tsx`, `components/wallets/balance_correction_sheet.tsx`, `components/wallets/cash_reconcile_sheet.tsx`, `components/wallets/archive_wallet_sheet.tsx`, `components/transactions/manual_entry_form.tsx`, `components/loans/record_payment_sheet.tsx`, `lib/transactions/manual_entry.ts`, `lib/db/repos/goals_repo.ts`, `app/(tabs)/plan/goals/new.tsx`, `app/(onboarding)/wallets.tsx`, `components/onboarding/quick_wallet_list.tsx`.

---

### Task 1: Migration runner learns to drop foreign keys

The rebuild in Task 9 cannot run today. `lib/db/database.ts:331` opens the connection with `PRAGMA foreign_keys = ON`, the runner wraps every migration in `withTransactionAsync` (`lib/db/migrations.ts:90`), and SQLite ignores a `foreign_keys` pragma issued inside a transaction. Four tables reference `wallets(id)`, so `DROP TABLE wallets` would fail on any device holding real data.

The fix toggles the pragma *outside* the transaction — the only part that has to be — and keeps the migration itself inside it, so failure still rolls back.

**Files:**
- Modify: `mobile/lib/db/migrations.ts:15` (the `Migration` type) and `:86-99` (the apply loop)
- Test: `mobile/lib/db/__tests__/migrations_runner.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `Migration.disablesForeignKeys?: true`, and `MigrationIntegrityError` exported from `lib/db/migrations.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/lib/db/__tests__/migrations_runner.test.ts
import { closeDatabase, getDatabase } from "@/lib/db/database";
import { MigrationIntegrityError, runMigrations, MIGRATIONS } from "@/lib/db/migrations";
import { freshDb } from "@/test_support/db";

import type { Migration } from "@/lib/db/migrations";

const NEXT_VERSION = Math.max(...MIGRATIONS.map((m) => m.version)) + 100;

afterEach(async () => {
  await closeDatabase();
});

test("a migration that orphans a reference is rolled back, not committed", async () => {
  await freshDb();
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at)
     VALUES ('w1', 'BPI', 'bank', 0, 'PHP', 0, 1, 1)`,
  );
  await db.runAsync(
    `INSERT INTO wallet_matchers (id, wallet_id, package_name, hint, created_at, updated_at)
     VALUES ('m1', 'w1', 'com.bpi.ng.app', NULL, 1, 1)`,
  );

  // Drops the parent row while a child still points at it.
  const orphaning: Migration = {
    version: NEXT_VERSION,
    name: "orphaning",
    sql: "DELETE FROM wallets;",
    disablesForeignKeys: true,
  };

  await expect(runMigrations(db, [orphaning])).rejects.toThrow(MigrationIntegrityError);

  const wallets = await db.getAllAsync("SELECT id FROM wallets");
  expect(wallets).toHaveLength(1); // rolled back

  const recorded = await db.getAllAsync<{ version: number }>(
    "SELECT version FROM schema_migrations WHERE version = ?",
    [NEXT_VERSION],
  );
  expect(recorded).toHaveLength(0); // not marked applied
});

test("foreign keys are back on after a rebuild migration", async () => {
  await freshDb();
  const db = await getDatabase();
  const harmless: Migration = {
    version: NEXT_VERSION + 1,
    name: "harmless",
    sql: "CREATE TABLE scratch (id TEXT PRIMARY KEY NOT NULL);",
    disablesForeignKeys: true,
  };
  await runMigrations(db, [harmless]);

  const [{ foreign_keys: enabled }] = await db.getAllAsync<{ foreign_keys: number }>(
    "PRAGMA foreign_keys",
  );
  expect(enabled).toBe(1);
});

test("an ordinary migration still runs inside a transaction", async () => {
  await freshDb();
  const db = await getDatabase();
  const failing: Migration = {
    version: NEXT_VERSION + 2,
    name: "failing",
    sql: "CREATE TABLE ok (id TEXT PRIMARY KEY NOT NULL); SELECT nonexistent_fn();",
  };
  await expect(runMigrations(db, [failing])).rejects.toThrow();

  const tables = await db.getAllAsync(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'",
  );
  expect(tables).toHaveLength(0);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx jest lib/db/__tests__/migrations_runner.test.ts`
Expected: FAIL — `MigrationIntegrityError` is not exported, and `disablesForeignKeys` is not a property of `Migration`.

- [ ] **Step 3: Implement the runner change**

```ts
// mobile/lib/db/migrations.ts — replace the `Migration` type and the apply loop.

export type Migration = {
  version: number;
  name: string;
  sql: string;
  /**
   * Runs with `PRAGMA foreign_keys = OFF`, for a migration that rebuilds a
   * table OTHER TABLES REFERENCE.
   *
   * SQLite ignores a `foreign_keys` pragma issued inside a transaction, and
   * this runner puts every migration in one — so a rebuild of `wallets`
   * (referenced by wallet_matchers, transactions, goals and loans) cannot drop
   * the old table without tripping the constraint. The pragma is therefore
   * toggled around the transaction, which is the only part that has to sit
   * outside it; the migration itself still runs inside, and still rolls back.
   *
   * The runner runs `PRAGMA foreign_key_check` BEFORE COMMIT for these
   * migrations. A rebuild that silently orphans a transaction's `wallet_id`
   * is worse than one that refuses to finish.
   */
  disablesForeignKeys?: true;
};

export class MigrationIntegrityError extends Error {
  constructor(
    readonly version: number,
    readonly violationCount: number,
  ) {
    super(
      `Migration ${version} left ${violationCount} orphaned foreign-key row(s); rolled back.`,
    );
    this.name = "MigrationIntegrityError";
  }
}

async function applyMigration(db: SQLiteDatabase, migration: Migration): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(migration.sql);
    if (migration.disablesForeignKeys) {
      const violations = await db.getAllAsync<{ table: string }>("PRAGMA foreign_key_check");
      if (violations.length > 0) {
        throw new MigrationIntegrityError(migration.version, violations.length);
      }
    }
    await db.runAsync(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      [migration.version, migration.name, Date.now()],
    );
  });
}

// ...inside runMigrations, replacing the existing `for` body:
  for (const migration of pending) {
    if (migration.disablesForeignKeys) {
      await db.execAsync("PRAGMA foreign_keys = OFF;");
      try {
        await applyMigration(db, migration);
      } finally {
        await db.execAsync("PRAGMA foreign_keys = ON;");
      }
    } else {
      await applyMigration(db, migration);
    }
    applied.push(migration.version);
  }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx jest lib/db/__tests__/migrations_runner.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the existing DB suite for regressions**

Run: `npx jest lib/db`
Expected: PASS. Migrations 001–012 take the unchanged path.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations.ts lib/db/__tests__/migrations_runner.test.ts
git commit -m "feat(db): let a migration rebuild a referenced table"
```

---

### Task 2: The classifier

A pure module. No database, no clock, no native call — the same posture as `lib/ingest/provider_catalogue.ts`, so its rules are tested directly rather than through a screen.

**Files:**
- Create: `mobile/lib/wallets/classification.ts`
- Test: `mobile/lib/wallets/__tests__/classification.test.ts`

**Interfaces:**
- Consumes: `Centavos` from `@/types/domain`.
- Produces: `TraitEvidence`, `EvidenceDelta`, `OwedPrior`, `OwedVerdict`, `TraitSignal`, `WalletTraitTunables`, `EMPTY_EVIDENCE`, `classifyOwed`, `scoreText`, `scoreBalanceMovement`, `addEvidence`.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/lib/wallets/__tests__/classification.test.ts
import {
  addEvidence,
  classifyOwed,
  EMPTY_EVIDENCE,
  scoreBalanceMovement,
  scoreText,
} from "../classification";

import type { TraitSignal, WalletTraitTunables } from "../classification";

const TUNABLES: WalletTraitTunables = {
  owedMarginThreshold: 300,
  owedSampleFloor: 3,
  priorWeight: 100,
};

const SIGNALS: TraitSignal[] = [
  { pattern: "minimum amount due", trait: "owed", weight: 250 },
  { pattern: "statement balance", trait: "owed", weight: 200 },
  { pattern: "available balance", trait: "held", weight: 150 },
];

describe("classifyOwed", () => {
  test("no evidence and no prior reads as held, and says so without confidence", () => {
    expect(classifyOwed(EMPTY_EVIDENCE, "unknown", TUNABLES)).toEqual({
      owed: false,
      confident: false,
    });
  });

  test("owed evidence past the margin AND the sample floor flips the verdict", () => {
    const evidence = { owedScore: 600, heldScore: 100, sampleCount: 4 };
    expect(classifyOwed(evidence, "unknown", TUNABLES)).toEqual({ owed: true, confident: true });
  });

  test("a big margin from too few samples does NOT flip", () => {
    const evidence = { owedScore: 900, heldScore: 0, sampleCount: 2 };
    expect(classifyOwed(evidence, "unknown", TUNABLES)).toEqual({ owed: false, confident: false });
  });

  test("enough samples but a thin margin does NOT flip", () => {
    const evidence = { owedScore: 400, heldScore: 300, sampleCount: 9 };
    expect(classifyOwed(evidence, "unknown", TUNABLES)).toEqual({ owed: false, confident: false });
  });

  test("a 'likely' prior counts toward owed but cannot decide alone", () => {
    expect(classifyOwed(EMPTY_EVIDENCE, "likely", TUNABLES)).toEqual({
      owed: false,
      confident: false,
    });
    const nearMiss = { owedScore: 250, heldScore: 0, sampleCount: 3 };
    expect(classifyOwed(nearMiss, "likely", TUNABLES)).toEqual({ owed: true, confident: true });
    expect(classifyOwed(nearMiss, "unknown", TUNABLES)).toEqual({ owed: false, confident: false });
  });

  test("held evidence keeps a 'likely' prior from flipping the wallet", () => {
    const evidence = { owedScore: 100, heldScore: 500, sampleCount: 5 };
    expect(classifyOwed(evidence, "likely", TUNABLES)).toEqual({ owed: false, confident: true });
  });
});

describe("scoreText", () => {
  test("matches case-insensitively and sums every hit", () => {
    expect(scoreText("Your MINIMUM AMOUNT DUE is PHP 1,200", SIGNALS)).toEqual({
      owed: 250,
      held: 0,
    });
  });

  test("scores both sides when both appear", () => {
    expect(scoreText("Statement balance PHP 900. Available balance PHP 10.", SIGNALS)).toEqual({
      owed: 200,
      held: 150,
    });
  });

  test("text with no signal scores nothing", () => {
    expect(scoreText("Padala received", SIGNALS)).toEqual({ owed: 0, held: 0 });
  });
});

describe("scoreBalanceMovement", () => {
  test("spending that RAISES the reported balance is credit-shaped", () => {
    expect(
      scoreBalanceMovement({
        direction: "out",
        amount: 50_000,
        previousBalance: 200_000,
        balanceAfter: 250_000,
      }),
    ).toEqual({ owed: 200, held: 0 });
  });

  test("spending that lowers the balance is ordinary", () => {
    expect(
      scoreBalanceMovement({
        direction: "out",
        amount: 50_000,
        previousBalance: 200_000,
        balanceAfter: 150_000,
      }),
    ).toEqual({ owed: 0, held: 200 });
  });

  test("a capture with no reported balance scores nothing either way", () => {
    expect(
      scoreBalanceMovement({
        direction: "out",
        amount: 50_000,
        previousBalance: 200_000,
        balanceAfter: null,
      }),
    ).toEqual({ owed: 0, held: 0 });
  });
});

describe("addEvidence", () => {
  test("accumulates scores and counts one sample per scoring delta", () => {
    const once = addEvidence(EMPTY_EVIDENCE, { owed: 250, held: 0 });
    expect(once).toEqual({ owedScore: 250, heldScore: 0, sampleCount: 1 });
    expect(addEvidence(once, { owed: 0, held: 150 })).toEqual({
      owedScore: 250,
      heldScore: 150,
      sampleCount: 2,
    });
  });

  test("a delta that scored nothing is not a sample", () => {
    expect(addEvidence(EMPTY_EVIDENCE, { owed: 0, held: 0 })).toEqual(EMPTY_EVIDENCE);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx jest lib/wallets/__tests__/classification.test.ts`
Expected: FAIL — `Cannot find module '../classification'`.

- [ ] **Step 3: Implement the module**

```ts
// mobile/lib/wallets/classification.ts — decides whether a wallet's balance is
// money the user HAS or money they OWE, from evidence the app can observe.
//
// PURE, AND THAT IS THE WHOLE DESIGN. This decides the sign of the first number
// the app states: an owed wallet is excluded from the Wallets-tab total and
// from Safe-to-Spend, so a wrong verdict inflates a budgeting app's headline by
// the size of the user's debt. A rule that important is a function with its own
// suite, not a condition buried in an ingest branch.
//
// INTEGERS, NOT FLOATS. Every weight is scaled by 100 so scores can be summed
// into SQLite columns without a float ever reaching the database.
import type { Centavos } from "@/types/domain";

/** What one capture contributed, before it is folded into the running total. */
export type EvidenceDelta = { owed: number; held: number };

/** A wallet's accumulated evidence, as stored in `wallet_trait_evidence`. */
export type TraitEvidence = {
  owedScore: number;
  heldScore: number;
  /** Deltas that actually scored. A capture that matched nothing is not a sample. */
  sampleCount: number;
};

export const EMPTY_EVIDENCE: TraitEvidence = { owedScore: 0, heldScore: 0, sampleCount: 0 };

/** What the ruleset believes about this wallet's provider before we watch it. */
export type OwedPrior = "likely" | "unlikely" | "unknown";

export type OwedVerdict = {
  owed: boolean;
  /**
   * Whether the evidence actually settled the question. `false` with
   * `owed: false` is the assumed-held default, NOT a finding — it is what
   * raises the review-queue question when the balance is material.
   */
  confident: boolean;
};

/** One ruleset-supplied phrase rule. `pattern` is matched case-insensitively as a literal. */
export type TraitSignal = {
  pattern: string;
  trait: "owed" | "held";
  weight: number;
};

export type WalletTraitTunables = {
  /** How far ahead one side must be before the verdict moves. */
  owedMarginThreshold: number;
  /** How many scoring captures must have been seen before any verdict is trusted. */
  owedSampleFloor: number;
  /** What a ruleset prior is worth, in the same units as a signal weight. */
  priorWeight: number;
};

/** Weight of one balance-movement observation. */
const MOVEMENT_WEIGHT = 200;

function priorScore(prior: OwedPrior, tunables: WalletTraitTunables): EvidenceDelta {
  if (prior === "likely") return { owed: tunables.priorWeight, held: 0 };
  if (prior === "unlikely") return { owed: 0, held: tunables.priorWeight };
  return { owed: 0, held: 0 };
}

/**
 * The verdict. TWO GATES, BOTH REQUIRED, AND THE SAMPLE FLOOR IS THE IMPORTANT
 * ONE: a single odd notification ("your statement balance is ready") must not
 * be able to move the headline number, however lopsided its score.
 */
export function classifyOwed(
  evidence: TraitEvidence,
  prior: OwedPrior,
  tunables: WalletTraitTunables,
): OwedVerdict {
  const bias = priorScore(prior, tunables);
  const owed = evidence.owedScore + bias.owed;
  const held = evidence.heldScore + bias.held;
  const margin = Math.abs(owed - held);

  const settled = evidence.sampleCount >= tunables.owedSampleFloor && margin >= tunables.owedMarginThreshold;
  if (!settled) return { owed: false, confident: false };

  return { owed: owed > held, confident: true };
}

/** Phrase evidence from text the pipeline has already parsed. No new capture. */
export function scoreText(text: string, signals: readonly TraitSignal[]): EvidenceDelta {
  const haystack = text.toLowerCase();
  return signals.reduce<EvidenceDelta>(
    (delta, signal) => {
      if (!haystack.includes(signal.pattern.toLowerCase())) return delta;
      return signal.trait === "owed"
        ? { owed: delta.owed + signal.weight, held: delta.held }
        : { owed: delta.owed, held: delta.held + signal.weight };
    },
    { owed: 0, held: 0 },
  );
}

export type BalanceMovement = {
  direction: "in" | "out";
  amount: Centavos;
  previousBalance: Centavos | null;
  balanceAfter: Centavos | null;
};

/**
 * The strongest signal available, and it costs nothing to collect: migration
 * 002 already stores `balance_after`.
 *
 * On an ordinary account, spending LOWERS the balance. On a credit account the
 * stored balance is what is owed, so spending RAISES it. A capture that
 * reported no balance says nothing and scores nothing — silence is not
 * evidence for either side.
 */
export function scoreBalanceMovement(movement: BalanceMovement): EvidenceDelta {
  const { direction, previousBalance, balanceAfter } = movement;
  if (previousBalance === null || balanceAfter === null) return { owed: 0, held: 0 };
  if (balanceAfter === previousBalance) return { owed: 0, held: 0 };

  const rose = balanceAfter > previousBalance;
  const creditShaped = direction === "out" ? rose : !rose;
  return creditShaped ? { owed: MOVEMENT_WEIGHT, held: 0 } : { owed: 0, held: MOVEMENT_WEIGHT };
}

/** Folds one delta into the running total. A delta that scored nothing is not a sample. */
export function addEvidence(current: TraitEvidence, delta: EvidenceDelta): TraitEvidence {
  if (delta.owed === 0 && delta.held === 0) return current;
  return {
    owedScore: current.owedScore + delta.owed,
    heldScore: current.heldScore + delta.held,
    sampleCount: current.sampleCount + 1,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx jest lib/wallets/__tests__/classification.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/wallets/classification.ts lib/wallets/__tests__/classification.test.ts
git commit -m "feat(wallets): score whether a balance is held or owed"
```

---

### Task 3: Ruleset carries the priors, the signals and the thresholds

Priors and phrase rules must be fixable without an app release — the same promise `docs/03 §11.1` already makes for package names. They ride the existing ruleset.

**Files:**
- Modify: `mobile/lib/ingest/ruleset_types.ts` (the `ProviderRuleset` and `PipelineTunables` types, and `RulesetBundle`)
- Modify: `mobile/lib/ingest/seed_rules.ts` (`DEFAULT_TUNABLES`)
- Modify: `mobile/assets/parser_rules/seed.json`
- Test: `mobile/lib/ingest/__tests__/seed_rules.test.ts` (existing file — add cases)

**Interfaces:**
- Consumes: `TraitSignal`, `OwedPrior` from Task 2.
- Produces: `ProviderRuleset.traits?: { owedBalance?: OwedPrior }`, `RulesetBundle.traitSignals: TraitSignal[]`, and `PipelineTunables.walletTraits: WalletTraitTunables`.

- [ ] **Step 1: Write the failing test**

```ts
// append to mobile/lib/ingest/__tests__/seed_rules.test.ts
import { DEFAULT_TUNABLES, SEED_BUNDLE } from "../seed_rules";

test("the seed ships wallet-trait thresholds", () => {
  expect(DEFAULT_TUNABLES.walletTraits).toEqual({
    owedMarginThreshold: 300,
    owedSampleFloor: 3,
    priorWeight: 100,
  });
});

test("the seed ships phrase signals for both sides", () => {
  const owed = SEED_BUNDLE.traitSignals.filter((s) => s.trait === "owed");
  const held = SEED_BUNDLE.traitSignals.filter((s) => s.trait === "held");
  expect(owed.length).toBeGreaterThan(0);
  expect(held.length).toBeGreaterThan(0);
  expect(SEED_BUNDLE.traitSignals.every((s) => Number.isInteger(s.weight))).toBe(true);
});

test("no seeded provider is presumed to be a credit account", () => {
  // None of the thirteen is a credit-card app; cards reach us through bank
  // apps, so the first owed verdicts must come from text and behaviour.
  const presumed = SEED_BUNDLE.providers.filter((p) => p.traits?.owedBalance === "likely");
  expect(presumed).toEqual([]);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx jest lib/ingest/__tests__/seed_rules.test.ts`
Expected: FAIL — `walletTraits` and `traitSignals` do not exist.

- [ ] **Step 3: Extend the types**

```ts
// mobile/lib/ingest/ruleset_types.ts
import type { OwedPrior, TraitSignal, WalletTraitTunables } from "@/lib/wallets/classification";

// ...on ProviderRuleset, after `senderIds`:
  /**
   * What this provider's wallets probably are, before the app has watched one.
   * OPTIONAL AND ABSENT BY DEFAULT — an unstated prior is `"unknown"`, which
   * contributes nothing. Ruleset data rather than an app constant so a
   * misjudged provider is corrected without a release.
   */
  traits?: { owedBalance?: OwedPrior };

// ...on PipelineTunables, after `balanceDriftToleranceCentavos`:
  /**
   * Thresholds for the held/owed verdict (lib/wallets/classification.ts).
   * Here for the same reason `autoCommitThreshold` is: these are the numbers
   * most likely to need recalibration once real corpora exist, and they decide
   * whether a balance counts as money the user has.
   */
  walletTraits: WalletTraitTunables;

// ...on RulesetBundle, after `providers`:
  /** Phrase rules for the held/owed verdict. Empty is valid: no text evidence. */
  traitSignals: TraitSignal[];
```

- [ ] **Step 4: Ship the seed values**

In `mobile/lib/ingest/seed_rules.ts`, add to `DEFAULT_TUNABLES`:

```ts
  walletTraits: {
    // A margin of three signal-weights, so one phrase cannot decide.
    owedMarginThreshold: 300,
    // Three scoring captures before any verdict is trusted.
    owedSampleFloor: 3,
    // A prior is worth less than a single observed phrase, on purpose: what
    // the device has SEEN outranks what the ruleset GUESSED, the same
    // "seen beats guessed" ordering provider_catalogue.ts already applies.
    priorWeight: 100,
  },
```

And the signal pack on the bundle:

```ts
  traitSignals: [
    { pattern: "minimum amount due", trait: "owed", weight: 250 },
    { pattern: "statement balance", trait: "owed", weight: 200 },
    { pattern: "credit limit", trait: "owed", weight: 200 },
    { pattern: "outstanding balance", trait: "owed", weight: 150 },
    { pattern: "payment due", trait: "owed", weight: 150 },
    { pattern: "available balance", trait: "held", weight: 150 },
    { pattern: "interest earned", trait: "held", weight: 200 },
    { pattern: "maintaining balance", trait: "held", weight: 150 },
  ],
```

Mirror the same two additions into `mobile/assets/parser_rules/seed.json` so the shipped JSON and the compiled default agree. Add no `traits` key to any provider — absent means unknown, which is the correct starting position for all thirteen.

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx jest lib/ingest`
Expected: PASS. If `seed.json` is inlined by `babel-plugin-inline-import`, run `npx jest --clearCache` first.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add lib/ingest/ruleset_types.ts lib/ingest/seed_rules.ts assets/parser_rules/seed.json lib/ingest/__tests__/seed_rules.test.ts
git commit -m "feat(ingest): ship wallet-trait priors and signals in the ruleset"
```

---

### Task 4: Migration 013 and the expanded wallet

Additive only. `type` stays exactly where it is and keeps working; the new columns sit beside it. Nothing reads them yet.

**Files:**
- Create: `mobile/lib/db/migrations/013_wallet_traits.sql`
- Modify: `mobile/lib/db/migrations.ts` (register 013)
- Modify: `mobile/types/domain.ts` (`Wallet`, `ReviewKind`)
- Modify: `mobile/lib/db/mappers.ts` (`WalletRow`, `rowToWallet`, `walletToRow`)
- Modify: `mobile/lib/db/repos/wallets_repo.ts` (`createWallet:70`, `listWallets:102`, `getWallet:87`)
- Test: `mobile/lib/db/repos/__tests__/wallets_repo.test.ts` (existing — add cases)

**Interfaces:**
- Consumes: Task 1's runner (not used here — 013 is transactional).
- Produces: `Wallet.owedBalance: boolean`, `Wallet.owedPinned: boolean`, `Wallet.matcherCount: number`, and the `"wallet-kind-unclear"` review kind.

- [ ] **Step 1: Write the failing test**

```ts
// append to mobile/lib/db/repos/__tests__/wallets_repo.test.ts
test("a new wallet is assumed to hold money, unpinned", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  expect(wallet.owedBalance).toBe(false);
  expect(wallet.owedPinned).toBe(false);
});

test("an existing credit wallet is migrated as user-answered", async () => {
  const wallet = await createWallet({ name: "Card", type: "credit" });
  const reloaded = await getWallet(wallet.id);
  expect(reloaded?.owedBalance).toBe(true);
  expect(reloaded?.owedPinned).toBe(true);
});

test("matcherCount reports how many routes reach the wallet", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  expect((await getWallet(wallet.id))?.matcherCount).toBe(0);

  await setWalletMatchers(wallet.id, [{ packageName: "com.globe.gcash.android", hint: null }]);
  expect((await getWallet(wallet.id))?.matcherCount).toBe(1);

  const listed = await listWallets();
  expect(listed.find((w) => w.id === wallet.id)?.matcherCount).toBe(1);
});
```

Note: `createWallet` for `type: "credit"` must set the columns at insert time so the test reflects the same rule the migration backfills. Both paths are asserted.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx jest lib/db/repos/__tests__/wallets_repo.test.ts`
Expected: FAIL — `owedBalance` is not a property of `Wallet`.

- [ ] **Step 3: Write migration 013**

```sql
-- mobile/lib/db/migrations/013_wallet_traits.sql — the app stops asking what
-- kind of wallet this is and starts working it out.
--
-- ADDITIVE ON PURPOSE. `type` stays in this migration and keeps its CHECK
-- constraint; 014 removes it, once every reader has moved to the columns below.
-- Splitting it that way is what lets the tree compile and the suite pass at
-- every step in between.
--
-- `owed_balance` IS THE SIGN OF THE HEADLINE NUMBER. A wallet with this set is
-- excluded from the Wallets-tab total and from Safe-to-Spend, because its
-- balance is money owed rather than money held.
--
-- `owed_pinned` MEANS THE USER SETTLED IT — by answering the review-queue
-- question or correcting it in wallet edit. Inference reads a pinned wallet and
-- never writes it again.
ALTER TABLE wallets ADD COLUMN owed_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN owed_pinned INTEGER NOT NULL DEFAULT 0;

-- An explicit `credit` choice is the user's OWN ANSWER to this exact question,
-- so it migrates as pinned. Every other type migrates as unanswered: assumed
-- held, still learnable.
UPDATE wallets SET owed_balance = 1, owed_pinned = 1 WHERE type = 'credit';

CREATE TABLE wallet_trait_evidence (
  wallet_id    TEXT PRIMARY KEY NOT NULL REFERENCES wallets(id),
  owed_score   INTEGER NOT NULL DEFAULT 0,
  held_score   INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- The Review Queue learns to ask the one question inference cannot settle.
-- Same twelve-step dance as 011 and 012, and the same two things that must
-- survive it: idx_review_queue_open, and the raw_notifications foreign key.
CREATE TABLE review_queue_items_new (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('low-confidence', 'unknown-provider', 'ambiguous-transfer', 'possible-duplicate', 'loan-match', 'one-sided-transfer', 'wallet-kind-unclear')),
  payload_json TEXT NOT NULL,
  raw_notification_id TEXT REFERENCES raw_notifications(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  resolved_at INTEGER
);

INSERT INTO review_queue_items_new (
  id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at
)
SELECT id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at
  FROM review_queue_items;

DROP TABLE review_queue_items;

ALTER TABLE review_queue_items_new RENAME TO review_queue_items;

CREATE INDEX idx_review_queue_open ON review_queue_items(resolved_at);
```

Register it in `lib/db/migrations.ts`:

```ts
import walletTraitsSql from "./migrations/013_wallet_traits.sql";
// ...
  { version: 13, name: "wallet_traits", sql: walletTraitsSql },
```

- [ ] **Step 4: Extend the domain type and the mapper**

```ts
// mobile/types/domain.ts — on Wallet, after `isArchived`:
  /**
   * The balance is money OWED, not money held: excluded from the Wallets-tab
   * total and from Safe-to-Spend, and labelled "Owed" on its row. Inferred
   * (lib/wallets/classification.ts) unless `owedPinned`.
   */
  owedBalance: boolean;
  /** The user answered this question themselves. Inference never overwrites it. */
  owedPinned: boolean;
  /**
   * How many `wallet_matchers` rows route to this wallet. Zero means the wallet
   * cannot be tracked automatically — what `type: "cash"` used to mean — which
   * is why it is derived from a count rather than stored as a flag.
   */
  matcherCount: number;

// on ReviewKind, after "one-sided-transfer":
  /**
   * Evidence cannot settle whether this wallet's balance is money held or money
   * owed, and the balance is large enough that guessing wrong would visibly
   * misstate the user's total. Payload: `{ walletId, walletName, balance }`.
   */
  | "wallet-kind-unclear";
```

```ts
// mobile/lib/db/mappers.ts — WalletRow gains, after drift_dismissed_transaction_id:
  /** 013_wallet_traits — appended by ALTER TABLE, hence after 003's column. */
  owed_balance: number;
  owed_pinned: number;
  /** Not a column: a LEFT JOIN count the wallets repo selects alongside the row. */
  matcher_count?: number;

// rowToWallet gains:
    owedBalance: row.owed_balance === 1,
    owedPinned: row.owed_pinned === 1,
    matcherCount: row.matcher_count ?? 0,

// walletToRow gains:
    owed_balance: wallet.owedBalance ? 1 : 0,
    owed_pinned: wallet.owedPinned ? 1 : 0,
    matcher_count: wallet.matcherCount,
```

- [ ] **Step 5: Teach the repo to read and write them**

In `createWallet` (`wallets_repo.ts:44`), derive the two flags from the incoming type for now — Task 8 removes `type` from `NewWallet` and this becomes a plain `false, false`:

```ts
  // `type: "credit"` is the user answering the held/owed question in the only
  // vocabulary the app currently offers. Task 8 removes the vocabulary; until
  // then, honour the answer.
  const owedBalance = input.type === "credit";
  const wallet: Wallet = {
    // ...existing fields...
    owedBalance,
    owedPinned: owedBalance,
    matcherCount: 0,
  };

  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, owed_balance, owed_pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [ /* ...existing..., */ owedBalance ? 1 : 0, owedBalance ? 1 : 0, now, now ],
  );
```

`getWallet` and `listWallets` select the count rather than a second query per row:

```sql
SELECT w.*, (SELECT COUNT(*) FROM wallet_matchers m WHERE m.wallet_id = w.id) AS matcher_count
  FROM wallets w
```

- [ ] **Step 6: Clear the Jest cache, run, and commit**

```bash
npx jest --clearCache
npx jest lib/db
npm run typecheck
git add lib/db types/domain.ts
git commit -m "feat(wallets): store whether a balance is owed, and how many routes reach it"
```

Expected: PASS. Existing suites still construct wallets with `type:` and still work — nothing has been taken away yet.

---

### Task 5: Evidence accumulates from real captures

**Files:**
- Create: `mobile/lib/db/repos/wallet_traits_repo.ts`
- Create: `mobile/lib/db/repos/__tests__/wallet_traits_repo.test.ts`
- Modify: `mobile/lib/ingest/pipeline.ts:489-536` (after `insertTransaction`, before `emitAppEvent("ledger:committed", …)`)

**Interfaces:**
- Consumes: `classifyOwed`, `scoreText`, `scoreBalanceMovement`, `addEvidence`, `EMPTY_EVIDENCE`, `TraitEvidence` (Task 2); `Wallet.owedPinned` (Task 4).
- Produces:
  - `getTraitEvidence(walletId: string): Promise<TraitEvidence>`
  - `recordTraitEvidence(walletId: string, delta: EvidenceDelta): Promise<TraitEvidence>`
  - `applyOwedVerdict(walletId: string, verdict: OwedVerdict): Promise<boolean>` — returns whether the wallet changed
  - `setWalletOwed(walletId: string, owed: boolean, opts: { pinned: boolean }): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// mobile/lib/db/repos/__tests__/wallet_traits_repo.test.ts
import { closeDatabase } from "@/lib/db/database";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";
import { EMPTY_EVIDENCE } from "@/lib/wallets/classification";

import {
  applyOwedVerdict,
  getTraitEvidence,
  recordTraitEvidence,
  setWalletOwed,
} from "../wallet_traits_repo";

beforeEach(async () => {
  await freshDb();
});
afterEach(async () => {
  await closeDatabase();
});

test("a wallet with no history has empty evidence", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  expect(await getTraitEvidence(wallet.id)).toEqual(EMPTY_EVIDENCE);
});

test("evidence accumulates across captures", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  await recordTraitEvidence(wallet.id, { owed: 250, held: 0 });
  const after = await recordTraitEvidence(wallet.id, { owed: 0, held: 150 });
  expect(after).toEqual({ owedScore: 250, heldScore: 150, sampleCount: 2 });
  expect(await getTraitEvidence(wallet.id)).toEqual(after);
});

test("a confident verdict flips the wallet without pinning it", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  const changed = await applyOwedVerdict(wallet.id, { owed: true, confident: true });
  expect(changed).toBe(true);
  const reloaded = await getWallet(wallet.id);
  expect(reloaded?.owedBalance).toBe(true);
  expect(reloaded?.owedPinned).toBe(false);
});

test("a verdict never overwrites a pinned wallet", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  await setWalletOwed(wallet.id, false, { pinned: true });
  const changed = await applyOwedVerdict(wallet.id, { owed: true, confident: true });
  expect(changed).toBe(false);
  expect((await getWallet(wallet.id))?.owedBalance).toBe(false);
});

test("an unconfident verdict changes nothing", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  const changed = await applyOwedVerdict(wallet.id, { owed: false, confident: false });
  expect(changed).toBe(false);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx jest lib/db/repos/__tests__/wallet_traits_repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the repository**

```ts
// mobile/lib/db/repos/wallet_traits_repo.ts — the held/owed verdict's storage.
//
// THE VERDICT IS SEPARATE FROM THE EVIDENCE, deliberately. `wallets.owed_balance`
// is what every screen reads; `wallet_trait_evidence` is why. Keeping the
// running scores out of the wallets table means a rewrite of the scoring rules
// never touches the row the whole app joins against.
import { getDatabase } from "@/lib/db/database";
import { EMPTY_EVIDENCE } from "@/lib/wallets/classification";

import type { EvidenceDelta, OwedVerdict, TraitEvidence } from "@/lib/wallets/classification";

type EvidenceRow = { owed_score: number; held_score: number; sample_count: number };

export async function getTraitEvidence(walletId: string): Promise<TraitEvidence> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<EvidenceRow>(
    "SELECT owed_score, held_score, sample_count FROM wallet_trait_evidence WHERE wallet_id = ?",
    [walletId],
  );
  if (!row) return EMPTY_EVIDENCE;
  return { owedScore: row.owed_score, heldScore: row.held_score, sampleCount: row.sample_count };
}

/**
 * Folds one capture's delta in and returns the new total. A delta that scored
 * nothing is not written and not counted — silence is not evidence.
 */
export async function recordTraitEvidence(
  walletId: string,
  delta: EvidenceDelta,
): Promise<TraitEvidence> {
  if (delta.owed === 0 && delta.held === 0) return getTraitEvidence(walletId);

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO wallet_trait_evidence (wallet_id, owed_score, held_score, sample_count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(wallet_id) DO UPDATE SET
       owed_score   = owed_score + excluded.owed_score,
       held_score   = held_score + excluded.held_score,
       sample_count = sample_count + 1,
       updated_at   = excluded.updated_at`,
    [walletId, delta.owed, delta.held, Date.now()],
  );
  return getTraitEvidence(walletId);
}

/** Sets the verdict directly. `pinned: true` is the user answering. */
export async function setWalletOwed(
  walletId: string,
  owed: boolean,
  opts: { pinned: boolean },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE wallets SET owed_balance = ?, owed_pinned = ?, updated_at = ? WHERE id = ?",
    [owed ? 1 : 0, opts.pinned ? 1 : 0, Date.now(), walletId],
  );
}

/**
 * Applies an inferred verdict. Returns whether the wallet actually moved, so
 * the caller knows whether to invalidate the wallet queries.
 *
 * THREE REFUSALS, ALL SILENT: an unconfident verdict, a pinned wallet, and a
 * verdict that agrees with what is already stored.
 */
export async function applyOwedVerdict(
  walletId: string,
  verdict: OwedVerdict,
): Promise<boolean> {
  if (!verdict.confident) return false;

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ owed_balance: number; owed_pinned: number }>(
    "SELECT owed_balance, owed_pinned FROM wallets WHERE id = ?",
    [walletId],
  );
  if (!row || row.owed_pinned === 1) return false;
  if ((row.owed_balance === 1) === verdict.owed) return false;

  await setWalletOwed(walletId, verdict.owed, { pinned: false });
  return true;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx jest lib/db/repos/__tests__/wallet_traits_repo.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the pipeline**

In `lib/ingest/pipeline.ts`, immediately after the `insertTransaction` call at `:489` and before `emitAppEvent("ledger:committed", { transactionId: row.id })` at `:536`:

```ts
  // The verdict learns from what just committed. This runs AFTER the ledger
  // write and never blocks it: a scoring failure must not lose a transaction.
  try {
    const delta = addEvidence(EMPTY_EVIDENCE, scoreText(captureText, bundle.traitSignals));
    const movement = scoreBalanceMovement({
      direction: row.direction,
      amount: row.amount,
      previousBalance,
      balanceAfter: row.balanceAfter,
    });
    const evidence = await recordTraitEvidence(row.walletId, {
      owed: delta.owedScore + movement.owed,
      held: delta.heldScore + movement.held,
    });
    const prior = providerPriorFor(bundle, capture.packageName);
    const moved = await applyOwedVerdict(
      row.walletId,
      classifyOwed(evidence, prior, bundle.tunables.walletTraits),
    );
    if (moved) emitAppEvent("wallets:changed", { walletId: row.walletId });
  } catch (error) {
    // Evidence is best-effort. The ledger row is already durable.
    logIngest("trait-evidence-failed", { walletId: row.walletId, error });
  }
```

Add a small helper beside it:

```ts
function providerPriorFor(bundle: RulesetBundle, packageName: string): OwedPrior {
  const provider = bundle.providers.find((p) => p.packageNames.includes(packageName));
  return provider?.traits?.owedBalance ?? "unknown";
}
```

`previousBalance` is the wallet's balance read before `insertTransaction` snapped it — the same value the existing drift logic at `:504` already has in scope. Use that variable; do not re-read the wallet after the insert, which would return the post-snap balance and score every capture as ordinary.

- [ ] **Step 6: Run the ingest suite and commit**

```bash
npx jest lib/ingest lib/db
npm run typecheck
git add lib/db/repos/wallet_traits_repo.ts lib/db/repos/__tests__/wallet_traits_repo.test.ts lib/ingest/pipeline.ts
git commit -m "feat(ingest): learn whether a wallet holds or owes from what it commits"
```

---

### Task 6: The one question, in the queue that already exists

**Files:**
- Create: `mobile/components/review/wallet_kind_body.tsx`
- Modify: `mobile/components/review/review_card.tsx` (kind → body dispatch)
- Modify: `mobile/lib/review/resolve_actions.ts` (add `answerWalletKind`)
- Modify: `mobile/lib/ingest/pipeline.ts` (raise the item)
- Test: `mobile/lib/review/__tests__/resolve_actions.test.ts` and `mobile/components/review/__tests__/` (existing files — add cases)

**Interfaces:**
- Consumes: `setWalletOwed` (Task 5), `"wallet-kind-unclear"` kind (Task 4).
- Produces: `answerWalletKind(itemId: string, owed: boolean): Promise<void>`; payload shape `{ walletId: string; walletName: string; balance: Centavos }`.

- [ ] **Step 1: Write the failing test**

```ts
// append to mobile/lib/review/__tests__/resolve_actions.test.ts
test("answering the wallet-kind question pins the wallet and resolves the item", async () => {
  const wallet = await createWallet({ name: "BPI Card", type: "bank" });
  const item = await createReviewItem({
    kind: "wallet-kind-unclear",
    payload: { walletId: wallet.id, walletName: wallet.name, balance: wallet.balance },
  });

  await answerWalletKind(item.id, true);

  const reloaded = await getWallet(wallet.id);
  expect(reloaded?.owedBalance).toBe(true);
  expect(reloaded?.owedPinned).toBe(true);
  expect((await getReviewItem(item.id))?.resolvedAt).not.toBeNull();
});

test("answering 'money I have' pins held, it does not merely leave it alone", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  const item = await createReviewItem({
    kind: "wallet-kind-unclear",
    payload: { walletId: wallet.id, walletName: wallet.name, balance: wallet.balance },
  });

  await answerWalletKind(item.id, false);

  const reloaded = await getWallet(wallet.id);
  expect(reloaded?.owedBalance).toBe(false);
  expect(reloaded?.owedPinned).toBe(true); // the question is settled, not deferred
});

test("a malformed payload is rejected rather than silently ignored", async () => {
  const item = await createReviewItem({ kind: "wallet-kind-unclear", payload: {} });
  await expect(answerWalletKind(item.id, true)).rejects.toThrow(IncompleteReviewItemError);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx jest lib/review`
Expected: FAIL — `answerWalletKind` is not exported.

- [ ] **Step 3: Implement the resolve action**

```ts
// mobile/lib/review/resolve_actions.ts — alongside confirmOneSidedTransfer.

/**
 * The user answers the one question inference could not settle.
 *
 * EITHER ANSWER PINS. "Money I have" is not the same as declining to answer:
 * it is the user telling us the assumption was right, and a wallet whose owner
 * has said so must not be flipped later by a run of odd notifications.
 */
export async function answerWalletKind(itemId: string, owed: boolean): Promise<void> {
  const item = await getReviewItem(itemId);
  if (!item) throw new ReviewItemNotFoundError(itemId);

  const walletId = item.payload.walletId;
  if (typeof walletId !== "string" || walletId === "") {
    throw new IncompleteReviewItemError(itemId, "walletId");
  }

  await setWalletOwed(walletId, owed, { pinned: true });
  await resolveReviewItem(itemId, "confirmed");
  emitAppEvent("wallets:changed", { walletId });
}
```

- [ ] **Step 4: Raise the item from the pipeline**

Extend the Task 5 block: when the verdict comes back `confident: false` and the wallet's balance is material, enqueue one item — and only ever one per wallet.

```ts
const MATERIAL_FLOOR_CENTAVOS = 100_000; // ₱1,000
const MATERIAL_SHARE = 0.05;

/**
 * Whether getting this wallet wrong would visibly misstate the user's money.
 * The LOWER of the two bars applies, so a small wallet in a small portfolio
 * still asks: 5% of a ₱2,000 total is ₱100, and ₱100 wrong out of ₱2,000 is
 * the same lie as ₱5,000 wrong out of ₱100,000.
 */
function isMaterial(balance: Centavos, activeTotal: Centavos): boolean {
  const share = Math.round(activeTotal * MATERIAL_SHARE);
  const bar = share === 0 ? MATERIAL_FLOOR_CENTAVOS : Math.min(MATERIAL_FLOOR_CENTAVOS, share);
  return balance >= bar;
}
```

```ts
  if (!verdict.confident && evidence.sampleCount >= bundle.tunables.walletTraits.owedSampleFloor) {
    // We have looked and still cannot tell. Ask, but only if it matters, and
    // only once ever: `hasEverAsked` covers resolved items too, so dismissing
    // the question is itself an answer.
    const asked = await hasEverAskedWalletKind(row.walletId);
    if (!asked && isMaterial(wallet.balance, await totalActiveBalanceFromDb())) {
      await createReviewItem({
        kind: "wallet-kind-unclear",
        payload: { walletId: wallet.id, walletName: wallet.name, balance: wallet.balance },
      });
    }
  }
```

`hasEverAskedWalletKind` goes in `wallet_traits_repo.ts`:

```ts
/** Resolved items count. Dismissing the question is an answer — we do not re-ask. */
export async function hasEverAskedWalletKind(walletId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM review_queue_items
      WHERE kind = 'wallet-kind-unclear' AND payload_json LIKE ?`,
    [`%"walletId":"${walletId}"%`],
  );
  return (row?.n ?? 0) > 0;
}
```

- [ ] **Step 5: Build the card body**

```tsx
// mobile/components/review/wallet_kind_body.tsx — the body for
// `wallet-kind-unclear`, modelled on one_sided_transfer_body.tsx.
//
// TWO BUTTONS, NO PICKER, NO VOCABULARY. The user is never asked whether this
// is a savings account or an e-wallet — only the one thing the app cannot work
// out and genuinely needs: is this money you have, or money you owe.
export function WalletKindBody({ walletName, balance, onAnswer }: WalletKindBodyProps) {
  return (
    <View className="gap-3">
      <Text className="text-fg dark:text-fg-dark">
        {`Is the ${formatPeso(balance)} in ${walletName} money you have, or money you owe?`}
      </Text>
      <Text className="text-sm text-fg-2 dark:text-fg-2-dark">
        Money you owe is kept out of your total, so your safe-to-spend stays honest.
      </Text>
      <View className="flex-row gap-2">
        <Button testID="wallet-kind-held" onPress={() => onAnswer(false)}>Money I have</Button>
        <Button testID="wallet-kind-owed" variant="secondary" onPress={() => onAnswer(true)}>
          Money I owe
        </Button>
      </View>
    </View>
  );
}
```

Dispatch it in `components/review/review_card.tsx` beside the existing `one-sided-transfer` branch.

- [ ] **Step 6: Run, typecheck, commit**

```bash
npx jest lib/review components/review lib/ingest
npm run typecheck
git add lib/review components/review lib/ingest/pipeline.ts lib/db/repos/wallet_traits_repo.ts
git commit -m "feat(review): ask once whether a wallet's balance is held or owed"
```

---

### Task 7: Every behaviour moves off `type`

The traits are populated and correct. Now the readers switch. `type` is still in the schema and still written — nothing breaks if a reader is missed, which is exactly why this task comes before the drop.

**Files:**
- Modify: `mobile/lib/wallets/summary.ts` (`WALLET_TYPE_ORDER:20`, `WALLET_TYPE_LABELS:33`, `groupWalletsByType:52`, `totalActiveBalance:82`, `totalActiveWalletCount:102`)
- Create: `mobile/components/wallets/wallet_icon.tsx`; delete `wallet_type_icon.tsx`
- Modify: `app/(tabs)/wallets.tsx:162`, `app/wallet/[id].tsx:255,265,334,380`, `components/wallets/wallet_card.tsx:73,205`, `components/wallets/archive_wallet_sheet.tsx:137`, `components/wallets/balance_correction_sheet.tsx:94`, `components/wallets/cash_reconcile_sheet.tsx:69`, `components/transactions/manual_entry_form.tsx:179-184`, `components/loans/record_payment_sheet.tsx:76-77`, `lib/transactions/manual_entry.ts:40`, `lib/db/repos/goals_repo.ts:48,98`, `app/(tabs)/plan/goals/new.tsx:49`
- Test: `lib/wallets/__tests__/summary.test.ts`, `lib/db/repos/__tests__/goals_repo.test.ts`, and the screen suites named in Task 9

**Interfaces:**
- Consumes: `Wallet.owedBalance`, `Wallet.matcherCount` (Task 4).
- Produces: `isManualOnly(wallet: Wallet): boolean`, `splitByOwed(wallets: readonly Wallet[]): { held: Wallet[]; owed: Wallet[] }` from `lib/wallets/summary.ts`. `WALLET_TYPE_ORDER`, `WALLET_TYPE_LABELS`, `WalletGroup` and `groupWalletsByType` are deleted.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/lib/wallets/__tests__/summary.test.ts — replacing the grouping cases
test("the total excludes owed wallets, whatever they used to be called", () => {
  const wallets = [
    wallet({ id: "a", balance: 100_000 }),
    wallet({ id: "b", balance: 50_000, owedBalance: true }),
    wallet({ id: "c", balance: 25_000, isArchived: true }),
  ];
  expect(totalActiveBalance(wallets)).toBe(100_000);
  expect(totalActiveWalletCount(wallets)).toBe(1);
});

test("splitByOwed keeps archived wallets out of both halves", () => {
  const wallets = [
    wallet({ id: "a" }),
    wallet({ id: "b", owedBalance: true }),
    wallet({ id: "c", isArchived: true }),
    wallet({ id: "d", owedBalance: true, isArchived: true }),
  ];
  expect(splitByOwed(wallets)).toEqual({
    held: [expect.objectContaining({ id: "a" })],
    owed: [expect.objectContaining({ id: "b" })],
  });
});

test("a wallet nothing routes to is manual-only", () => {
  expect(isManualOnly(wallet({ id: "a", matcherCount: 0 }))).toBe(true);
  expect(isManualOnly(wallet({ id: "a", matcherCount: 1 }))).toBe(false);
});
```

```ts
// mobile/lib/db/repos/__tests__/goals_repo.test.ts — the gate is gone
test("a goal attaches to any wallet, not only a savings one", async () => {
  const spending = await createWallet({ name: "GCash" });
  const goal = await createGoal({ name: "Laptop", targetAmount: 5_000_000, linkedWalletId: spending.id });
  expect(goal.linkedWalletId).toBe(spending.id);
});
```
Delete the three `WalletNotSavingsError` assertions at `:109`, `:117`, `:260`.

- [ ] **Step 2: Run and watch it fail**

Run: `npx jest lib/wallets lib/db/repos/__tests__/goals_repo.test.ts`
Expected: FAIL — `splitByOwed` / `isManualOnly` not exported; the goals test still throws.

- [ ] **Step 3: Rewrite `summary.ts`**

Keep the file's existing header argument — it is still true, and the exclusion it defends is now `owedBalance` rather than `type === "credit"`. Replace `groupWalletsByType` with:

```ts
/**
 * The Wallets tab's two lists. Archived wallets are in NEITHER: they belong to
 * the collapsed "Archived" section, not mixed into live money.
 */
export function splitByOwed(wallets: readonly Wallet[]): { held: Wallet[]; owed: Wallet[] } {
  const active = wallets.filter((wallet) => !wallet.isArchived);
  return {
    held: active.filter((wallet) => !wallet.owedBalance),
    owed: active.filter((wallet) => wallet.owedBalance),
  };
}

/**
 * Nothing routes to this wallet, so nothing can track it automatically — what
 * `type: "cash"` meant before the app stopped asking. DERIVED, NOT STORED: a
 * wallet whose last matcher is removed becomes manual the moment it does, which
 * is correct and would need a listener to keep true if it were a flag.
 */
export function isManualOnly(wallet: Wallet): boolean {
  return wallet.matcherCount === 0;
}
```

Both totals swap `wallet.type !== "credit"` for `!wallet.owedBalance`. Delete `WALLET_TYPE_ORDER`, `WALLET_TYPE_LABELS`, `WalletGroup`.

- [ ] **Step 4: Move every consumer**

Mechanical, one line each — the full list is in **Files** above. The substitutions:

| Was | Becomes |
|---|---|
| `wallet.type === "credit"` | `wallet.owedBalance` |
| `wallet.type === "cash"` | `isManualOnly(wallet)` |
| `wallet.type !== "cash"` | `!isManualOnly(wallet)` |
| `wallet.type === "savings"` (goals) | *deleted — no gate* |
| `<WalletTypeIcon type={wallet.type} />` | `<WalletIcon wallet={wallet} />` |
| `groupWalletsByType(wallets)` | `splitByOwed(wallets)` |

`wallet_icon.tsx` picks in this order: the provider badge for the wallet's first matcher, a card glyph when `owedBalance`, a banknote glyph when `isManualOnly`, and a generic wallet glyph otherwise. Delete `WALLET_TYPE_ICONS` with the old file.

In `goals_repo.ts` delete `WalletNotSavingsError` (`:48`) and the guard at `:98` entirely. In `app/(tabs)/plan/goals/new.tsx:49`, the filter becomes `(wallet) => !wallet.owedBalance && !wallet.isArchived && !claimed.has(wallet.id)`, ordered by balance descending.

- [ ] **Step 5: Run everything and commit**

```bash
npx jest
npm run typecheck
git add -A
git commit -m "refactor(wallets): decide behaviour from traits instead of type"
```

Expected: the wallet/goal/transaction suites pass. Suites that construct wallets with `type:` still compile — the field is still on `NewWallet` until Task 8.

---

### Task 8: The question disappears from the UI

**Files:**
- Modify: `app/(onboarding)/wallets.tsx` (delete `WALLET_TYPE_BY_PROVIDER_KEY:102-116`, `defaultTypeFor:138`, `changeType:315`, and the `type` in the cash proposal at `:189`)
- Modify: `components/onboarding/quick_wallet_list.tsx` (delete `type` from `WalletProposal:53`, `onChangeType:95,110`, the icon at `:151`, and the type segment row at `:198`)
- Modify: `components/wallets/wallet_form.tsx` (delete `TYPE_SEGMENT_LABELS:46`, `TYPE_SEGMENTS:54`, `TYPE_UNSET:60`, the `type` state at `:106`, `chooseType:126`, and the `SegmentedControl` at `:191`)
- Modify: `app/wallet/[id].tsx` — add the plain-language conclusion line and its correction
- Modify: `types/domain.ts` — `NewWallet` loses `type`
- Modify: `lib/db/repos/wallets_repo.ts` — `createWallet` no longer reads `input.type`
- Test: `components/onboarding/__tests__/quick_wallet_list.test.tsx`, `app/(onboarding)/__tests__/wallets_step.test.tsx`, `app/__tests__/wallet_routes.test.tsx`

**Interfaces:**
- Consumes: `setWalletOwed` (Task 5), `isManualOnly` (Task 7).
- Produces: `NewWallet = { name: string; openingBalance?: Centavos }`.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/app/(onboarding)/__tests__/wallets_step.test.tsx
test("the wallet step never asks what kind of wallet it is", async () => {
  renderWalletsStep();
  await screen.findByText("BPI");
  expect(screen.queryByText("Savings")).toBeNull();
  expect(screen.queryByText("E-wallet")).toBeNull();
  expect(screen.queryByText("Credit")).toBeNull();
  expect(screen.queryByTestId("wallet-type-segments")).toBeNull();
});

test("a proposal still creates its wallet and its matchers", async () => {
  renderWalletsStep();
  fireEvent.press(await screen.findByText("Continue"));
  const wallets = await listWallets();
  expect(wallets.map((w) => w.name)).toContain("BPI");
  expect(wallets.find((w) => w.name === "Cash")?.matcherCount).toBe(0);
});
```

```tsx
// mobile/app/__tests__/wallet_routes.test.tsx
test("wallet detail states what the app concluded, in plain words", async () => {
  const wallet = await createWallet({ name: "BPI", openingBalance: 100_000 });
  renderWalletDetail(wallet.id);
  expect(await screen.findByText(/money you have/i)).toBeTruthy();
});

test("correcting the conclusion pins it", async () => {
  const wallet = await createWallet({ name: "BPI Card", openingBalance: 100_000 });
  renderWalletDetail(wallet.id);
  fireEvent.press(await screen.findByTestId("wallet-kind-correct"));
  fireEvent.press(await screen.findByTestId("wallet-kind-owed"));
  const reloaded = await getWallet(wallet.id);
  expect(reloaded?.owedBalance).toBe(true);
  expect(reloaded?.owedPinned).toBe(true);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx jest app/(onboarding)/__tests__/wallets_step.test.tsx app/__tests__/wallet_routes.test.tsx`
Expected: FAIL — the type segments still render; `createWallet` still requires `type`.

- [ ] **Step 3: Strip the pickers**

Delete the constants and handlers named in **Files**. The onboarding proposal becomes `{ key, name, openingBalance, matchers }` — provider badge, name, opening balance, nothing else. The cash row keeps its name and simply carries no matchers, which is what makes it manual.

In `wallet_form.tsx`, a wallet is name, opening balance, and matchers. Delete the `type === "cash"` branch at `:132` and the `matchers: type === "cash" ? [] : matchers` at `:145` — the user picking no matcher is now the whole mechanism.

- [ ] **Step 4: Add the conclusion line to wallet detail**

```tsx
// app/wallet/[id].tsx — where the type badge used to sit.
//
// STATES THE CONCLUSION, DOES NOT ASK FOR ONE. The user reads what the app
// decided in words they already use, and corrects it in one tap if it is wrong.
<Text className="text-sm text-fg-2 dark:text-fg-2-dark">
  {wallet.owedBalance ? "Counted as money you owe" : "Counted as money you have"}
  {isManualOnly(wallet) ? " · Tracked by hand" : ""}
</Text>
<Pressable testID="wallet-kind-correct" onPress={openKindSheet}>
  <Text className="text-sm text-accent">That's not right</Text>
</Pressable>
```

The sheet reuses `WalletKindBody` from Task 6 and calls `setWalletOwed(wallet.id, owed, { pinned: true })`.

- [ ] **Step 5: Drop `type` from `NewWallet`**

```ts
// types/domain.ts
export type NewWallet = {
  name: string;
  /** Opening balance anchor (docs/02-domain-model.md §3.1); defaults to 0. */
  openingBalance?: Centavos;
};
```

In `createWallet`, `owedBalance` and `owedPinned` are now plainly `false`. The `INSERT` still names `type` and passes the literal `'bank'` — a placeholder that exists for exactly one task, until 014 removes the column. Comment it as such so nobody mistakes it for a default anyone believes in.

- [ ] **Step 6: Sweep the 59 test files**

Every `createWallet({ name: "X", type: "..." })` drops its `type`. Where a test depended on credit semantics, it becomes `createWallet({ name: "X" })` followed by `setWalletOwed(wallet.id, true, { pinned: true })`. Where it depended on cash semantics, it simply creates no matchers.

Run: `npx jest`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(onboarding): stop asking what kind of wallet this is"
```

---

### Task 9: Migration 014 removes the column

Nothing reads `type` any more. This is the contract step, and the one that needs Task 1's runner change.

**Files:**
- Create: `mobile/lib/db/migrations/014_drop_wallet_type.sql`
- Modify: `mobile/lib/db/migrations.ts` (register 014 with `disablesForeignKeys: true`)
- Modify: `mobile/types/domain.ts` (delete `WalletType`), `mobile/lib/db/mappers.ts` (drop `type` from `WalletRow` and both mappers), `mobile/lib/db/repos/wallets_repo.ts` (drop it from the `INSERT`)
- Test: `mobile/lib/db/__tests__/migrations.test.ts` (existing — add cases)

**Interfaces:**
- Consumes: `Migration.disablesForeignKeys` (Task 1).
- Produces: a `wallets` table with no `type` column.

- [ ] **Step 1: Write the failing test**

```ts
// append to mobile/lib/db/__tests__/migrations.test.ts
test("the rebuild keeps every reference into wallets intact", async () => {
  const db = await freshDbThrough(13); // helper: run migrations up to a version
  await seedWalletWithEverything(db); // wallet + matcher + transaction + goal + loan

  await runMigrations(db, MIGRATIONS);

  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(wallets)");
  expect(columns.map((c) => c.name)).not.toContain("type");

  expect(await db.getAllAsync("PRAGMA foreign_key_check")).toEqual([]);
  expect(await db.getAllAsync("SELECT id FROM wallet_matchers")).toHaveLength(1);
  expect(await db.getAllAsync("SELECT id FROM transactions")).toHaveLength(1);
  expect(await db.getAllAsync("SELECT id FROM goals")).toHaveLength(1);
  expect(await db.getAllAsync("SELECT id FROM loans")).toHaveLength(1);
});

test("balances and pinned verdicts survive the rebuild", async () => {
  const db = await freshDbThrough(13);
  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, owed_balance, owed_pinned, created_at, updated_at)
     VALUES ('w1', 'Card', 'credit', 250000, 'PHP', 0, 1, 1, 1, 1)`,
  );
  await runMigrations(db, MIGRATIONS);
  const row = await db.getFirstAsync<{ balance: number; owed_balance: number; owed_pinned: number }>(
    "SELECT balance, owed_balance, owed_pinned FROM wallets WHERE id = 'w1'",
  );
  expect(row).toEqual({ balance: 250000, owed_balance: 1, owed_pinned: 1 });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx jest lib/db/__tests__/migrations.test.ts`
Expected: FAIL — `type` is still a column.

- [ ] **Step 3: Write migration 014**

```sql
-- mobile/lib/db/migrations/014_drop_wallet_type.sql — the type question leaves
-- the schema, now that nothing asks it and nothing reads it.
--
-- WHY THIS ONE NEEDS `disablesForeignKeys`, AND 011/012 DID NOT. Those rebuilt
-- `review_queue_items`, which no table references. FOUR tables reference
-- `wallets(id)` — wallet_matchers, transactions, goals, loans — and the
-- connection runs with `PRAGMA foreign_keys = ON` (lib/db/database.ts). SQLite
-- ignores a foreign_keys pragma issued inside a transaction, and the runner
-- puts every migration in one, so this migration declares
-- `disablesForeignKeys: true` and the runner toggles the pragma around the
-- transaction — then runs `PRAGMA foreign_key_check` BEFORE COMMIT, so an
-- orphan rolls the whole rebuild back instead of shipping.
--
-- Never edit 001-013 — add a new numbered migration instead.
CREATE TABLE wallets_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PHP',
  is_archived INTEGER NOT NULL DEFAULT 0,
  drift_dismissed_transaction_id TEXT,
  owed_balance INTEGER NOT NULL DEFAULT 0,
  owed_pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO wallets_new (
  id, name, balance, currency, is_archived, drift_dismissed_transaction_id,
  owed_balance, owed_pinned, created_at, updated_at
)
SELECT id, name, balance, currency, is_archived, drift_dismissed_transaction_id,
       owed_balance, owed_pinned, created_at, updated_at
  FROM wallets;

DROP TABLE wallets;

ALTER TABLE wallets_new RENAME TO wallets;
```

Register it:

```ts
import dropWalletTypeSql from "./migrations/014_drop_wallet_type.sql";
// ...
  { version: 14, name: "drop_wallet_type", sql: dropWalletTypeSql, disablesForeignKeys: true },
```

- [ ] **Step 4: Delete the type from the code**

Remove `WalletType` from `types/domain.ts`, `type` from `WalletRow` and both mappers, and the `'bank'` placeholder from `createWallet`'s `INSERT`.

- [ ] **Step 5: Clear the cache, run everything**

```bash
npx jest --clearCache
npx jest
npm run typecheck
```
Expected: PASS, and `grep -rn "WalletType" mobile --include=*.ts --include=*.tsx` returns nothing outside `node_modules`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(db): drop the wallet type column"
```

---

## Self-Review

**Spec coverage.** §3.1 traits → Tasks 4, 7. §3.2 types → Tasks 4, 8, 9. §3.3 migrations and runner → Tasks 1, 4, 9. §4 inference → Tasks 2, 3, 5. §5 the question → Task 6. §6 screens → Tasks 7, 8. §7 testing → covered per task, with the 59-file sweep in Task 8 Step 6. §8 out of scope → nothing here builds facets, a server, or historical backfill. §9 assumptions → the materiality constants are named and commented in Task 6.

**Placeholders.** None. Every code step carries the code.

**Type consistency.** `TraitEvidence`, `EvidenceDelta`, `OwedVerdict`, `OwedPrior`, `TraitSignal`, `WalletTraitTunables` are defined once in Task 2 and used with those exact names in Tasks 3, 5, 6. `isManualOnly` and `splitByOwed` are defined in Task 7 and used in Tasks 7 and 8. `setWalletOwed` is defined in Task 5 and used in Tasks 6 and 8.

**Known soft spots for the executor.** Task 5 Step 5 depends on `previousBalance` and `captureText` being in scope at `pipeline.ts:489`; if the variable names differ, read the surrounding function rather than introducing new reads — re-reading the wallet after `insertTransaction` returns the post-snap balance and would score every capture as ordinary. Task 6's `hasEverAskedWalletKind` uses a `LIKE` over `payload_json`; if the review repo grows a payload index, move to it.
