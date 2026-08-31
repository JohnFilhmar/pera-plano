# PeraPlano Implementation — Interface Contract (read FIRST, all plans obey this)

This contract pins every seam shared by more than one implementation plan. Plan authors and
task implementers MUST use these exact names, signatures, routes, and tokens. A plan may add
private internals freely; it may not rename or reshape anything defined here. Product behavior
is specified by `docs/` (feature specs) — this file only fixes the technical seams.

## 1. Repository layout & conventions

```
pera-plano/            (git root, monorepo)
  docs/                planning + specs (already written)
  mobile/              Expo React Native app — stack per mobile/docs/STACK_BASIS.md
  server/              Fastify + Prisma + Postgres (Node.js, TypeScript strict)
```

- **Naming:** snake_case for ALL file and directory names (mobile + server) and ALL database
  identifiers (tables, columns). TypeScript symbols keep TS idioms: `camelCase` variables and
  functions, `PascalCase` components and types, `SCREAMING_SNAKE_CASE` constants.
  This intentionally overrides STACK_BASIS §14's kebab-case filename convention.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). No
  AI-attribution trailers or footers of any kind.
- **Tests:** mobile = jest + jest-expo (`npx jest --ci`); server = vitest (`npm test` runs
  `vitest run`), integration tests via `fastify.inject()`, Postgres via the `postgres` service in
  the root `docker-compose.yml`, schema via Prisma migrations. TDD per plan steps.
- **Currency:** integer **centavos** everywhere (DB, wire, logic). Format to `₱1,234.56` only at
  display. Type alias `type Centavos = number`.
- **Time:** epoch milliseconds (`number`) in code and DB (`INTEGER` sqlite / `BIGINT` pg);
  calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings generated client-side (mobile) / server-side (server).

## 2. Design tokens — `mobile/constants/colors.ts`

Single palette source (STACK_BASIS §4). Green-led, PH-flag accents. Every token has a `-dark` sibling.

```ts
export const palette = {
  brand: "#15803D",        "brand-dark": "#22C55E",
  "brand-soft": "#DCFCE7", "brand-soft-dark": "#14261C",
  bg: "#F7FAF7",           "bg-dark": "#0B1210",
  surface: "#FFFFFF",      "surface-dark": "#111A16",
  fg: "#10201A",           "fg-dark": "#E8F0EC",
  "fg-2": "#5B6E64",       "fg-2-dark": "#9BB0A6",
  danger: "#DC2626",       "danger-dark": "#F87171",
  warn: "#D97706",         "warn-dark": "#FBBF24",
  "ph-blue": "#0038A8",    "ph-blue-dark": "#4D7CDB",
  "ph-red": "#CE1126",     "ph-red-dark": "#E4566A",
  "ph-yellow": "#FCD116",  "ph-yellow-dark": "#FCD116",
} as const;
```

PH-flag colors are accent-only (badges, "made in PH" mark) — brand green leads. Icons: lucide;
brand mark = `Send`.

## 3. Mobile local database (SQLCipher via op-sqlite)

Owned by the **foundation plan**: `mobile/lib/db/` — `database.ts` (open + PRAGMA foreign_keys ON),
`migrations.ts` (numbered migration runner, `schema_migrations` table), `migrations/001_core.sql`
creates ALL tables below (full schema known from `docs/02-domain-model.md`; map camelCase fields
→ snake_case columns). Feature plans NEVER run DDL; they use repositories.

> **Encryption amendment (2026-08-07).** The database is **SQLCipher-encrypted**, opened with
> `@op-engineering/op-sqlite` rather than `expo-sqlite`. `database.ts` gains:
> ```ts
> unlockDatabase(dek: Uint8Array): Promise<void>;
> isDatabaseUnlocked(): boolean;
> getDatabase(): Promise<DB>;   // now THROWS DatabaseLockedError before unlock
> ```
> **`getDatabase()` throwing when locked is deliberate.** Returning a fresh empty handle instead
> would let repositories silently write into a second, unencrypted store — data loss that looks
> like a working app. Every repository call therefore has a new failure mode; callers running
> behind the app lock satisfy it by construction, but code paths that can run while locked (the
> listener, scheduled alert delivery) must never touch a repository.
> Migrations run **after** unlock, on the decrypted handle; `001_core.sql` is unchanged. The Jest
> mock stays plaintext `sql.js` — repository tests exercise repository logic, not encryption,
> which is proven by the Kotlin tests and an on-device check. See `docs/12-encryption-and-app-lock.md`.

Tables (PKs are `id TEXT`; FKs `<entity>_id`):
`wallets`, `wallet_matchers`, `transactions`, `transfer_links`, `categories`, `limits`,
`income_profiles`, `income_profile_sources`, `goals`, `loans`, `loan_payments`, `bills`,
`bill_payments`, `recurring_patterns`, `user_rules`, `review_queue_items`, `raw_notifications`,
`parser_rulesets`, `app_settings`.

Notable columns (exact names): `transactions(id, wallet_id, category_id, amount, direction,
occurred_at, merchant, counterparty, reference_no, source, confidence, raw_notification_id,
transfer_link_id, note, created_at, updated_at)` · `transfer_links(id, out_transaction_id,
in_transaction_id, fee_amount, status)` · `review_queue_items(id, kind, payload_json,
raw_notification_id, created_at, expires_at, resolved_at)` · `raw_notifications(id, package_name,
title, text, sub_text, big_text, posted_at, captured_at, expires_at)`.

Repository layer `mobile/lib/db/repos/` — one file per aggregate, foundation creates the files and
core functions; later plans extend within the same files. Pinned cross-plan signatures:

```ts
// wallets_repo.ts
createWallet(input: NewWallet): Promise<Wallet>
getWallet(id: string): Promise<Wallet | null>
listWallets(opts?: { includeArchived?: boolean }): Promise<Wallet[]>
// transactions_repo.ts
insertTransaction(tx: NewTransaction): Promise<Transaction>
listTransactions(filter: TxFilter): Promise<Transaction[]>          // TxFilter: {walletId?, categoryId?, from?, to?, direction?, excludeTransferLinked?}
sumSpend(args: { from: number; to: number; categoryIds?: string[]; walletIds?: string[] }): Promise<Centavos>  // direction 'out', transfer-linked excluded
// review_queue_repo.ts
enqueue(item: NewReviewItem): Promise<ReviewQueueItem>
listOpen(): Promise<ReviewQueueItem[]>
resolve(id: string, resolution: ReviewResolution): Promise<void>
countOpen(): Promise<number>
purgeExpired(now: number): Promise<number>
// categories_repo.ts
seedDefaultCategories(): Promise<void>            // idempotent, fixed ids
UNCATEGORIZED_ID: string                          // stable literal "cat_uncategorized"
// app_settings_repo.ts — typed key/value; values are JSON-encoded so booleans/numbers/null survive
getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]>   // returns the default when unset
setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>
getAllSettings(): Promise<AppSettings>
resetSettings(): Promise<void>
```

> **Shipped reality, recorded 2026-08-07 (foundation Tasks 1–14 complete).** Several plans were
> drafted against guessed table shapes that turned out wrong in ways that fail at *runtime*, not
> compile time. `mobile/lib/db/migrations/001_core.sql` is the source of truth. The corrections:
>
> | Guessed in some plans | Actually shipped |
> |---|---|
> | `getDb()` | **`getDatabase()`** (with `closeDatabase()`) |
> | `app_settings(key TEXT PK, value TEXT)` | `app_settings(id PK, key UNIQUE, **value_json**, updated_at)` — go through `app_settings_repo`, never raw SQL |
> | `parser_rulesets(..., providers_json, updated_at)`, singleton `id='current'` | `parser_rulesets(id, **version** UNIQUE, **payload_json**, **installed_at**)` — "current" is the highest `version`, there is no singleton row |
> | `wallet_matchers(..., provider_key, package_name, ...)` | `wallet_matchers(id, wallet_id, **package_name**, hint, ...)` — **no `provider_key` column**; match on `package_name` (+ optional `hint` when one provider feeds two wallets) |
> | `ReviewKind` with underscores; 5-variant tagged `ReviewResolution` | hyphenated kinds (`low-confidence`, `unknown-provider`, `ambiguous-transfer`, `possible-duplicate`); `ReviewResolution = "confirmed" \| "dismissed"` |
> | `limits(..., category_filter, wallet_filter, thresholds_fired, ...)` | `limits(id, scope, basis, value, **category_filter_json**, **wallet_filter_json**, rollover, is_active, **thresholds_fired_json**, created_at, updated_at)` — added 2026-08-15 from m2 Task 3 |
>
> Also settled by implementation: date ranges are **`[from, to)`** — `from` inclusive, `to`
> exclusive — everywhere. Transfer exclusion keys on `transactions.transfer_link_id IS NULL`.

> **Migration 004 amendment (2026-08-15).** `limits` gains a nullable
> `limit_alert_state_json TEXT` column, by the project owner's explicit decision through the m2
> plan's own escalation path ("if a column is entirely MISSING, STOP and escalate").
>
> m2 Task 3 planned to store the limit engine's whole per-period state
> (`{ periodStart, base, carryover, fired[], muted, lastSpend }`) as JSON inside
> `thresholds_fired_json`. That column is an **array** with a `NOT NULL DEFAULT '[]'`, the domain
> type pins `Limit.thresholdsFired: LimitThreshold[]`, and `docs/02-domain-model.md` §3.5 types it
> `list<enum: 50 | 80 | 100>` — so the object would have contradicted all three, silently, in a
> column still named for an array.
>
> **The state is split across two columns and written in ONE `UPDATE`.** `fired[]` stays in
> `thresholds_fired_json` (it is the domain field the rest of the app reads); the other five live
> in `limit_alert_state_json`. A period boundary resets `fired` and re-snapshots `base` together
> and must never half-apply. `limits_repo`'s `getLimitAlertState` / `setLimitAlertState` reassemble
> and split them, so no caller sees the seam.
>
> **`NULL` in `limit_alert_state_json` means "never evaluated", and it is the ONLY presence
> signal.** Emptiness in `thresholds_fired_json` cannot carry that meaning — being `NOT NULL
> DEFAULT '[]'`, it reads the same for a limit the engine has never seen and for a period whose
> first evaluation fired nothing. Confusing them makes the engine re-snapshot `base` on every
> ledger commit, which for a percent-of-income limit means the base tracking income mid-period
> instead of being fixed at the boundary (limits rule 11).
>
> The alternative — one `app_settings` key holding `Record<limitId, state>`, which m2's Global
> Constraint 9 would otherwise prescribe — was rejected: every recompute would rewrite every
> limit's state, atomicity with `thresholds_fired_json` would need a second write, and
> `app_settings` has no foreign key to `limits`, so `deleteLimit` would orphan the entry forever.

> **`Limit.value` for `percent-of-income` is percent × 100 (12.5% → 1250)**, per
> `types/domain.ts` — *not* whole percent 0–100 as the m2 plan's `NewLimit` comment says. An engine
> written to the plan computes limits 100× too small. M2 types live in `mobile/types/control.ts`
> (`LimitAlertState`, `NewLimit`); `LimitScope`, `LimitBasis` and `LimitThreshold` are **not**
> redefined there — they are domain types and are imported.

Domain types in `mobile/types/domain.ts` (foundation owns): `Wallet`, `Transaction`,
`TransferLink`, `Category`, `Limit`, `IncomeProfile`, `Goal`, `Loan`, `Bill`,
`RecurringPattern`, `UserRule`, `ReviewQueueItem`, `RawCapture`, `Centavos` — field names
camelCase mirrors of the columns above.

## 4. Native module — `mobile/modules/notification_listener/`

Local Expo Module (Expo Modules API, Kotlin) + config plugin. Config plugin injects into the
manifest: the `NotificationListenerService` subclass with
`android.permission.BIND_NOTIFICATION_LISTENER_SERVICE` + its intent filter, and a
`BOOT_COMPLETED` receiver. Native side buffers captures to disk while JS is dead; JS drains on
start. CNG-safe: nothing committed under `mobile/android/`.

JS API (`mobile/modules/notification_listener/index.ts`):

```ts
export type RawCapture = {
  id: string; packageName: string; title: string | null; text: string | null;
  subText: string | null; bigText: string | null; postedAt: number; capturedAt: number;
};
export function isAccessGranted(): Promise<boolean>;
export function openAccessSettings(): void;                       // deep-link to system screen
export function setCaptureEnabled(enabled: boolean): Promise<void>;    // global pause switch
export function setProviderFilter(packageNames: string[]): Promise<void>; // capture allowlist
export function drainPendingCaptures(): Promise<RawCapture[]>;    // buffered-while-dead queue
export function addCaptureListener(cb: (c: RawCapture) => void): () => void; // live events
export function getListenerHealth(): Promise<{
  granted: boolean; serviceConnected: boolean; lastCaptureAt: number | null;
}>;

// Added 2026-08-13 by the provider-selection plan (Task 3). The listener records the package
// name of EVERY notification it sees -- including the ones it drops for being filtered out or
// ongoing, because a package the user has not selected is precisely the one the onboarding
// picker must offer. PACKAGE NAMES ONLY: never a title, never body text. Bounded at 100,
// evicting the least-recently-seen, and sealed at rest like the provider filter. Needs NO new
// Android permission -- deliberately not QUERY_ALL_PACKAGES.
export type ObservedPackage = { packageName: string; count: number; lastSeenAt: number };
export function listObservedPackages(): Promise<ObservedPackage[]>; // newest-first

// Added 2026-08-07 by the encryption plan. See docs/12-encryption-and-app-lock.md.
export function getCapturePublicKey(): Promise<string>;           // base64 SPKI; NO auth required
// STRUCK 2026-08-09 (M1a Task 6). `decryptCaptures(lines)` was never implemented in the Kotlin
// module or index.ts -- it existed only here, a leftover from an intermediate design where JS
// held the raw NDJSON and asked native to decrypt it. The shipped design keeps the buffer file
// entirely below the bridge: CaptureBuffer.fileFor(context) is native-only, JS never sees a
// sealed line, and drainPendingCaptures does read + decrypt + delete in one native call under
// the same lock append takes. Adding it back would require JS to obtain lines it has no way to
// obtain, and would break drain's decrypt-before-touch property (a UserNotAuthenticated must
// leave every capture on disk). Do not reintroduce it.
export function wrapWithDeviceKek(plaintextB64: string): Promise<string>;
export function unwrapWithDeviceKek(blobB64: string): Promise<string>;
export function isDeviceKeyUsable(): Promise<boolean>;            // false once the Keystore key is destroyed
export function recreateDeviceKek(): Promise<void>;               // deletes the dead alias, then generates fresh
export function isDeviceSecure(): Promise<boolean>;               // KeyguardManager.isDeviceSecure()
export function openSecuritySettings(): void;                     // deep-link, to set a screen lock
export function isKeyguardLocked(): Promise<boolean>;             // drives amount-free alert copy
```

**The device-KEK state machine has four states, and the bridge distinguishes all four.** Collapsing any two produces a bug that looks like data loss:

| State | Rejection code | What the caller must do |
|---|---|---|
| Never created | `DeviceKeyMissing` | Route to onboarding — there is nothing to recover |
| Created, usable | *(resolves)* | Normal unlock |
| Created, auth window closed | `NotAuthenticated` | Re-prompt biometric and retry; **never** treat as an empty result |
| Created, permanently invalidated | `DeviceKeyInvalidated` | Recovery words → `recreateDeviceKek()` → re-wrap the DEK |

A fifth code, `CaptureBufferReadFailed`, means the buffer file could not be read. It is **not** emptiness: `drain()` decrypts before touching the file, so the captures are still on disk. Leave them and retry later.

JS branches on `instanceof` or `.code`, never on message strings. An unrecognized native code passes through unchanged rather than being miscategorized.

> **`recreateDeviceKek()` exists because `ensureDeviceKek()` cannot recover.** `ensureDeviceKek()` is
> presence-only idempotent, and an *invalidated* key still has its alias present — so re-running it
> after invalidation returns the same dead key and `rewrapAfterInvalidation` would fail identically,
> looping the user through their recovery words forever. Android requires the dead alias be deleted
> before a usable replacement can be generated. Keep the two separate: `ensureDeviceKek()` must never
> rotate (that would orphan every existing wrap), and `recreateDeviceKek()` must be explicitly
> destructive at the call site.
>
> **Known gap:** `isDeviceKeyUsable()` returns `false` for both "never created" and "invalidated".
> Task 6's `getKeyState()` needs a presence check to tell them apart without provoking a failed unwrap.

**Encryption amendments (2026-08-07).** Captures are written to disk **sealed** — an RSA-OAEP-wrapped
AES-256-GCM envelope per record, under a Keystore public key the listener can read without
authenticating. The private key is auth-gated, so the listener can write forever and read nothing.
`drainPendingCaptures()` keeps its exact signature and still returns plaintext `RawCapture[]`;
decryption happens below the bridge, so no caller learns the captures were ever encrypted. It does
now **require the app to be unlocked**. Binary crosses the bridge as base64, never as number arrays.
`KeyPermanentlyInvalidatedException` surfaces as a distinguishable `DeviceKeyInvalidated` rejection,
because JS must respond by prompting for recovery words rather than showing a generic failure.

## 5. Ingest pipeline — `mobile/lib/ingest/`

Stage modules (one file each): `source_router.ts`, `parser.ts`, `normalizer.ts`,
`dedupe_gate.ts`, `transfer_detector.ts`, `categorizer.ts`, `confidence_gate.ts`,
orchestrated by `pipeline.ts`. Behavior per `docs/03-ingest-pipeline.md`.

```ts
// pipeline.ts
export async function processCapture(capture: RawCapture): Promise<PipelineOutcome>;
export type PipelineOutcome =
  | { kind: "committed"; transactionId: string }
  | { kind: "queued"; reviewItemId: string }
  | {
      kind: "ignored";
      reason:
        | "not_financial"
        | "duplicate"
        | "unknown-provider"
        | "paused"
        | "unreadable"; // "unreadable" ADDED 2026-08-20 — see note below
    };

// parser.ts — rules come from the parser_rulesets table (seeded from bundled JSON, updatable from server)
export type ParsedEvent = {
  providerKey: string; amount: Centavos; direction: "in" | "out";
  merchant?: string; counterparty?: string; referenceNo?: string; balanceAfter?: Centavos;
  occurredAt: number; walletHint?: string; confidence: number; // 0..1
};
export function parseCapture(
  capture: RawCapture,
  rules: ProviderRuleset[],
  tunables: PipelineTunables,   // ADDED 2026-08-10 — see note below
): ParsedEvent | null;
```

> **`"unreadable"` added 2026-08-20 (review-floor amendment).** A provider match with nothing
> readable in the text used to enqueue unconditionally (`pipeline.ts`'s `parsed === null`
> branch), which is how the Review Queue filled with identical cards carrying no amount, no
> merchant and no wallet — items the user could neither act on nor get rid of. That branch now
> asks `confidence_gate.ts`'s `decideRoute`, whose new `"discard"` route only fires when nothing
> parsed AND the score is at or below `PipelineTunables.reviewFloorThreshold`; a capture that DID
> parse an amount is never discarded on a score alone. `"unreadable"` is the resulting outcome:
> additive to the `reason` union, every existing reason unchanged, and the raw capture stays
> stored and visible in the Privacy Centre for its full 30-day TTL regardless.
>
> **`tunables` added 2026-08-10 (after M1b Task 4).** The signature previously ended at `rules`,
> which made a spec requirement unimplementable: spec §9.1's penalty table "ships as tunable
> ruleset data (§11)", but with no `tunables` parameter the parser could only read
> `DEFAULT_TUNABLES`. A server bundle retuning `weakDirection`, `amountAmbiguity`,
> `merchantMissing` or `smsChannel` would have moved nothing, while the Normalizer's and
> DedupeGate's tunables — which *are* passed in — moved normally. That is the worst kind of
> half-working: remote tuning appears to be wired up and silently is not, for exactly the four
> penalties that decide auto-commit.
>
> Every other stage already takes `tunables` as its trailing argument (`normalizeEvent`,
> `checkDuplicate`, `detectTransfer`), so this is a correction to an oversight, not a new pattern.

```ts
// normalizer.ts — pinned 2026-08-10 (M1b Task 5). Previously this signature lived only in the
// M1b plan, which is why the `matchers` parameter could be added freely; recorded here so the
// next change is a deliberate contract edit rather than a drift.
export type NormalizedEvent = ParsedEvent & {
  walletId: string | null;      // null is a HARD Review Queue route (spec §9.2), not a penalty
  channel: "push" | "sms";
};
export function normalizeEvent(
  event: ParsedEvent,
  provider: ProviderRuleset,
  wallets: Wallet[],
  matchers: WalletMatcher[],    // loaded by the orchestrator; this stage does no I/O
  tunables: PipelineTunables,   // REQUIRED here, unlike parseCapture's optional default
): NormalizedEvent;
```

> **`wallet_matchers` matches on `package_name`, never `provider_key`** — the column does not
> exist (see the shipped-reality table above). `matcher.hint` disambiguates a provider that feeds
> two wallets (GCash main vs GSave) and compares by **equality**, case- and whitespace-folded, not
> by substring: substring matching lets two rows claim the same event and turns wallet routing
> into an array-order accident.

Ruleset JSON shape (bundled seed `mobile/assets/parser_rules/seed.json`; same shape served by
the server): `{ version: number, providers: [{ providerKey, packageNames: string[], version,
channel: "push"|"sms", senderIds?: string[], templates: [{ id, match: string /* regex, named
groups: amount, direction?, merchant?, counterparty?, ref?, balance?, walletHint? */,
direction?: "in"|"out", confidence: number }] }], tunables?: PipelineTunables }`.

> **`channel`, `senderIds`, `tunables` and `walletHint` added 2026-08-10 (M1b Tasks 1–4).** All
> four are **additions** — every field this sketch already named keeps its name and type. Each was
> required by a spec rule with nowhere else to live: `channel` by §9.1's SMS penalty and §6's twin
> window, `senderIds` by §3 rule 2 (without it every personal text message routes as bank SMS),
> `tunables` by §11.1, and `walletHint` because `ParsedEvent.walletHint` above is read by the
> Normalizer to tell a GCash main wallet from GSave — with no capture group to populate it, the
> field was dead on arrival.
>
> **The server's `GET /v1/parser_rules` must serve these too**, or the two ends of a shape that is
> explicitly "the same shape served by the server" will disagree.
>
> `tunables` is optional on the wire and merged over `DEFAULT_TUNABLES` **on read**, so a bundle
> omitting it picks up recalibrated defaults from an app update instead of freezing the values
> that were current when it was installed.

## 6. Server — Fastify + Prisma + Postgres

**The API is a workspace, not the repo root.** `server/` is an npm-workspaces monorepo
(`apps/*`, `libs/*`) whose root `package.json`, `tsconfig.base.json`, `vitest.config.ts` and
`eslint.config.mjs` belong to the already-shipped `@peraplano/web`. The API is a sibling at
`server/apps/api`, per `docs/DEPLOYMENT.md`: *"Extend it, don't replace it, once `apps/api`
exists."* Nothing in an API task may overwrite a file at `server/` root. Amended 2026-08-31; the
original wording said `server/src/` and predates the web workspace.

`server/apps/api/src/` layout: `app.ts` (buildApp(): FastifyInstance, no listen), `server.ts`
(entry), `routes/<domain>_routes.ts`, `services/<domain>_service.ts`, `plugins/` (prisma, auth),
`lib/` (jwt, otp, hashing, google_id_token, play_integrity).
`server/apps/api/prisma/schema.prisma`, models with `@@map`/`@map` snake_case.
Tests in `server/apps/api/test/` mirroring `routes/` + `services/`.

Toolchain follows the workspace it lives in, not the 2026-08-02 draft: Node `>=22`, vitest 4.
Postgres is a service in the root `docker-compose.yml`, not a second compose file under `server/`.

Prisma models (tables): `users`, `otp_requests`, `refresh_tokens`, `parser_rulesets`,
`telemetry_parse_stats`, `backup_vaults`, `entitlements`, `google_identities`,
`install_attestations`.

Routes (all JSON; versioned prefix `/v1` except `/health`):

| Method + path | Auth | Request → Response |
|---|---|---|
| `GET /health` | — | → `{ status: "ok" }` |
| `POST /v1/auth/otp/request` | — | `{ channel: "email", destination }` → `{ requestId }` (OTP mailed; dev: logged) |
| `POST /v1/auth/otp/verify` | — | `{ requestId, code }` → `{ accessToken, refreshToken, user: { id, destination } }` |
| `POST /v1/auth/token/refresh` | — | `{ refreshToken }` → rotated `{ accessToken, refreshToken }`; reuse of a rotated token revokes the family |
| `GET /v1/parser_rules?since_version=N` | — | → `{ version, providers: [...] }` (shape of §5; `304`-style short-circuit: if `since_version` ≥ current → `{ version, providers: [] }`) |
| `POST /v1/telemetry/parse_stats` | — | `{ appVersion, rulesetVersion, providerKey, parsed, failed, periodStart, periodEnd }` → `202`. Aggregate counts only — never content. Rate-limited per IP. |
| `PUT /v1/backup/vault` | Bearer | `{ schemaVersion, deviceId, blob }` (client-side-encrypted, opaque base64) → `{ storedAt }` |
| `GET /v1/backup/vault` | Bearer | → `{ schemaVersion, deviceId, blob, storedAt }` or `404` |
| `POST /v1/auth/google/verify` | — | `{ idToken, integrityToken, installClaim }` → `{ accessToken, refreshToken, user: { id, destination } }`. Envelope is byte-identical to `/v1/auth/otp/verify`: tier never rides in an auth response |
| `POST /v1/auth/google/link` | Bearer | same body → `{ identity: { googleSub, email, linkedAt } }` |
| `GET /v1/entitlements` | Bearer | → `{ tier: "free" \| "plus", source: "stub" \| "beta_cohort" \| "play_billing" }`. Resolved, not a stub; no row resolves to `{ "free", "stub" }` |

Auth: JWT access (15 min) + rotating refresh (30 d) per STACK_BASIS §8 semantics (server side).
Both auth routes issue through the same `lib/jwt.ts`; Google is the primary sign-in and OTP email
is the fallback, and neither replaces the other. Errors:
`{ error: { code: string, message: string } }` with proper status. Env via typed
`server/apps/api/src/config.ts` (`DATABASE_URL`, `JWT_SECRET`, `PORT`, plus the Google and Play
variables in the linking design §11); `.env.example` committed, **never a real `.env`**.

Mobile calls today: `GET /v1/parser_rules`, `POST /v1/telemetry/parse_stats` only. Auth and
entitlements are wired to mobile by the Google linking work
(`../specs/2026-08-31-google-account-linking-design.md`). The vault is built and fully tested
server-side but stays unwired: no ledger data leaves the phone in that pass.

## 7. Entitlements (mobile) — `mobile/lib/entitlements.ts`

```ts
export type Tier = "free" | "plus";
export function getTier(): Tier;                       // MVP: hardcoded "plus"
export function canCreateWallet(currentCount: number): boolean;   // free: < 3
export function canCreateLimit(activeCount: number): boolean;     // free: < 1
export function canCreateGoal(currentCount: number): boolean;     // free: < 1
export function canCreateLoan(currentCount: number): boolean;     // free: < 1
export function historyWindowDays(): number | null;    // free: 90, plus: null (unlimited)
export function hasRecurringDetection(): boolean;      // plus only
export function hasBackup(): boolean;                  // plus only
export function hasProjection(): boolean;              // plus: Safe-to-Spend projection
```

At-cap behavior everywhere: keep data, block new creation, never delete (docs/05-monetization.md).

## 8. Plan ownership map (who creates what)

| Plan | Owns |
|---|---|
| `server-functional-core` | everything under `server/` |
| `mobile-foundation` | Expo scaffold, tooling configs, palette/theme, fonts, nav shell (5 tabs), `lib/db/*` (schema + migrations + core repos), `types/domain.ts`, `lib/entitlements.ts`, query-client/persistence wiring |
| `mobile-ingest-m1` | `modules/notification_listener/*` (Kotlin + plugin + JS), `lib/ingest/*`, parser seed JSON, wallets feature UI, manual entry, Review Queue feature, transactions ledger UI, cash reconciliation |
| `mobile-control-m2` | limits, income detection, goals/savings, loans, bills (logic + UI), alerts via expo-notifications |
| `mobile-insight-m3` | Safe-to-Spend, recurring detection, reports + CSV export, settings/privacy screens, onboarding flow, parser-rules fetch + telemetry client (`services/parser_rules.ts`, `services/telemetry.ts`) |

Execution order: `server` ∥ `mobile-foundation` first (independent); then `m1` → `m2` → `m3`
(each depends on the previous being merged). Plans are written in parallel against THIS contract.

## 9. Key management — `mobile/lib/crypto/`

Owned by `2026-08-07-encryption-foundation.md`. Full rationale in `docs/12-encryption-and-app-lock.md`.

Three keys, each with one job:

| Key | What | Where it lives | Unlocked by |
|---|---|---|---|
| **DEK** | Random 256-bit AES key; encrypts the SQLCipher database | **Never stored bare** — only ever as two wrap blobs | Either wrap below |
| **KEK-device** | AES-256 in the Android Keystore, hardware-backed, StrongBox when available | Keystore, non-exportable by construction | Biometric or device credential |
| **KEK-recovery** | Argon2id-derived from the user's 12 BIP-39 recovery words | Never stored; re-derived from the words | The user typing them |

```ts
// lib/crypto/key_manager.ts
type KeyState = "uninitialized" | "locked" | "unlocked";
initializeKeys(phrase: string[]): Promise<void>;              // first run only
unlockWithDeviceKey(): Promise<Uint8Array>;                    // throws DeviceKeyInvalidated
unlockWithRecoveryPhrase(phrase: string[]): Promise<Uint8Array>;
rewrapAfterInvalidation(phrase: string[]): Promise<void>;
getKeyState(): Promise<KeyState>;
lock(): void;
// lib/crypto/recovery_phrase.ts
generatePhrase(): Promise<string[]>;                           // 12 words, BIP-39 English — ASYNC, see below
deriveRecoveryKey(phrase: string[], salt: Uint8Array): Promise<Uint8Array>;
normalizePhrase(input: string): string[];
validatePhrase(words: string[]): { ok: boolean; badIndexes: number[] };   // checksum-verified
```

> **`generatePhrase` is async on purpose.** It uses `expo-crypto`'s `getRandomBytesAsync`, not the
> synchronous `getRandomBytes`, because the latter documents a `Math.random` fallback under some
> dev/debugger conditions. A phrase generated from `Math.random` would silently compromise both the
> recovery path and the cloud-backup key at once, on exactly the devices a developer is most likely
> to be looking at. Do not "simplify" this to a sync call.
>
> **Argon2id parameters are permanent.** They are part of the on-disk format: change them and every
> existing phrase stops deriving the same key, which means every existing user loses their data.
> They are deliberately lighter than a password KDF would be, and that is correct — a 12-word BIP-39
> phrase carries 128 bits of CSPRNG entropy, so no work factor changes an attacker's position
> against 2^128. The security rests on the entropy source; the KDF is defense in depth against a
> *narrowed* search (a partially-recorded phrase). Do not harden them without a migration path.

Rules that bind every plan:
1. **The DEK is never written unwrapped.** Two wrap blobs plus a salt live in `expo-secure-store`; the DEK exists only in memory while unlocked.
2. **A device screen lock is required.** Android refuses to create an auth-gated Keystore key without one. Onboarding gates on `isDeviceSecure()` and cannot be skipped.
3. **Keystore invalidation is recoverable, not fatal.** Removing the screen lock destroys KEK-device; the recovery words rewrap it without re-encrypting the database.
4. **Losing both paths is unrecoverable** — the lock screen offers a confirmed wipe-and-start-over, because no support process can help.
5. **No key material, plaintext, or recovery word may ever reach a log, crash report, or error message.**

## 10. App lock

Owned by `2026-08-07-encryption-foundation.md`.

- Locked on **cold start**, and again after **five minutes** in the background — measured from when the app backgrounded, not from last interaction.
- `expo-local-authentication` with biometric **or device credential**. Never biometric-only; users without enrolled biometrics must still open their own app.
- **The device KEK uses a 10-second authentication validity window, not per-operation auth.** `setUserAuthenticationParameters(0, …)` would require a `CryptoObject`-bound cipher for every use, which a generic unlock prompt cannot satisfy — the DEK unwrap would throw `UserNotAuthenticatedException` on every unlock. Do not "harden" this back to 0 without also moving the unwrap inside the native biometric callback. Reasoning in `docs/12-encryption-and-app-lock.md` §7.
- `lock()` clears the DEK **and** closes the database handle, so no plaintext page cache survives.
- The root layout's render gate has **four** conditions: fonts, theme, bootstrap, and unlocked.
- **The listener keeps capturing while locked** (§4). Tracking never stops because the app is locked.
- **Alerts carry two copy variants.** With the keyguard on, no amount, balance, counterparty, or parsed merchant may appear — a bill or wallet name the user chose is fine. Selected at **post** time via `selectAlertCopy(copy, await isKeyguardLocked())`, never at schedule time. This binds M2, M2b, M2c and M3: a task supplying one string instead of two is incomplete. See §11 for the two cases the rule actually resolves to.

## 11. Alerts transport — `mobile/lib/alerts/`

Owned by `2026-08-02-mobile-control-m2.md` Task 2 (shipped 2026-08-15). Copy builders are in
`alert_copy.ts` (encryption plan); this is the delivery half. Every M2/M2b/M2c/M3 notification
goes through it.

```ts
// channels.ts — Android channel ids. PERMANENT: once a channel exists on a device the OS
// allows changing only its name and description, and a user who disables one has disabled
// that id forever. Renaming a constant abandons the old channel on every device that has it.
export const CHANNEL_LIMITS = "limits";        // AndroidImportance.HIGH — interrupts
export const CHANNEL_REMINDERS = "reminders";  // AndroidImportance.DEFAULT — quiet
export type AlertChannel = typeof CHANNEL_LIMITS | typeof CHANNEL_REMINDERS;

// alerts_service.ts
ensureNotificationChannels(): Promise<void>            // idempotent; call on launch
requestAlertPermission(): Promise<boolean>             // returns early when already granted
postAlert(input: { channel: AlertChannel; copy: AlertCopy; data?: Record<string, unknown> }): Promise<string | null>
scheduleReminder(input: { channel: AlertChannel; copy: AlertCopy; fireAt: number; data?: Record<string, unknown> }): Promise<string | null>
cancelScheduled(identifier: string): Promise<void>
```

- **`copy: AlertCopy`, never `title` + `body`.** The m2 plan's Task 2 body predates the encryption
  amendment and specifies two strings; the amendment wins. A single string lets a caller post an
  amount without ever learning it did.
- **`null` return = notification permission denied.** Never throws for it. The in-app surface still
  shows the event (limits r24, loans r15, bills r12); only the system notification is lost. Posting
  paths read the grant **without** prompting — a permission dialog raised from a background
  recompute lands in front of a user who is not looking at the app.
- **`postAlert` checks `isKeyguardLocked()` per call**, never cached. `scheduleReminder` **always
  sends the locked variant and never checks at all** — the OS renders it days later with this
  process dead, so there is no post-time hook to check in. That is a platform limit, not an
  oversight; not calling it is deliberate, so the answer cannot later be misused at schedule time.
- **Known residual, left open by the owner (2026-08-15):** `postAlert`'s check is right at the
  instant it posts, and the notification then stays in the shade. Unlocked when it arrives, phone
  locked a moment later, and the amount is on the lock screen. The only real fix is Android's
  `publicVersion`, which expo-notifications does not expose; channel-level `lockscreenVisibility =
  PRIVATE` renders "Contents hidden" for *both* variants and destroys the actionability §7a asks
  for. Revisit if the library gains `publicVersion`.
- **`trigger: null` is not usable.** `channelId` lives on the **trigger** in expo-notifications, so
  an immediate notification has nowhere to name a channel and lands on the app default at default
  importance — `CHANNEL_LIMITS` would exist, be visible in Android settings, and route nothing.
  Invisible in JS: the post succeeds and returns an id. Immediate alerts therefore use
  `{ type: TIME_INTERVAL, seconds: 1, channelId }`.
- **No `Platform` branch.** The app is Android-only in the strong sense (a
  `NotificationListenerService` has no iOS equivalent) and `Platform` appears nowhere else in
  `lib/`, `app/` or `components/`.
- `expo-notifications` is **not** registered in `app.json` `plugins` — it autolinks and merges its
  own `POST_NOTIFICATIONS` entry. Its plugin's real job is the Android notification icon and
  colour, and no monochrome asset exists yet; without one Android draws a white square.
