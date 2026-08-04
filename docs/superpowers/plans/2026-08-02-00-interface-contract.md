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
  `vitest run`), integration tests via `fastify.inject()`, Postgres via `server/docker-compose.yml`,
  schema via Prisma migrations. TDD per plan steps.
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

## 3. Mobile local database (expo-sqlite)

Owned by the **foundation plan**: `mobile/lib/db/` — `database.ts` (open + PRAGMA foreign_keys ON),
`migrations.ts` (numbered migration runner, `schema_migrations` table), `migrations/001_core.sql`
creates ALL tables below (full schema known from `docs/02-domain-model.md`; map camelCase fields
→ snake_case columns). Feature plans NEVER run DDL; they use repositories.

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
```

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
```

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
  | { kind: "ignored"; reason: "not_financial" | "duplicate" | "unknown_provider" | "paused" };

// parser.ts — rules come from the parser_rulesets table (seeded from bundled JSON, updatable from server)
export type ParsedEvent = {
  providerKey: string; amount: Centavos; direction: "in" | "out";
  merchant?: string; counterparty?: string; referenceNo?: string; balanceAfter?: Centavos;
  occurredAt: number; walletHint?: string; confidence: number; // 0..1
};
export function parseCapture(capture: RawCapture, rules: ProviderRuleset[]): ParsedEvent | null;
```

Ruleset JSON shape (bundled seed `mobile/assets/parser_rules/seed.json`; same shape served by
the server): `{ version: number, providers: [{ providerKey, packageNames: string[], version,
templates: [{ id, match: string /* regex, named groups: amount, direction?, merchant?,
counterparty?, ref?, balance? */, direction?: "in"|"out", confidence: number }] }] }`.

## 6. Server — Fastify + Prisma + Postgres

`server/src/` layout: `app.ts` (buildApp(): FastifyInstance — no listen), `server.ts` (entry),
`routes/<domain>_routes.ts`, `services/<domain>_service.ts`, `plugins/` (prisma, auth),
`lib/` (jwt, otp, hashing). `server/prisma/schema.prisma` — models with `@@map`/`@map` snake_case.
Tests in `server/test/` mirroring `routes/` + `services/`.

Prisma models (tables): `users`, `otp_requests`, `refresh_tokens`, `parser_rulesets`,
`telemetry_parse_stats`, `backup_vaults`, `entitlements`.

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
| `GET /v1/entitlements` | Bearer | → `{ tier: "free" \| "plus", source: "stub" }` (stub returns `"free"`) |

Auth: JWT access (15 min) + rotating refresh (30 d) per STACK_BASIS §8 semantics (server side).
Errors: `{ error: { code: string, message: string } }` with proper status. Env via typed
`server/src/config.ts` (`DATABASE_URL`, `JWT_SECRET`, `PORT`); `.env.example` committed —
**never a real `.env`**.

Mobile calls today: `GET /v1/parser_rules`, `POST /v1/telemetry/parse_stats` only. Auth, vault,
entitlements: built + fully tested server-side, mobile wiring deferred (local-first MVP, no login).

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
