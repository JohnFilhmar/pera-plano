# PeraPlano Server Functional Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ### AMENDED 2026-08-31: the API lives at `server/apps/api`, not `server/`
>
> This plan was written on 2026-08-02, before `server/` became an npm-workspaces monorepo for the
> now-shipped `@peraplano/web`. Its original Task 1 created `server/package.json`,
> `server/tsconfig.json`, `server/vitest.config.ts` and `server/docker-compose.yml`. **Three of
> those files now exist and belong to the web workspace. Creating them as written overwrites the
> deployed site.**
>
> Global find-and-replace for every task below, including ones this amendment does not quote:
>
> | Written as | Read as |
> |---|---|
> | `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts` | `server/apps/api/…` (the `server/` root files are the web workspace's, never touched) |
> | `server/src/…` | `server/apps/api/src/…` |
> | `server/test/…` | `server/apps/api/test/…` |
> | `server/prisma/…` | `server/apps/api/prisma/…` |
> | `server/docker-compose.yml` | a `postgres` service added to the **root** `docker-compose.yml` |
> | "run from `server/`" | run from `server/apps/api/` |
>
> Toolchain follows the existing workspace, not this plan's 2026-08-02 draft: **Node `>=22`**
> (not 20.19) and **vitest 4** (not 3). Authority: `docs/DEPLOYMENT.md`, *"There is no backend API
> service in this repo yet. Extend it, don't replace it, once `apps/api` exists."*

**Goal:** Build the `server/apps/api` workspace: a Fastify + Prisma + Postgres API with OTP email auth, rotating refresh tokens with reuse detection, versioned parser-ruleset distribution, aggregate-only telemetry with per-IP rate limiting, an opaque encrypted backup vault, and entitlements, fully test-driven with vitest.

**Architecture:** A side-effect-free `buildApp()` assembles the Fastify instance (plugins, routes, shared error handler — no `listen`); `server.ts` is the only entry point that listens. Prisma maps camelCase models onto snake_case Postgres tables; route handlers stay thin over `services/` (DB workflows) and `lib/` (pure crypto/token helpers). Every non-2xx response uses one envelope: `{ error: { code, message } }`. All integration tests run through `fastify.inject()` against the real dockerized Postgres.

**Tech Stack:** Node.js ≥ 22, TypeScript strict (NodeNext ESM), Fastify 5, `@fastify/rate-limit`, `fastify-plugin`, Prisma 6 + PostgreSQL 16 (root docker compose), vitest 4, tsx. JWTs are HS256, signed and verified with `node:crypto` directly, no external JWT dependency.

## Global Constraints

Every task's requirements implicitly include this section.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers (tables, columns). TypeScript symbols keep TS idioms: `camelCase` variables and functions, `PascalCase` components and types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** everywhere (DB, wire, logic); `type Centavos = number`. (The MVP server stores no amounts — the vault blob is opaque and telemetry is counts only — but any future amount field is integer centavos.)
- **Time:** epoch milliseconds (`number`) in code; `BIGINT` columns in Postgres. Prisma exposes `BIGINT` as JS `bigint` — convert with `Number(...)` before any JSON response and wrap with `BigInt(...)` on writes. A raw `bigint` must never reach `JSON.stringify` (it throws).
- **IDs:** UUIDv4 strings generated server-side via `crypto.randomUUID()`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). NO AI-attribution trailers or footers of any kind — no `Co-Authored-By`, no "Generated with" lines.
- **TDD:** every behavior lands test-first; each task cycles red → green → commit.
- **Test commands** (run from `server/apps/api/`): full suite `npm test` (= `vitest run`); single file `npx vitest run <path>`. From `server/`, the workspace form is `npm test -w @peraplano/api`.
- **Postgres** is the `postgres` service in the **root** `docker-compose.yml` (`npm run db:up` proxies to it). Do not add a second compose file under `server/`: the root file's header states that a compose file which has to move the first time the system grows is one everyone learns to distrust. Integration tests TRUNCATE all tables, so never point `DATABASE_URL` at data you care about. From Task 4 onward the whole suite needs Postgres up and migrated.
- **Never write to `server/` root.** `server/package.json`, `server/tsconfig.base.json`, `server/vitest.config.ts`, `server/eslint.config.mjs` and `server/Dockerfile` belong to the shipped web workspace. The API adds a workspace member and, in Task 1 only, one new Dockerfile target and one compose service. Everything else is created under `server/apps/api/`.
- **Secrets:** never commit a real `.env` — only `.env.example`. Never delete or overwrite an existing `.env`.
- **Error envelope** for every non-2xx response: `{ error: { code: string, message: string } }`.
- **Routes:** all under `/v1` prefix except `GET /health`.
- All shell commands below run from `d:\My Folder\pera-plano\server\apps\api` unless stated otherwise.
- The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is law: exact names, signatures, routes, tables, tokens. This plan conforms to it; do not rename anything it pins.

**File map (what this plan creates):**

```
server/                          MODIFIED, not created: one workspace member, one Dockerfile target
server/apps/api/
  package.json  tsconfig.json  vitest.config.ts  .env.example  .gitignore  README.md
  prisma/schema.prisma          prisma/migrations/           prisma/seed.ts  prisma/seed_data.ts
  src/config.ts  src/app.ts  src/server.ts
  src/lib/errors.ts  src/lib/hashing.ts  src/lib/otp.ts  src/lib/jwt.ts
  src/plugins/prisma_plugin.ts  src/plugins/auth_plugin.ts
  src/services/auth_service.ts
  src/routes/health_routes.ts   src/routes/auth_routes.ts   src/routes/parser_rules_routes.ts
  src/routes/telemetry_routes.ts  src/routes/backup_routes.ts  src/routes/entitlements_routes.ts
  test/setup.ts  test/config.test.ts  test/prisma_schema.test.ts  test/seed_data.test.ts
  test/helpers/db.ts  test/helpers/auth.ts
  test/lib/errors.test.ts  test/lib/otp.test.ts  test/lib/jwt.test.ts
  test/services/auth_service.test.ts
  test/plugins/prisma_plugin.test.ts  test/plugins/auth_plugin.test.ts
  test/routes/health_routes.test.ts  test/routes/auth_otp_routes.test.ts  test/routes/auth_refresh_routes.test.ts
  test/routes/parser_rules_routes.test.ts  test/routes/telemetry_routes.test.ts
  test/routes/backup_routes.test.ts  test/routes/entitlements_routes.test.ts
```

---

### Task 1: Project scaffold + typed config

**Files:**
- Create: `server/apps/api/package.json` (name `@peraplano/api`, picked up by the existing `apps/*` workspace glob, so `server/package.json` needs no edit)
- Create: `server/apps/api/tsconfig.json` (extends `../../tsconfig.base.json`)
- Create: `server/apps/api/vitest.config.ts`
- Create: `server/apps/api/.env.example`
- Create: `server/apps/api/.gitignore`
- Create: `server/apps/api/test/setup.ts`
- Create: `server/apps/api/src/config.ts`
- Test: `server/apps/api/test/config.test.ts`
- Create: `server/apps/api/tsconfig.eslint.json` (covers `src`, `test` and `vitest.config.ts`; the build `tsconfig.json` includes only `src`, so pointing the linter at it would leave the api's tests unlinted)
- Modify: root `docker-compose.yml` (add a `postgres` service under `profiles: ["api"]`, publishing no ports). **Not** port 5005: the file header reserves 5005 for the future API service, not for Postgres. The profile is required, not cosmetic: `deploy.yml` runs `docker compose ... up -d` with no service list, so an unprofiled service would start a development-credential database on staging and production.
- Modify: `docker-compose.override.yml` (local only: `5432:5432`)
- Modify: `server/Dockerfile` (add an `api` target beside the existing `web` target; `base`, `deps`, `build` and `runtime-base` are shared and unchanged. Note `deps` never installs the api's runtime dependencies, so the api target needs its own install stage rather than building on `build`)
- Modify: `server/eslint.config.mjs` (append `./apps/api/tsconfig.eslint.json` to the `project` array and add `**/dist/**` to `ignores`). This is the **only** permitted edit to a `server/` root file, and it is additive: it cannot change how any web file is linted. Without it every api file fails with `parserOptions.project` parsing errors and CI's `npm run lint` goes red.
- Modify: `.github/workflows/server-ci.yml` (add a Postgres service container plus explicit `npm run build -w @peraplano/api` and `npm test -w @peraplano/api` steps). **The root `npm test` does not cover the api.** The root `vitest.config.ts` includes `apps/web/**/__tests__/**` and `libs/**/__tests__/**`; the api's tests live in `test/`, so without its own step the suite never runs in CI. Likewise the root `typecheck` script names three tsconfigs explicitly and `apps/api` is not one of them, which is why the api's `build` step doubles as its typecheck.

**Amendment note.** The three `Modify` entries land in this task's single commit together with the
`apps/api` scaffold. Do not add an `api` Dockerfile target or compose service in a commit where
`server/apps/api` does not yet exist: the image build would fail and take the web deploy with it.

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `type AppConfig = { databaseUrl: string; jwtSecret: string; port: number; telemetryRateLimitMax: number }` and `loadConfig(env?: NodeJS.ProcessEnv): AppConfig` from `src/config.ts` (used by Tasks 3, 4, 12); npm scripts `test`, `dev`, `build`, `start`, `db:up`, `db:down`, `db:migrate`, `db:deploy`, `db:generate`, `db:seed`.

- [ ] **Step 1: Create the scaffold files**

`server/apps/api/package.json`:

```json
{
  "name": "@peraplano/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:up": "docker compose -f ../../../docker-compose.yml -f ../../../docker-compose.override.yml --profile api up -d postgres",
    "db:down": "docker compose -f ../../../docker-compose.yml -f ../../../docker-compose.override.yml --profile api stop postgres",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:generate": "prisma generate",
    "db:seed": "tsx prisma/seed.ts"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@fastify/rate-limit": "^10.2.2",
    "@prisma/client": "^6.8.2",
    "fastify": "^5.3.2",
    "fastify-plugin": "^5.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "prisma": "^6.8.2",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^4.1.11"
  }
}
```

`server/apps/api/tsconfig.json` (the `extends` is what keeps one compiler config for the repo; do
not restate options the base already sets):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`"noEmit": false` is not optional. `server/tsconfig.base.json` sets `"noEmit": true` for the Next.js
app, so without the override `npm run build` succeeds while emitting nothing, and the Docker `api`
target ships an empty `dist/`. A build that produces no output and reports success is worse than one
that fails.

Both `-f` files are required in `db:up`: an explicit `-f` suppresses auto-loading of the override,
and the base file publishes no ports, so a single `-f` leaves `localhost:5432` unreachable and every
integration test from Task 4 onward fails to connect.

Note: `"type": "module"` + NodeNext means every relative import in `src/` and `test/` uses the `.js` extension (e.g. `import { loadConfig } from "./config.js"`), even though the file on disk is `.ts`. vitest and tsx both resolve this correctly.

`server/apps/api/vitest.config.ts` (the root `server/vitest.config.ts` is the web workspace's and stays untouched):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false,
    testTimeout: 15000,
  },
});
```

`fileParallelism: false` is required: integration tests share one Postgres database and truncate tables between tests; parallel test files would corrupt each other.

Root `docker-compose.yml`, **appended to the existing `services:` block beside `peraplano-web`**.
Do not create `server/docker-compose.yml`, and do not rewrite the file's header comment or its
`name: peraplano` line:

```yaml
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: peraplano
      POSTGRES_PASSWORD: peraplano
      POSTGRES_DB: peraplano
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U peraplano"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

volumes:
  postgres_data:
```

The base file deliberately publishes no ports, so the `5432` mapping belongs in
`docker-compose.override.yml` (local only) and never in the staging or production overlay. Nothing
outside the compose network should reach Postgres. Likewise `container_name` is omitted: the root
file pins `name: peraplano`, which already makes container names stable across clones, and a
hardcoded `container_name` would collide with the other stacks sharing this box.

`server/apps/api/.env.example` (this is the committed template; NEVER commit a real `.env`):

```
DATABASE_URL=postgresql://peraplano:peraplano@localhost:5432/peraplano
JWT_SECRET=change_me_generate_a_long_random_string
PORT=3000
TELEMETRY_RATE_LIMIT_MAX=60
```

`server/apps/api/.gitignore`:

```
node_modules/
dist/
.env
.env.*
!.env.example
*.log
```

`server/apps/api/test/setup.ts` (vitest setup file, provides env defaults so tests run without a `.env`):

```ts
process.env.DATABASE_URL ??=
  "postgresql://peraplano:peraplano@localhost:5432/peraplano";
process.env.JWT_SECRET ??= "test_jwt_secret_do_not_use_in_prod";
process.env.LOG_LEVEL ??= "silent";
```

- [ ] **Step 2: Install dependencies**

Run `npm install` from `server/` (the workspace root), not from `apps/api`. npm workspaces hoist to
one `node_modules` and one `package-lock.json` at `server/`; installing inside `apps/api` creates a
nested tree that CI will not reproduce.
Expected: completes without errors; `server/package-lock.json` gains the api workspace's deps.

- [ ] **Step 3: Write the failing config test**

`server/apps/api/test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const VALID_ENV = {
  DATABASE_URL: "postgresql://peraplano:peraplano@localhost:5432/peraplano",
  JWT_SECRET: "secret",
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("loads required variables and applies defaults", () => {
    const config = loadConfig(VALID_ENV);
    expect(config).toEqual({
      databaseUrl: "postgresql://peraplano:peraplano@localhost:5432/peraplano",
      jwtSecret: "secret",
      port: 3000,
      telemetryRateLimitMax: 60,
    });
  });

  it("parses PORT and TELEMETRY_RATE_LIMIT_MAX when provided", () => {
    const config = loadConfig({
      ...VALID_ENV,
      PORT: "8080",
      TELEMETRY_RATE_LIMIT_MAX: "5",
    } as NodeJS.ProcessEnv);
    expect(config.port).toBe(8080);
    expect(config.telemetryRateLimitMax).toBe(5);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig({ JWT_SECRET: "s" } as NodeJS.ProcessEnv)).toThrow(
      "DATABASE_URL",
    );
  });

  it("throws when JWT_SECRET is missing", () => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://x" } as NodeJS.ProcessEnv),
    ).toThrow("JWT_SECRET");
  });

  it("throws on a non-numeric PORT", () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, PORT: "not-a-port" } as NodeJS.ProcessEnv),
    ).toThrow("PORT");
  });

  it("throws on a non-numeric TELEMETRY_RATE_LIMIT_MAX", () => {
    expect(() =>
      loadConfig({
        ...VALID_ENV,
        TELEMETRY_RATE_LIMIT_MAX: "lots",
      } as NodeJS.ProcessEnv),
    ).toThrow("TELEMETRY_RATE_LIMIT_MAX");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — vitest cannot resolve `../src/config.js` ("Failed to load url" / "Cannot find module").

- [ ] **Step 5: Implement `src/config.ts`**

```ts
export type AppConfig = {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  telemetryRateLimitMax: number;
};

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  const telemetryRateLimitMax =
    env.TELEMETRY_RATE_LIMIT_MAX === undefined
      ? 60
      : Number(env.TELEMETRY_RATE_LIMIT_MAX);
  if (!Number.isInteger(telemetryRateLimitMax) || telemetryRateLimitMax < 1) {
    throw new Error(
      `Invalid TELEMETRY_RATE_LIMIT_MAX: ${env.TELEMETRY_RATE_LIMIT_MAX}`,
    );
  }
  return { databaseUrl, jwtSecret, port, telemetryRateLimitMax };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 7: Commit**

Paths are repo-root relative, so run this from the repo root, not from `apps/api`. The scaffold, the
Dockerfile target, the compose service and the CI change land in **one** commit, so no intermediate
state builds an `api` image against a directory that does not exist:

```bash
git add server/apps/api server/package-lock.json server/Dockerfile docker-compose.yml docker-compose.override.yml .github/workflows/server-ci.yml
git commit -m "feat(api): scaffold the api workspace with typed env config"
```

---

### Task 2: Prisma schema — all 7 models + initial migration

**Files:**
- Create: `server/apps/api/prisma/schema.prisma`
- Create: `server/apps/api/prisma/migrations/<timestamp>_init/migration.sql` (generated by `prisma migrate dev`)
- Test: `server/apps/api/test/prisma_schema.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` from the environment (defaults provided by `test/setup.ts` from Task 1).
- Produces: Prisma client models with these client property names and fields (all later DB tasks rely on these exact names):
  - `prisma.user` → `{ id: string; destination: string; createdAt: bigint }`
  - `prisma.otpRequest` → `{ id; destination; codeHash; expiresAt: bigint; attempts: number; consumedAt: bigint | null; createdAt: bigint }`
  - `prisma.refreshToken` → `{ id; userId; familyId; tokenHash; expiresAt: bigint; revokedAt: bigint | null; createdAt: bigint }`
  - `prisma.parserRuleset` → `{ id; version: number; rulesJson: Prisma.JsonValue; createdAt: bigint }`
  - `prisma.telemetryParseStat` → `{ id; appVersion; rulesetVersion: number; providerKey; parsed: number; failed: number; periodStart: bigint; periodEnd: bigint; receivedAt: bigint }`
  - `prisma.backupVault` → `{ id; userId (unique); schemaVersion: number; deviceId; blob: string; storedAt: bigint }`
  - `prisma.entitlement` → `{ id; userId (unique); tier: string; source: string; updatedAt: bigint }`

- [ ] **Step 1: Start Postgres**

Run: `npm run db:up`
Expected: container `peraplano-postgres-1` starts and reports healthy within ~15 s. The service sets
no `container_name`, so Compose derives the name from project plus service plus index. Do not grep
for `peraplano_postgres`; no such container exists.

**Every Prisma CLI invocation needs `DATABASE_URL` in its environment.** `test/setup.ts` defaults it
for vitest only, and there is no committed `.env`, so a bare `npx prisma generate` or
`npx prisma migrate dev` fails to resolve `env("DATABASE_URL")` in the datasource block. Prefix the
command, for example
`DATABASE_URL="postgresql://peraplano:peraplano@localhost:5432/peraplano" npm run db:migrate`.
This applies to `generate` too, which reads the datasource even though it touches no database.

**Imports in every test block below:** the server's eslint config sets `no-unused-vars` to `error`
with only an underscore-prefix escape, so copying an import line that names a hook the test does not
call turns `npm run lint` red. Import only the hooks the file actually uses.

**`async` without `await` is a lint error too.** The config runs
`@typescript-eslint/recommendedTypeChecked`, which sets `require-await` to error. Several code blocks
below mark a route handler or plugin `async` when its body never awaits. Drop the `async` as you
copy: a Fastify handler that just returns a value can be synchronous, and a plugin needing the
`Promise<void>` shape can `return Promise.resolve()`. Handlers that genuinely await Prisma stay
`async` and are fine.

**Asserting errors:** `ApiError.message` is the human sentence and `.code` is the machine value, so
`expect(fn).toThrow("some_code")` matches the wrong field. Assert `.code` explicitly, or use
`rejects.toMatchObject({ code })` for async.

- [ ] **Step 2: Create a models-free schema and generate the client**

`server/apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Run: `npx prisma generate`
Expected: "Generated Prisma Client" — the client now exists but has no models.

- [ ] **Step 3: Write the failing schema test**

`server/apps/api/test/prisma_schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("prisma schema", () => {
  it("creates all 7 snake_case tables", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "backup_vaults",
      "entitlements",
      "otp_requests",
      "parser_rulesets",
      "refresh_tokens",
      "telemetry_parse_stats",
      "users",
    ]);
  });

  it("maps camelCase model fields onto snake_case columns", async () => {
    const id = randomUUID();
    const destination = `${id}@example.com`;
    const createdAt = BigInt(Date.now());
    await prisma.user.create({ data: { id, destination, createdAt } });
    const found = await prisma.user.findUnique({ where: { destination } });
    expect(found?.id).toBe(id);
    expect(found?.createdAt).toBe(createdAt);
    // prove the physical column names are snake_case
    const raw = await prisma.$queryRawUnsafe<Array<{ created_at: bigint }>>(
      `SELECT created_at FROM users WHERE id = '${id}'`,
    );
    expect(raw[0]?.created_at).toBe(createdAt);
    await prisma.user.delete({ where: { id } });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run test/prisma_schema.test.ts`
Expected: FAIL — first test gets an empty table list; second throws `TypeError: Cannot read properties of undefined (reading 'create')` because `prisma.user` does not exist yet.

- [ ] **Step 5: Add the 7 models to `schema.prisma`**

Append to `server/apps/api/prisma/schema.prisma` (below the datasource block):

```prisma
model User {
  id          String  @id
  destination String  @unique
  createdAt   BigInt  @map("created_at")

  refreshTokens RefreshToken[]
  backupVault   BackupVault?
  entitlement   Entitlement?

  @@map("users")
}

model OtpRequest {
  id          String  @id
  destination String
  codeHash    String  @map("code_hash")
  expiresAt   BigInt  @map("expires_at")
  attempts    Int     @default(0)
  consumedAt  BigInt? @map("consumed_at")
  createdAt   BigInt  @map("created_at")

  @@map("otp_requests")
}

model RefreshToken {
  id        String  @id
  userId    String  @map("user_id")
  familyId  String  @map("family_id")
  tokenHash String  @unique @map("token_hash")
  expiresAt BigInt  @map("expires_at")
  revokedAt BigInt? @map("revoked_at")
  createdAt BigInt  @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@index([familyId])
  @@map("refresh_tokens")
}

model ParserRuleset {
  id        String @id
  version   Int    @unique
  rulesJson Json   @map("rules_json")
  createdAt BigInt @map("created_at")

  @@map("parser_rulesets")
}

model TelemetryParseStat {
  id             String @id
  appVersion     String @map("app_version")
  rulesetVersion Int    @map("ruleset_version")
  providerKey    String @map("provider_key")
  parsed         Int
  failed         Int
  periodStart    BigInt @map("period_start")
  periodEnd      BigInt @map("period_end")
  receivedAt     BigInt @map("received_at")

  @@map("telemetry_parse_stats")
}

model BackupVault {
  id            String @id
  userId        String @unique @map("user_id")
  schemaVersion Int    @map("schema_version")
  deviceId      String @map("device_id")
  blob          String
  storedAt      BigInt @map("stored_at")

  user User @relation(fields: [userId], references: [id])

  @@map("backup_vaults")
}

model Entitlement {
  id        String @id
  userId    String @unique @map("user_id")
  tier      String
  source    String
  updatedAt BigInt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@map("entitlements")
}
```

- [ ] **Step 6: Create the initial migration (also regenerates the client)**

Run: `npx prisma migrate dev --name init`
Expected: migration `prisma/migrations/<timestamp>_init/migration.sql` created and applied; "Generated Prisma Client" printed.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run test/prisma_schema.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations test/prisma_schema.test.ts
git commit -m "feat(server): prisma schema with 7 snake_case models and init migration"
```

---

### Task 3: buildApp() + server entry + shared error envelope + health route

**Files:**
- Create: `server/apps/api/src/lib/errors.ts`
- Create: `server/apps/api/src/routes/health_routes.ts`
- Create: `server/apps/api/src/app.ts`
- Create: `server/apps/api/src/server.ts`
- Test: `server/apps/api/test/routes/health_routes.test.ts`
- Test: `server/apps/api/test/lib/errors.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `AppConfig` from `src/config.ts` (Task 1).
- Produces:
  - `buildApp(overrides?: Partial<AppConfig>): FastifyInstance` from `src/app.ts` — registers plugins/routes, never listens. Every integration test in later tasks calls this.
  - `class ApiError extends Error { constructor(statusCode: number, code: string, message: string) }` and `errorHandler(error, request, reply): void` from `src/lib/errors.ts` — every route task throws `ApiError` for domain failures.
  - `app.config: AppConfig` decoration (module augmentation lives in `app.ts`).
  - Error codes used across the whole server: `validation_error` (400), `unauthorized` (401), `invalid_code` (401), `otp_expired` (401), `invalid_token` (401), `token_reuse_detected` (401), `not_found` (404), `otp_not_found` (404), `too_many_attempts` (429), `rate_limited` (429), `internal_error` (500).

- [ ] **Step 1: Write the failing health-route test**

`server/apps/api/test/routes/health_routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("returns status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("unknown routes", () => {
  it("return a 404 error envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "not_found", message: "Route GET /nope not found" },
    });
  });
});
```

- [ ] **Step 2: Write the failing error-handler test**

`server/apps/api/test/lib/errors.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { ApiError } from "../../src/lib/errors.js";

const app = buildApp();

beforeAll(async () => {
  await app.register(async (instance) => {
    instance.get("/boom_api_error", async () => {
      throw new ApiError(418, "teapot", "I am a teapot");
    });
    instance.get("/boom_unexpected", async () => {
      throw new Error("secret internal detail");
    });
    instance.post(
      "/boom_validation",
      {
        schema: {
          body: {
            type: "object",
            required: ["mustHave"],
            properties: { mustHave: { type: "string" } },
          },
        },
      },
      async () => ({ ok: true }),
    );
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("shared error handler", () => {
  it("maps ApiError to its status and envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/boom_api_error" });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({
      error: { code: "teapot", message: "I am a teapot" },
    });
  });

  it("maps schema validation failures to a 400 validation_error envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/boom_validation",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("mustHave");
  });

  it("maps unexpected errors to a 500 internal_error envelope without leaking details", async () => {
    const res = await app.inject({ method: "GET", url: "/boom_unexpected" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    });
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run test/routes/health_routes.test.ts test/lib/errors.test.ts`
Expected: FAIL — vitest cannot resolve `../../src/app.js`.

- [ ] **Step 4: Implement `src/lib/errors.ts`**

```ts
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ApiError) {
    void reply
      .status(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error.validation) {
    void reply
      .status(400)
      .send({ error: { code: "validation_error", message: error.message } });
    return;
  }
  if (error.statusCode === 429) {
    void reply.status(429).send({
      error: { code: "rate_limited", message: "Rate limit exceeded" },
    });
    return;
  }
  request.log.error(error);
  void reply.status(500).send({
    error: { code: "internal_error", message: "Internal server error" },
  });
}
```

- [ ] **Step 5: Implement `src/routes/health_routes.ts`**

```ts
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
}
```

- [ ] **Step 6: Implement `src/app.ts` and `src/server.ts`**

`server/apps/api/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "./config.js";
import { errorHandler } from "./lib/errors.js";
import { healthRoutes } from "./routes/health_routes.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export function buildApp(
  overrides: Partial<AppConfig> = {},
): FastifyInstance {
  const config: AppConfig = { ...loadConfig(), ...overrides };
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });
  app.decorate("config", config);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: "not_found",
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });
  void app.register(healthRoutes);
  return app;
}
```

`server/apps/api/src/server.ts`:

```ts
import { buildApp } from "./app.js";

const app = buildApp();

app
  .listen({ port: app.config.port, host: "0.0.0.0" })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/routes/health_routes.test.ts test/lib/errors.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 8: Smoke-check the dev entry**

Run (Git Bash, one terminal): `DATABASE_URL=postgresql://peraplano:peraplano@localhost:5432/peraplano JWT_SECRET=dev PORT=3999 npx tsx src/server.ts` — then in a second terminal run `curl -s http://localhost:3999/health` and stop the server with Ctrl-C.
Expected: `{"status":"ok"}`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/errors.ts src/routes/health_routes.ts src/app.ts src/server.ts test/routes/health_routes.test.ts test/lib/errors.test.ts
git commit -m "feat(server): buildApp with shared error envelope and health route"
```

---

### Task 4: Prisma plugin

**Files:**
- Create: `server/apps/api/src/plugins/prisma_plugin.ts`
- Modify: `server/apps/api/src/app.ts` (register the plugin)
- Test: `server/apps/api/test/plugins/prisma_plugin.test.ts`

**Interfaces:**
- Consumes: `buildApp` (Task 3), `app.config.databaseUrl` (Tasks 1/3), Prisma client models (Task 2).
- Produces: `prismaPlugin` and the `app.prisma: PrismaClient` decoration (module augmentation in the plugin file). Every DB-touching route/service task uses `app.prisma`.

- [ ] **Step 1: Write the failing test**

`server/apps/api/test/plugins/prisma_plugin.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("prisma plugin", () => {
  it("decorates the app with a connected PrismaClient", async () => {
    const count = await app.prisma.user.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("disconnects cleanly on close", async () => {
    const scratch = buildApp();
    await scratch.ready();
    await expect(scratch.close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/plugins/prisma_plugin.test.ts`
Expected: FAIL — `app.prisma` is undefined (`Cannot read properties of undefined (reading 'count')`).

- [ ] **Step 3: Implement `src/plugins/prisma_plugin.ts`**

```ts
import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin = fp(async (app: FastifyInstance) => {
  const prisma = new PrismaClient({
    datasourceUrl: app.config.databaseUrl,
  });
  await prisma.$connect();
  app.decorate("prisma", prisma);
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 4: Modify `src/app.ts` to register the plugin**

Add to the imports in `server/apps/api/src/app.ts`:

```ts
import { prismaPlugin } from "./plugins/prisma_plugin.js";
```

Add this line directly ABOVE `void app.register(healthRoutes);`:

```ts
  void app.register(prismaPlugin);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/plugins/prisma_plugin.test.ts`
Expected: PASS — 2 tests green. (Requires `npm run db:up` and the Task 2 migration applied.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — config, schema, health, errors, prisma plugin all green.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/prisma_plugin.ts src/app.ts test/plugins/prisma_plugin.test.ts
git commit -m "feat(server): prisma plugin decorating app with connected client"
```

---

### Task 5: Hashing + OTP library (pure, unit-tested)

**Files:**
- Create: `server/apps/api/src/lib/hashing.ts`
- Create: `server/apps/api/src/lib/otp.ts`
- Test: `server/apps/api/test/lib/otp.test.ts`

**Interfaces:**
- Consumes: nothing beyond `node:crypto`.
- Produces (used by Tasks 7, 8, 9, 13):
  - `sha256Hex(input: string): string` from `src/lib/hashing.ts`.
  - From `src/lib/otp.ts`: `OTP_TTL_MS = 600_000` (10 min), `OTP_MAX_ATTEMPTS = 5`, `OTP_CODE_LENGTH = 6`, `generateOtpCode(): string` (6 decimal digits, crypto-random), `hashOtpCode(requestId: string, code: string): string` (sha256 of `requestId + ":" + code` — the requestId acts as the salt so identical codes across requests hash differently), `isOtpExpired(expiresAt: number, nowMs: number): boolean`.

- [ ] **Step 1: Write the failing tests**

`server/apps/api/test/lib/otp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sha256Hex } from "../../src/lib/hashing.js";
import {
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_CODE_LENGTH,
  generateOtpCode,
  hashOtpCode,
  isOtpExpired,
} from "../../src/lib/otp.js";

describe("sha256Hex", () => {
  it("hashes deterministically to the known sha256 of 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("generateOtpCode", () => {
  it("always returns a 6-digit numeric string", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("hashOtpCode", () => {
  it("is deterministic for the same requestId and code", () => {
    expect(hashOtpCode("req-1", "123456")).toBe(hashOtpCode("req-1", "123456"));
  });

  it("differs across requestIds — requestId acts as salt", () => {
    expect(hashOtpCode("req-1", "123456")).not.toBe(
      hashOtpCode("req-2", "123456"),
    );
  });

  it("is a 64-char hex digest that never contains the raw code", () => {
    const hash = hashOtpCode("req-1", "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
  });
});

describe("isOtpExpired", () => {
  it("is not expired strictly before the deadline", () => {
    expect(isOtpExpired(1_000_000, 999_999)).toBe(false);
  });

  it("is expired at and after the deadline", () => {
    expect(isOtpExpired(1_000_000, 1_000_000)).toBe(true);
    expect(isOtpExpired(1_000_000, 1_000_001)).toBe(true);
  });
});

describe("constants", () => {
  it("pins TTL to 10 minutes, attempts to 5, length to 6", () => {
    expect(OTP_TTL_MS).toBe(600_000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_CODE_LENGTH).toBe(6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/otp.test.ts`
Expected: FAIL — vitest cannot resolve `../../src/lib/hashing.js`.

- [ ] **Step 3: Implement `src/lib/hashing.ts` and `src/lib/otp.ts`**

`server/apps/api/src/lib/hashing.ts`:

```ts
import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
```

`server/apps/api/src/lib/otp.ts`:

```ts
import { randomInt } from "node:crypto";
import { sha256Hex } from "./hashing.js";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_CODE_LENGTH = 6;

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(OTP_CODE_LENGTH, "0");
}

export function hashOtpCode(requestId: string, code: string): string {
  return sha256Hex(`${requestId}:${code}`);
}

export function isOtpExpired(expiresAt: number, nowMs: number): boolean {
  return nowMs >= expiresAt;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/otp.test.ts`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hashing.ts src/lib/otp.ts test/lib/otp.test.ts
git commit -m "feat(server): otp code generation, salted hashing, and expiry helpers"
```

---

### Task 6: JWT library — HS256 access tokens + opaque refresh tokens (pure, unit-tested)

**Files:**
- Create: `server/apps/api/src/lib/jwt.ts`
- Test: `server/apps/api/test/lib/jwt.test.ts`

**Interfaces:**
- Consumes: nothing beyond `node:crypto`.
- Produces (used by Tasks 8, 9, 10, 13):
  - `ACCESS_TOKEN_TTL_MS = 900_000` (15 min) and `REFRESH_TOKEN_TTL_MS = 2_592_000_000` (30 days).
  - `type AccessTokenClaims = { sub: string; iat: number; exp: number }` (`iat`/`exp` are epoch SECONDS per JWT convention; everything else in this codebase is epoch ms).
  - `signAccessToken(userId: string, secret: string, nowMs?: number): string` — HS256 JWT, `exp = now + 15 min`.
  - `verifyAccessToken(token: string, secret: string, nowMs?: number): AccessTokenClaims | null` — returns `null` for bad signature, malformed token, or expiry (never throws).
  - `generateRefreshToken(): string` — 32 crypto-random bytes, base64url (43 chars). Opaque: refresh tokens are NOT JWTs; only their sha256 is stored (Task 8).

- [ ] **Step 1: Write the failing tests**

`server/apps/api/test/lib/jwt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
} from "../../src/lib/jwt.js";

const SECRET = "unit_test_secret";
const NOW = 1_754_000_000_000;

describe("signAccessToken / verifyAccessToken", () => {
  it("round-trips a userId", () => {
    const token = signAccessToken("user-1", SECRET, NOW);
    const claims = verifyAccessToken(token, SECRET, NOW + 1000);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("user-1");
  });

  it("sets exp exactly 15 minutes after issue", () => {
    const token = signAccessToken("user-1", SECRET, NOW);
    const claims = verifyAccessToken(token, SECRET, NOW);
    expect(ACCESS_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    expect(claims?.exp).toBe(Math.floor((NOW + ACCESS_TOKEN_TTL_MS) / 1000));
    expect(claims?.iat).toBe(Math.floor(NOW / 1000));
  });

  it("rejects a token at and after expiry", () => {
    const token = signAccessToken("user-1", SECRET, NOW);
    expect(verifyAccessToken(token, SECRET, NOW + ACCESS_TOKEN_TTL_MS)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signAccessToken("user-1", "other_secret", NOW);
    expect(verifyAccessToken(token, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signAccessToken("user-1", SECRET, NOW);
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "attacker", iat: 0, exp: 99_999_999_999 }),
    ).toString("base64url");
    expect(
      verifyAccessToken(`${header}.${forgedPayload}.${signature}`, SECRET, NOW),
    ).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    expect(verifyAccessToken("not.a.jwt", SECRET, NOW)).toBeNull();
    expect(verifyAccessToken("nope", SECRET, NOW)).toBeNull();
    expect(verifyAccessToken("", SECRET, NOW)).toBeNull();
  });
});

describe("generateRefreshToken", () => {
  it("returns unique, url-safe, 43-char opaque tokens", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("pins the refresh TTL to 30 days", () => {
    expect(REFRESH_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/jwt.test.ts`
Expected: FAIL — vitest cannot resolve `../../src/lib/jwt.js`.

- [ ] **Step 3: Implement `src/lib/jwt.ts`**

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AccessTokenClaims = { sub: string; iat: number; exp: number };

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signAccessToken(
  userId: string,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(nowMs / 1000);
  const exp = Math.floor((nowMs + ACCESS_TOKEN_TTL_MS) / 1000);
  const payload = base64UrlEncode(JSON.stringify({ sub: userId, iat, exp }));
  const signature = hmacSign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const expected = hmacSign(`${header}.${payload}`, secret);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    signatureBuf.length !== expectedBuf.length ||
    !timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    return null;
  }
  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AccessTokenClaims;
  } catch {
    return null;
  }
  if (typeof claims.sub !== "string" || typeof claims.exp !== "number") {
    return null;
  }
  if (Math.floor(nowMs / 1000) >= claims.exp) return null;
  return claims;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/jwt.test.ts`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jwt.ts test/lib/jwt.test.ts
git commit -m "feat(server): hs256 access tokens and opaque refresh token generator"
```

---

### Task 7: OTP request — service, route, dev-log delivery

**Files:**
- Create: `server/apps/api/src/services/auth_service.ts`
- Create: `server/apps/api/src/routes/auth_routes.ts`
- Create: `server/apps/api/test/helpers/db.ts`
- Modify: `server/apps/api/src/app.ts` (register `authRoutes` under `/v1`)
- Test: `server/apps/api/test/routes/auth_otp_routes.test.ts`

**Interfaces:**
- Consumes: `app.prisma` (Task 4), `ApiError` (Task 3), `OTP_TTL_MS` / `generateOtpCode` / `hashOtpCode` (Task 5).
- Produces:
  - `requestOtp(prisma: PrismaClient, destination: string, nowMs?: number): Promise<{ requestId: string; code: string }>` from `src/services/auth_service.ts` — Tasks 8/9 tests call it directly to obtain the plaintext code (the route never returns the code).
  - Route `POST /v1/auth/otp/request` — body `{ channel: "email", destination }` → `{ requestId }`. Delivery is dev-only: the code is written to the server log, never to the response.
  - `resetDb(prisma: PrismaClient): Promise<void>` from `test/helpers/db.ts` — truncates all 7 tables; every DB integration test file uses it in `beforeEach`.

- [ ] **Step 1: Create the test DB helper**

`server/apps/api/test/helpers/db.ts`:

```ts
import type { PrismaClient } from "@prisma/client";

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "otp_requests", "refresh_tokens", "parser_rulesets", "telemetry_parse_stats", "backup_vaults", "entitlements" CASCADE',
  );
}
```

- [ ] **Step 2: Write the failing tests**

`server/apps/api/test/routes/auth_otp_routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { OTP_TTL_MS } from "../../src/lib/otp.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
});

describe("POST /v1/auth/otp/request", () => {
  it("returns a requestId and stores a hashed, expiring OTP", async () => {
    const before = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "email", destination: "juan@example.com" },
    });
    expect(res.statusCode).toBe(200);
    const { requestId } = res.json() as { requestId: string };
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const row = await app.prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(row).not.toBeNull();
    expect(row?.destination).toBe("juan@example.com");
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/); // hashed — plaintext never stored
    expect(row?.attempts).toBe(0);
    expect(row?.consumedAt).toBeNull();
    expect(Number(row?.expiresAt)).toBeGreaterThanOrEqual(before + OTP_TTL_MS);
    expect(Number(row?.expiresAt)).toBeLessThanOrEqual(Date.now() + OTP_TTL_MS);
  });

  it("rejects a non-email channel with a validation_error envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "sms", destination: "juan@example.com" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
  });

  it("rejects a malformed destination", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "email", destination: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
  });

  it("rejects a missing body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/routes/auth_otp_routes.test.ts`
Expected: FAIL — route not registered: 404 status where 200/400 expected.

- [ ] **Step 4: Implement `src/services/auth_service.ts` (requestOtp only for now)**

```ts
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { OTP_TTL_MS, generateOtpCode, hashOtpCode } from "../lib/otp.js";

export async function requestOtp(
  prisma: PrismaClient,
  destination: string,
  nowMs: number = Date.now(),
): Promise<{ requestId: string; code: string }> {
  const requestId = randomUUID();
  const code = generateOtpCode();
  await prisma.otpRequest.create({
    data: {
      id: requestId,
      destination,
      codeHash: hashOtpCode(requestId, code),
      expiresAt: BigInt(nowMs + OTP_TTL_MS),
      attempts: 0,
      createdAt: BigInt(nowMs),
    },
  });
  return { requestId, code };
}
```

- [ ] **Step 5: Implement `src/routes/auth_routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { requestOtp } from "../services/auth_service.js";

const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/auth/otp/request",
    {
      schema: {
        body: {
          type: "object",
          required: ["channel", "destination"],
          additionalProperties: false,
          properties: {
            channel: { type: "string", enum: ["email"] },
            destination: { type: "string", pattern: EMAIL_PATTERN },
          },
        },
      },
    },
    async (request) => {
      const { destination } = request.body as {
        channel: "email";
        destination: string;
      };
      const { requestId, code } = await requestOtp(app.prisma, destination);
      // Dev-only delivery channel: the OTP goes to the log, never the response.
      // Replace with a real mail provider before production traffic.
      request.log.info(
        { requestId, destination, otpCode: code },
        "otp issued (dev delivery)",
      );
      return { requestId };
    },
  );
}
```

- [ ] **Step 6: Modify `src/app.ts` to register auth routes**

Add to the imports in `server/apps/api/src/app.ts`:

```ts
import { authRoutes } from "./routes/auth_routes.js";
```

Add this line directly BELOW `void app.register(healthRoutes);`:

```ts
  void app.register(authRoutes, { prefix: "/v1" });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/routes/auth_otp_routes.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 8: Commit**

```bash
git add src/services/auth_service.ts src/routes/auth_routes.ts src/app.ts test/helpers/db.ts test/routes/auth_otp_routes.test.ts
git commit -m "feat(server): otp request route with hashed codes and dev-log delivery"
```

---

### Task 8: OTP verify — attempt caps, expiry, user upsert, token issue

**Files:**
- Modify: `server/apps/api/src/services/auth_service.ts` (add `verifyOtp`, `issueRefreshToken`)
- Modify: `server/apps/api/src/routes/auth_routes.ts` (add `POST /auth/otp/verify`)
- Test: `server/apps/api/test/routes/auth_otp_routes.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `requestOtp` (Task 7), `OTP_MAX_ATTEMPTS` / `hashOtpCode` / `isOtpExpired` (Task 5), `signAccessToken` / `generateRefreshToken` / `REFRESH_TOKEN_TTL_MS` (Task 6), `sha256Hex` (Task 5), `ApiError` (Task 3).
- Produces:
  - `type VerifyOtpResult = { kind: "ok"; userId: string; destination: string } | { kind: "not_found" } | { kind: "expired" } | { kind: "too_many_attempts" } | { kind: "invalid_code" }`
  - `verifyOtp(prisma: PrismaClient, requestId: string, code: string, nowMs?: number): Promise<VerifyOtpResult>`
  - `issueRefreshToken(prisma: PrismaClient, userId: string, familyId: string, nowMs?: number): Promise<string>` — returns the plaintext opaque token; only its sha256 is stored. Task 9 reuses it for rotation.
  - Route `POST /v1/auth/otp/verify` — `{ requestId, code }` → `{ accessToken, refreshToken, user: { id, destination } }`.

- [ ] **Step 1: Write the failing tests**

Append to `server/apps/api/test/routes/auth_otp_routes.test.ts`. Add these imports at the top of the file:

```ts
import { requestOtp } from "../../src/services/auth_service.js";
import { OTP_MAX_ATTEMPTS } from "../../src/lib/otp.js";
import { sha256Hex } from "../../src/lib/hashing.js";
```

(Merge the `OTP_MAX_ATTEMPTS` import into the existing `../../src/lib/otp.js` import line: `import { OTP_TTL_MS, OTP_MAX_ATTEMPTS } from "../../src/lib/otp.js";`.)

Append this describe block at the end of the file:

```ts
describe("POST /v1/auth/otp/verify", () => {
  async function createOtp(destination = "juan@example.com") {
    // The route never exposes the code; tests obtain it from the service directly.
    return requestOtp(app.prisma, destination);
  }

  it("verifies a correct code, creates the user, and returns both tokens", async () => {
    const { requestId, code } = await createOtp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; destination: string };
    };
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user.destination).toBe("juan@example.com");
    const user = await app.prisma.user.findUnique({
      where: { destination: "juan@example.com" },
    });
    expect(user?.id).toBe(body.user.id);
    const stored = await app.prisma.refreshToken.findMany({
      where: { userId: body.user.id },
    });
    expect(stored).toHaveLength(1);
    // stored hashed, never plaintext
    expect(stored[0]?.tokenHash).toBe(sha256Hex(body.refreshToken));
    expect(stored[0]?.revokedAt).toBeNull();
  });

  it("reuses the existing user on a second login for the same destination", async () => {
    const first = await createOtp();
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId: first.requestId, code: first.code },
    });
    const second = await createOtp();
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId: second.requestId, code: second.code },
    });
    const id1 = (res1.json() as { user: { id: string } }).user.id;
    const id2 = (res2.json() as { user: { id: string } }).user.id;
    expect(id1).toBe(id2);
  });

  it("rejects a wrong code with 401 invalid_code and increments attempts", async () => {
    const { requestId, code } = await createOtp();
    const wrong = code === "000000" ? "000001" : "000000";
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code: wrong },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "invalid_code",
    );
    const row = await app.prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(row?.attempts).toBe(1);
  });

  it("locks out after OTP_MAX_ATTEMPTS wrong codes — even with the right code", async () => {
    const { requestId, code } = await createOtp();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        payload: { requestId, code: wrong },
      });
      expect(res.statusCode).toBe(401);
    }
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    expect(res.statusCode).toBe(429);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "too_many_attempts",
    );
  });

  it("rejects an expired code with 401 otp_expired", async () => {
    const { requestId, code } = await createOtp();
    await app.prisma.otpRequest.update({
      where: { id: requestId },
      data: { expiresAt: BigInt(Date.now() - 1) },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "otp_expired",
    );
  });

  it("rejects an unknown requestId with 404 otp_not_found", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        requestId: "00000000-0000-4000-8000-000000000000",
        code: "123456",
      },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "otp_not_found",
    );
  });

  it("rejects a consumed requestId — codes are single-use", async () => {
    const { requestId, code } = await createOtp();
    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed code shape with 400 (schema gate, no attempt burned)", async () => {
    const { requestId } = await createOtp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code: "12ab56" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
    const row = await app.prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(row?.attempts).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/routes/auth_otp_routes.test.ts`
Expected: FAIL — the new verify tests get 404 `not_found` (route unregistered); Task 7 tests still pass.

- [ ] **Step 3: Extend `src/services/auth_service.ts`**

Add these imports to the existing import block:

```ts
import {
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  generateOtpCode,
  hashOtpCode,
  isOtpExpired,
} from "../lib/otp.js";
import { REFRESH_TOKEN_TTL_MS, generateRefreshToken } from "../lib/jwt.js";
import { sha256Hex } from "../lib/hashing.js";
```

Append these functions:

```ts
export type VerifyOtpResult =
  | { kind: "ok"; userId: string; destination: string }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "too_many_attempts" }
  | { kind: "invalid_code" };

export async function verifyOtp(
  prisma: PrismaClient,
  requestId: string,
  code: string,
  nowMs: number = Date.now(),
): Promise<VerifyOtpResult> {
  const request = await prisma.otpRequest.findUnique({
    where: { id: requestId },
  });
  if (!request || request.consumedAt !== null) return { kind: "not_found" };
  if (isOtpExpired(Number(request.expiresAt), nowMs)) {
    return { kind: "expired" };
  }
  if (request.attempts >= OTP_MAX_ATTEMPTS) {
    return { kind: "too_many_attempts" };
  }
  if (hashOtpCode(requestId, code) !== request.codeHash) {
    await prisma.otpRequest.update({
      where: { id: requestId },
      data: { attempts: { increment: 1 } },
    });
    return { kind: "invalid_code" };
  }
  await prisma.otpRequest.update({
    where: { id: requestId },
    data: { consumedAt: BigInt(nowMs) },
  });
  const user = await prisma.user.upsert({
    where: { destination: request.destination },
    update: {},
    create: {
      id: randomUUID(),
      destination: request.destination,
      createdAt: BigInt(nowMs),
    },
  });
  return { kind: "ok", userId: user.id, destination: user.destination };
}

export async function issueRefreshToken(
  prisma: PrismaClient,
  userId: string,
  familyId: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const token = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      id: randomUUID(),
      userId,
      familyId,
      tokenHash: sha256Hex(token),
      expiresAt: BigInt(nowMs + REFRESH_TOKEN_TTL_MS),
      createdAt: BigInt(nowMs),
    },
  });
  return token;
}
```

- [ ] **Step 4: Extend `src/routes/auth_routes.ts`**

Add these imports at the top:

```ts
import { randomUUID } from "node:crypto";
import { ApiError } from "../lib/errors.js";
import { signAccessToken } from "../lib/jwt.js";
import {
  requestOtp,
  verifyOtp,
  issueRefreshToken,
} from "../services/auth_service.js";
```

(This replaces the previous `import { requestOtp } ...` line.)

Append inside `authRoutes` (after the `/auth/otp/request` registration):

```ts
  app.post(
    "/auth/otp/verify",
    {
      schema: {
        body: {
          type: "object",
          required: ["requestId", "code"],
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1 },
            code: { type: "string", pattern: "^\\d{6}$" },
          },
        },
      },
    },
    async (request) => {
      const { requestId, code } = request.body as {
        requestId: string;
        code: string;
      };
      const result = await verifyOtp(app.prisma, requestId, code);
      if (result.kind === "not_found") {
        throw new ApiError(404, "otp_not_found", "OTP request not found or already used");
      }
      if (result.kind === "expired") {
        throw new ApiError(401, "otp_expired", "OTP code has expired");
      }
      if (result.kind === "too_many_attempts") {
        throw new ApiError(429, "too_many_attempts", "Too many incorrect attempts");
      }
      if (result.kind === "invalid_code") {
        throw new ApiError(401, "invalid_code", "Incorrect OTP code");
      }
      const accessToken = signAccessToken(result.userId, app.config.jwtSecret);
      const refreshToken = await issueRefreshToken(
        app.prisma,
        result.userId,
        randomUUID(), // new token family per login
      );
      return {
        accessToken,
        refreshToken,
        user: { id: result.userId, destination: result.destination },
      };
    },
  );
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/routes/auth_otp_routes.test.ts`
Expected: PASS — 12 tests green (4 from Task 7 + 8 new).

- [ ] **Step 6: Commit**

```bash
git add src/services/auth_service.ts src/routes/auth_routes.ts test/routes/auth_otp_routes.test.ts
git commit -m "feat(server): otp verify with attempt caps issuing jwt and refresh token"
```

---

### Task 9: Token refresh — rotation, reuse detection, family revocation

**Files:**
- Modify: `server/apps/api/src/services/auth_service.ts` (add `classifyRefreshToken`, `rotateRefreshToken`)
- Modify: `server/apps/api/src/routes/auth_routes.ts` (add `POST /auth/token/refresh`)
- Test: `server/apps/api/test/services/auth_service.test.ts`
- Test: `server/apps/api/test/routes/auth_refresh_routes.test.ts`

**Interfaces:**
- Consumes: `issueRefreshToken`, `requestOtp` (Tasks 7/8), `sha256Hex` (Task 5), `signAccessToken` (Task 6), `ApiError` (Task 3).
- Produces:
  - `type RefreshClassification = "valid" | "expired" | "reused"`
  - `classifyRefreshToken(record: { expiresAt: number; revokedAt: number | null }, nowMs: number): RefreshClassification` — pure rotation decision, unit-tested.
  - `type RotateResult = { kind: "ok"; userId: string; refreshToken: string } | { kind: "invalid" } | { kind: "reuse_detected" }`
  - `rotateRefreshToken(prisma: PrismaClient, presentedToken: string, nowMs?: number): Promise<RotateResult>`
  - Route `POST /v1/auth/token/refresh` — `{ refreshToken }` → `{ accessToken, refreshToken }` (rotated). Presenting a previously-rotated (revoked) token revokes the ENTIRE token family and returns 401 `token_reuse_detected`.

- [ ] **Step 1: Write the failing unit tests for the rotation decision**

`server/apps/api/test/services/auth_service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyRefreshToken } from "../../src/services/auth_service.js";

const NOW = 1_754_000_000_000;

describe("classifyRefreshToken", () => {
  it("classifies a live, unrevoked token as valid", () => {
    expect(
      classifyRefreshToken({ expiresAt: NOW + 1000, revokedAt: null }, NOW),
    ).toBe("valid");
  });

  it("classifies a token at/after its expiry as expired", () => {
    expect(
      classifyRefreshToken({ expiresAt: NOW, revokedAt: null }, NOW),
    ).toBe("expired");
    expect(
      classifyRefreshToken({ expiresAt: NOW - 1, revokedAt: null }, NOW),
    ).toBe("expired");
  });

  it("classifies any revoked token as reused — reuse wins even over expiry", () => {
    expect(
      classifyRefreshToken({ expiresAt: NOW + 1000, revokedAt: NOW - 500 }, NOW),
    ).toBe("reused");
    expect(
      classifyRefreshToken({ expiresAt: NOW - 1000, revokedAt: NOW - 500 }, NOW),
    ).toBe("reused");
  });
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run test/services/auth_service.test.ts`
Expected: FAIL — `classifyRefreshToken` is not exported (`SyntaxError` / undefined import).

- [ ] **Step 3: Implement the pure classifier in `src/services/auth_service.ts`**

Append:

```ts
export type RefreshClassification = "valid" | "expired" | "reused";

export function classifyRefreshToken(
  record: { expiresAt: number; revokedAt: number | null },
  nowMs: number,
): RefreshClassification {
  if (record.revokedAt !== null) return "reused";
  if (nowMs >= record.expiresAt) return "expired";
  return "valid";
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run test/services/auth_service.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Write the failing integration tests**

`server/apps/api/test/routes/auth_refresh_routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { requestOtp } from "../../src/services/auth_service.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
});

async function login(): Promise<{ refreshToken: string; userId: string }> {
  const { requestId, code } = await requestOtp(app.prisma, "juan@example.com");
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { requestId, code },
  });
  const body = res.json() as { refreshToken: string; user: { id: string } };
  return { refreshToken: body.refreshToken, userId: body.user.id };
}

describe("POST /v1/auth/token/refresh", () => {
  it("rotates a valid refresh token and returns a fresh access token", async () => {
    const { refreshToken } = await login();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string; refreshToken: string };
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.refreshToken).not.toBe(refreshToken);
  });

  it("keeps the chain alive: the rotated token itself refreshes fine", async () => {
    const { refreshToken } = await login();
    const first = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/token/refresh",
        payload: { refreshToken },
      })
    ).json() as { refreshToken: string };
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(res.statusCode).toBe(200);
  });

  it("detects reuse of a rotated token and revokes the whole family", async () => {
    const { refreshToken, userId } = await login();
    const rotated = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/token/refresh",
        payload: { refreshToken },
      })
    ).json() as { refreshToken: string };

    // Attacker replays the OLD token after rotation.
    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    expect((reuse.json() as { error: { code: string } }).error.code).toBe(
      "token_reuse_detected",
    );

    // Every token in the family is now revoked...
    const live = await app.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
    });
    expect(live).toHaveLength(0);

    // ...so even the legitimate rotated token is dead.
    const afterRevoke = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it("rejects an unknown refresh token with 401 invalid_token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken: "definitely-not-issued" },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "invalid_token",
    );
  });

  it("rejects an expired refresh token with 401 invalid_token", async () => {
    const { refreshToken, userId } = await login();
    await app.prisma.refreshToken.updateMany({
      where: { userId },
      data: { expiresAt: BigInt(Date.now() - 1) },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "invalid_token",
    );
  });

  it("rejects a missing refreshToken field with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
  });
});
```

- [ ] **Step 6: Run the integration tests to verify they fail**

Run: `npx vitest run test/routes/auth_refresh_routes.test.ts`
Expected: FAIL — refresh requests get 404 `not_found` (route unregistered).

- [ ] **Step 7: Implement `rotateRefreshToken` in `src/services/auth_service.ts`**

Append:

```ts
export type RotateResult =
  | { kind: "ok"; userId: string; refreshToken: string }
  | { kind: "invalid" }
  | { kind: "reuse_detected" };

export async function rotateRefreshToken(
  prisma: PrismaClient,
  presentedToken: string,
  nowMs: number = Date.now(),
): Promise<RotateResult> {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256Hex(presentedToken) },
  });
  if (!record) return { kind: "invalid" };
  const classification = classifyRefreshToken(
    {
      expiresAt: Number(record.expiresAt),
      revokedAt: record.revokedAt === null ? null : Number(record.revokedAt),
    },
    nowMs,
  );
  if (classification === "reused") {
    // A rotated token came back: assume theft, kill the whole family.
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: BigInt(nowMs) },
    });
    return { kind: "reuse_detected" };
  }
  if (classification === "expired") return { kind: "invalid" };
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: BigInt(nowMs) },
  });
  const refreshToken = await issueRefreshToken(
    prisma,
    record.userId,
    record.familyId,
    nowMs,
  );
  return { kind: "ok", userId: record.userId, refreshToken };
}
```

- [ ] **Step 8: Add the refresh route in `src/routes/auth_routes.ts`**

Extend the service import line to include `rotateRefreshToken`:

```ts
import {
  requestOtp,
  verifyOtp,
  issueRefreshToken,
  rotateRefreshToken,
} from "../services/auth_service.js";
```

Append inside `authRoutes` (after the `/auth/otp/verify` registration):

```ts
  app.post(
    "/auth/token/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          additionalProperties: false,
          properties: {
            refreshToken: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const { refreshToken } = request.body as { refreshToken: string };
      const result = await rotateRefreshToken(app.prisma, refreshToken);
      if (result.kind === "reuse_detected") {
        throw new ApiError(
          401,
          "token_reuse_detected",
          "Refresh token reuse detected; token family revoked",
        );
      }
      if (result.kind === "invalid") {
        throw new ApiError(
          401,
          "invalid_token",
          "Refresh token is invalid or expired",
        );
      }
      const accessToken = signAccessToken(result.userId, app.config.jwtSecret);
      return { accessToken, refreshToken: result.refreshToken };
    },
  );
```

- [ ] **Step 9: Run the integration tests to verify they pass**

Run: `npx vitest run test/routes/auth_refresh_routes.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS — everything green.

- [ ] **Step 11: Commit**

```bash
git add src/services/auth_service.ts src/routes/auth_routes.ts test/services/auth_service.test.ts test/routes/auth_refresh_routes.test.ts
git commit -m "feat(server): refresh token rotation with reuse detection and family revocation"
```

---

### Task 10: Auth plugin — Bearer verification decorating request.userId

**Files:**
- Create: `server/apps/api/src/plugins/auth_plugin.ts`
- Modify: `server/apps/api/src/app.ts` (register the plugin)
- Test: `server/apps/api/test/plugins/auth_plugin.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken`, `signAccessToken`, `ACCESS_TOKEN_TTL_MS` (Task 6), `ApiError` (Task 3), `app.config.jwtSecret`.
- Produces: `authPlugin`; decorations `app.authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>` (a preHandler) and `request.userId: string`. Tasks 13 and 14 protect routes with `preHandler: app.authenticate` and read `request.userId`.

- [ ] **Step 1: Write the failing tests**

`server/apps/api/test/plugins/auth_plugin.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import {
  signAccessToken,
  ACCESS_TOKEN_TTL_MS,
} from "../../src/lib/jwt.js";

const app = buildApp();

beforeAll(async () => {
  // Decorations from fastify-plugin land during ready; add the scratch route
  // inside a register callback so instance.authenticate exists when it runs.
  await app.register(async (instance) => {
    instance.get(
      "/test_protected",
      { preHandler: instance.authenticate },
      async (request) => ({ userId: request.userId }),
    );
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("auth plugin", () => {
  it("rejects a missing Authorization header with 401 unauthorized", async () => {
    const res = await app.inject({ method: "GET", url: "/test_protected" });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "unauthorized",
    );
  });

  it("rejects a non-Bearer scheme", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: "Bearer garbage" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = signAccessToken(
      "user-1",
      app.config.jwtSecret,
      Date.now() - ACCESS_TOKEN_TTL_MS - 1000,
    );
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = signAccessToken("user-1", "some_other_secret");
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("decorates the request with userId on a valid token", async () => {
    const token = signAccessToken("user-42", app.config.jwtSecret);
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: "user-42" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/plugins/auth_plugin.test.ts`
Expected: FAIL — `instance.authenticate` is undefined, so Fastify rejects the route options ("preHandler hook should be a function") or the request errors.

- [ ] **Step 3: Implement `src/plugins/auth_plugin.ts`**

```ts
import fp from "fastify-plugin";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { verifyAccessToken } from "../lib/jwt.js";
import { ApiError } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("userId", "");
  app.decorate(
    "authenticate",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const header = request.headers.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        throw new ApiError(
          401,
          "unauthorized",
          "Missing or malformed Authorization header",
        );
      }
      const token = header.slice("Bearer ".length);
      const claims = verifyAccessToken(token, app.config.jwtSecret);
      if (claims === null) {
        throw new ApiError(
          401,
          "unauthorized",
          "Invalid or expired access token",
        );
      }
      request.userId = claims.sub;
    },
  );
});
```

- [ ] **Step 4: Modify `src/app.ts` to register the plugin**

Add to the imports:

```ts
import { authPlugin } from "./plugins/auth_plugin.js";
```

Add this line directly BELOW `void app.register(prismaPlugin);`:

```ts
  void app.register(authPlugin);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/plugins/auth_plugin.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/auth_plugin.ts src/app.ts test/plugins/auth_plugin.test.ts
git commit -m "feat(server): auth plugin verifying bearer tokens onto request.userId"
```

---

### Task 11: Parser rules — versioned ruleset route + GCash/Maya/BPI seed

**Files:**
- Create: `server/apps/api/prisma/seed_data.ts`
- Create: `server/apps/api/prisma/seed.ts`
- Create: `server/apps/api/src/routes/parser_rules_routes.ts`
- Modify: `server/apps/api/src/app.ts` (register the route)
- Test: `server/apps/api/test/seed_data.test.ts`
- Test: `server/apps/api/test/routes/parser_rules_routes.test.ts`

**Interfaces:**
- Consumes: `app.prisma` (Task 4), `ApiError` (Task 3), `resetDb` (Task 7).
- Produces:
  - From `prisma/seed_data.ts`: `type ParserTemplate = { id: string; match: string; direction?: "in" | "out"; confidence: number }`, `type ProviderRuleset = { providerKey: string; packageNames: string[]; version: number; templates: ParserTemplate[] }`, `type RulesetPayload = { version: number; providers: ProviderRuleset[] }`, `INITIAL_RULESET: RulesetPayload`.
  - `npm run db:seed` upserts `INITIAL_RULESET` as `parser_rulesets` version 1.
  - Route `GET /v1/parser_rules?since_version=N` → `{ version, providers: [...] }` (contract §5 JSON shape); when `since_version >= current` it short-circuits to `{ version, providers: [] }`; 404 `not_found` when the table is empty.
- Product context (docs/03-ingest-pipeline.md §11): rulesets are versioned DATA, never code. The regex templates below are **illustrative placeholders** matching the invented samples in §11.4 — real formats come from the team's device-captured corpus at implementation and ship as later ruleset versions. Named regex groups allowed: `amount`, `direction`, `merchant`, `counterparty`, `ref`, `balance`. Package names are indicative and must be verified at implementation (§10).

- [ ] **Step 1: Write the failing seed-data tests**

`server/apps/api/test/seed_data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { INITIAL_RULESET } from "../prisma/seed_data.js";

describe("initial parser ruleset seed", () => {
  it("is version 1 and covers gcash, maya, and bpi in order", () => {
    expect(INITIAL_RULESET.version).toBe(1);
    expect(INITIAL_RULESET.providers.map((p) => p.providerKey)).toEqual([
      "gcash",
      "maya",
      "bpi",
    ]);
  });

  it("gives every provider at least one package name and one template", () => {
    for (const provider of INITIAL_RULESET.providers) {
      expect(provider.packageNames.length).toBeGreaterThanOrEqual(1);
      expect(provider.templates.length).toBeGreaterThanOrEqual(1);
      expect(provider.version).toBe(1);
    }
  });

  it("compiles every template regex, each with an amount named group and a 0..1 confidence", () => {
    for (const provider of INITIAL_RULESET.providers) {
      for (const template of provider.templates) {
        const regex = new RegExp(template.match); // throws if invalid
        expect(regex).toBeInstanceOf(RegExp);
        expect(template.match).toContain("(?<amount>");
        expect(template.confidence).toBeGreaterThan(0);
        expect(template.confidence).toBeLessThanOrEqual(1);
        if (template.direction !== undefined) {
          expect(["in", "out"]).toContain(template.direction);
        }
      }
    }
  });

  it("extracts fields from the illustrative gcash send sample", () => {
    const sendTemplate = INITIAL_RULESET.providers[0]?.templates.find(
      (t) => t.id === "gcash_send_v1",
    );
    expect(sendTemplate).toBeDefined();
    const match = new RegExp(sendTemplate?.match ?? "").exec(
      "You have sent ₱1,500.00 to JUAN D. Ref No. 90210XXXX. Your new balance is ₱2,350.75.",
    );
    expect(match?.groups?.amount).toBe("1,500.00");
    expect(match?.groups?.counterparty).toBe("JUAN D");
    expect(match?.groups?.ref).toBe("90210XXXX");
    expect(match?.groups?.balance).toBe("2,350.75");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/seed_data.test.ts`
Expected: FAIL — vitest cannot resolve `../prisma/seed_data.js`.

- [ ] **Step 3: Implement `prisma/seed_data.ts`**

```ts
// Initial parser ruleset — ILLUSTRATIVE placeholder templates only.
// Real notification formats are captured from team devices and maintained as
// a versioned corpus (docs/03-ingest-pipeline.md SS11.3); they replace these
// templates in later ruleset versions via the same /v1/parser_rules channel.
// Package names are indicative and must be verified at implementation.

export type ParserTemplate = {
  id: string;
  match: string;
  direction?: "in" | "out";
  confidence: number;
};

export type ProviderRuleset = {
  providerKey: string;
  packageNames: string[];
  version: number;
  templates: ParserTemplate[];
};

export type RulesetPayload = {
  version: number;
  providers: ProviderRuleset[];
};

export const INITIAL_RULESET: RulesetPayload = {
  version: 1,
  providers: [
    {
      providerKey: "gcash",
      packageNames: ["com.globe.gcash.android"],
      version: 1,
      templates: [
        {
          id: "gcash_send_v1",
          match:
            "^You have sent ₱(?<amount>[0-9,]+\\.[0-9]{2}) to (?<counterparty>.+?)\\. Ref No\\. (?<ref>[A-Za-z0-9]+)\\.(?: Your new balance is ₱(?<balance>[0-9,]+\\.[0-9]{2})\\.)?$",
          direction: "out",
          confidence: 1,
        },
        {
          id: "gcash_receive_v1",
          match:
            "^You have received ₱(?<amount>[0-9,]+\\.[0-9]{2}) from (?<counterparty>.+?)\\.",
          direction: "in",
          confidence: 1,
        },
        {
          id: "gcash_pay_qr_v1",
          match:
            "^Payment of ₱(?<amount>[0-9,]+\\.[0-9]{2}) to (?<merchant>.+?) (?:was successful|is complete)",
          direction: "out",
          confidence: 0.9,
        },
      ],
    },
    {
      providerKey: "maya",
      packageNames: ["com.paymaya"],
      version: 1,
      templates: [
        {
          id: "maya_send_v1",
          match:
            "^You sent ₱(?<amount>[0-9,]+\\.[0-9]{2}) to (?<counterparty>.+?)\\.",
          direction: "out",
          confidence: 1,
        },
        {
          id: "maya_receive_v1",
          match:
            "^You received ₱(?<amount>[0-9,]+\\.[0-9]{2}) from (?<counterparty>.+?)\\.",
          direction: "in",
          confidence: 1,
        },
      ],
    },
    {
      providerKey: "bpi",
      packageNames: [
        "com.bpi.ng.app",
        "com.google.android.apps.messaging",
      ],
      version: 1,
      templates: [
        {
          id: "bpi_debit_sms_v1",
          match:
            "^BPI: Your account ending (?<accountTail>[0-9]{4}) was debited ₱(?<amount>[0-9,]+\\.[0-9]{2})",
          direction: "out",
          confidence: 0.9,
        },
        {
          id: "bpi_credit_sms_v1",
          match:
            "^BPI: Your account ending (?<accountTail>[0-9]{4}) was credited ₱(?<amount>[0-9,]+\\.[0-9]{2})",
          direction: "in",
          confidence: 0.9,
        },
      ],
    },
  ],
};
```

- [ ] **Step 4: Run the seed-data tests to verify they pass**

Run: `npx vitest run test/seed_data.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Implement `prisma/seed.ts`**

```ts
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { INITIAL_RULESET } from "./seed_data.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.parserRuleset.upsert({
    where: { version: INITIAL_RULESET.version },
    update: { rulesJson: INITIAL_RULESET },
    create: {
      id: randomUUID(),
      version: INITIAL_RULESET.version,
      rulesJson: INITIAL_RULESET,
      createdAt: BigInt(Date.now()),
    },
  });
  console.log(`Seeded parser ruleset version ${INITIAL_RULESET.version}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

Run: `npm run db:seed`
Expected: prints `Seeded parser ruleset version 1`. Run it twice — the second run must also succeed (upsert is idempotent).

- [ ] **Step 6: Write the failing route tests**

`server/apps/api/test/routes/parser_rules_routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { INITIAL_RULESET } from "../../prisma/seed_data.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
});

async function insertRuleset(version: number): Promise<void> {
  await app.prisma.parserRuleset.create({
    data: {
      id: randomUUID(),
      version,
      rulesJson: { ...INITIAL_RULESET, version },
      createdAt: BigInt(Date.now()),
    },
  });
}

describe("GET /v1/parser_rules", () => {
  it("returns the latest ruleset with the full providers array", async () => {
    await insertRuleset(1);
    await insertRuleset(2);
    const res = await app.inject({ method: "GET", url: "/v1/parser_rules" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      version: number;
      providers: Array<{ providerKey: string; packageNames: string[] }>;
    };
    expect(body.version).toBe(2);
    expect(body.providers.map((p) => p.providerKey)).toEqual([
      "gcash",
      "maya",
      "bpi",
    ]);
  });

  it("short-circuits to empty providers when since_version equals current", async () => {
    await insertRuleset(3);
    const res = await app.inject({
      method: "GET",
      url: "/v1/parser_rules?since_version=3",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 3, providers: [] });
  });

  it("short-circuits when since_version is ahead of current", async () => {
    await insertRuleset(3);
    const res = await app.inject({
      method: "GET",
      url: "/v1/parser_rules?since_version=99",
    });
    expect(res.json()).toEqual({ version: 3, providers: [] });
  });

  it("returns the full ruleset when since_version is behind", async () => {
    await insertRuleset(3);
    const res = await app.inject({
      method: "GET",
      url: "/v1/parser_rules?since_version=2",
    });
    const body = res.json() as { version: number; providers: unknown[] };
    expect(body.version).toBe(3);
    expect(body.providers.length).toBe(3);
  });

  it("rejects a non-integer since_version with 400 validation_error", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/parser_rules?since_version=abc",
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
  });

  it("404s with the error envelope when no ruleset exists", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/parser_rules" });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "not_found",
    );
  });
});
```

- [ ] **Step 7: Run the route tests to verify they fail**

Run: `npx vitest run test/routes/parser_rules_routes.test.ts`
Expected: FAIL — requests get 404 `not_found` with message `Route GET /v1/parser_rules not found` even after seeding (route unregistered), so the assertions on 200 responses fail.

- [ ] **Step 8: Implement `src/routes/parser_rules_routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { ApiError } from "../lib/errors.js";
import type { RulesetPayload } from "../../prisma/seed_data.js";

export async function parserRulesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/parser_rules",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            since_version: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      const { since_version: sinceVersion } = request.query as {
        since_version?: number;
      };
      const latest = await app.prisma.parserRuleset.findFirst({
        orderBy: { version: "desc" },
      });
      if (!latest) {
        throw new ApiError(404, "not_found", "No parser ruleset available");
      }
      if (sinceVersion !== undefined && sinceVersion >= latest.version) {
        return { version: latest.version, providers: [] };
      }
      const rules = latest.rulesJson as unknown as RulesetPayload;
      return { version: latest.version, providers: rules.providers };
    },
  );
}
```

Note the type-only import from `prisma/seed_data.ts`: `tsc` with `rootDir: "src"` still compiles because type-only imports are erased at build time. Do not import a runtime value from `prisma/` into `src/`.

- [ ] **Step 9: Modify `src/app.ts` to register the route**

Add to the imports:

```ts
import { parserRulesRoutes } from "./routes/parser_rules_routes.js";
```

Add this line directly BELOW `void app.register(authRoutes, { prefix: "/v1" });`:

```ts
  void app.register(parserRulesRoutes, { prefix: "/v1" });
```

- [ ] **Step 10: Run the route tests to verify they pass**

Run: `npx vitest run test/routes/parser_rules_routes.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 11: Commit**

```bash
git add prisma/seed_data.ts prisma/seed.ts src/routes/parser_rules_routes.ts src/app.ts test/seed_data.test.ts test/routes/parser_rules_routes.test.ts
git commit -m "feat(server): versioned parser rules route with gcash maya bpi seed"
```

---

### Task 12: Telemetry — aggregate-only parse stats with per-IP rate limit

**Files:**
- Create: `server/apps/api/src/routes/telemetry_routes.ts`
- Modify: `server/apps/api/src/app.ts` (register `@fastify/rate-limit` with `global: false`, register the route)
- Test: `server/apps/api/test/routes/telemetry_routes.test.ts`

**Interfaces:**
- Consumes: `app.prisma` (Task 4), `app.config.telemetryRateLimitMax` (Task 1), `resetDb` (Task 7), `buildApp(overrides)` (Task 3 — the rate-limit test builds an app with a tiny budget).
- Produces: Route `POST /v1/telemetry/parse_stats` — `{ appVersion, rulesetVersion, providerKey, parsed, failed, periodStart, periodEnd }` → `202` empty body. Stores exactly those aggregate fields plus `receivedAt`; `additionalProperties: false` structurally rejects any content-bearing extra field (privacy stance: counts only, never notification content — docs/07-privacy-and-compliance.md §5.3).

- [ ] **Step 1: Write the failing tests**

`server/apps/api/test/routes/telemetry_routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";

const VALID_BODY = {
  appVersion: "1.0.0",
  rulesetVersion: 1,
  providerKey: "gcash",
  parsed: 120,
  failed: 3,
  periodStart: 1_754_000_000_000,
  periodEnd: 1_754_086_400_000,
};

describe("POST /v1/telemetry/parse_stats", () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app.prisma);
  });

  it("accepts valid aggregate stats with 202 and stores exactly those fields", async () => {
    const before = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(202);
    const rows = await app.prisma.telemetryParseStat.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appVersion).toBe("1.0.0");
    expect(rows[0]?.rulesetVersion).toBe(1);
    expect(rows[0]?.providerKey).toBe("gcash");
    expect(rows[0]?.parsed).toBe(120);
    expect(rows[0]?.failed).toBe(3);
    expect(Number(rows[0]?.periodStart)).toBe(VALID_BODY.periodStart);
    expect(Number(rows[0]?.periodEnd)).toBe(VALID_BODY.periodEnd);
    expect(Number(rows[0]?.receivedAt)).toBeGreaterThanOrEqual(before);
  });

  it("rejects content-bearing extra fields — aggregate counts only, never content", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: { ...VALID_BODY, rawText: "You have sent ₱1,500.00 to JUAN D." },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
    expect(await app.prisma.telemetryParseStat.count()).toBe(0);
  });

  it("rejects a missing required field", async () => {
    const { providerKey: _omitted, ...withoutProvider } = VALID_BODY;
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: withoutProvider,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative counts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: { ...VALID_BODY, parsed: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-integer counts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: { ...VALID_BODY, failed: 1.5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("per-IP rate limiting", () => {
  // Separate app with a 2-request budget so the test stays fast.
  const app = buildApp({ telemetryRateLimitMax: 2 });

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns a 429 rate_limited envelope once the per-IP budget is spent", async () => {
    for (let i = 0; i < 2; i++) {
      const ok = await app.inject({
        method: "POST",
        url: "/v1/telemetry/parse_stats",
        payload: VALID_BODY,
      });
      expect(ok.statusCode).toBe(202);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: VALID_BODY,
    });
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: { code: string } }).error.code).toBe(
      "rate_limited",
    );
  });

  it("keys the budget per IP — a different remote address still passes", async () => {
    const otherIp = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: VALID_BODY,
      remoteAddress: "10.1.2.3",
    });
    expect(otherIp.statusCode).toBe(202);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/routes/telemetry_routes.test.ts`
Expected: FAIL — requests get 404 (route unregistered).

- [ ] **Step 3: Implement `src/routes/telemetry_routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

type ParseStatsBody = {
  appVersion: string;
  rulesetVersion: number;
  providerKey: string;
  parsed: number;
  failed: number;
  periodStart: number;
  periodEnd: number;
};

export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/telemetry/parse_stats",
    {
      config: {
        rateLimit: {
          max: app.config.telemetryRateLimitMax,
          timeWindow: 60_000,
          errorResponseBuilder: () => ({
            error: {
              code: "rate_limited",
              message: "Telemetry rate limit exceeded",
            },
          }),
        },
      },
      schema: {
        body: {
          type: "object",
          required: [
            "appVersion",
            "rulesetVersion",
            "providerKey",
            "parsed",
            "failed",
            "periodStart",
            "periodEnd",
          ],
          additionalProperties: false, // privacy gate: counts only, never content
          properties: {
            appVersion: { type: "string", minLength: 1, maxLength: 32 },
            rulesetVersion: { type: "integer", minimum: 0 },
            providerKey: { type: "string", minLength: 1, maxLength: 64 },
            parsed: { type: "integer", minimum: 0 },
            failed: { type: "integer", minimum: 0 },
            periodStart: { type: "integer", minimum: 0 },
            periodEnd: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as ParseStatsBody;
      await app.prisma.telemetryParseStat.create({
        data: {
          id: randomUUID(),
          appVersion: body.appVersion,
          rulesetVersion: body.rulesetVersion,
          providerKey: body.providerKey,
          parsed: body.parsed,
          failed: body.failed,
          periodStart: BigInt(body.periodStart),
          periodEnd: BigInt(body.periodEnd),
          receivedAt: BigInt(Date.now()),
        },
      });
      return reply.status(202).send();
    },
  );
}
```

- [ ] **Step 4: Modify `src/app.ts` — register the rate limiter and the route**

Add to the imports:

```ts
import rateLimit from "@fastify/rate-limit";
import { telemetryRoutes } from "./routes/telemetry_routes.js";
```

Add the rate limiter registration directly BELOW `void app.register(authPlugin);` (it must be registered before any route that sets `config.rateLimit`; `global: false` means only routes that opt in are limited — keyed by `request.ip` by default):

```ts
  void app.register(rateLimit, { global: false });
```

Add the route registration directly BELOW `void app.register(parserRulesRoutes, { prefix: "/v1" });`:

```ts
  void app.register(telemetryRoutes, { prefix: "/v1" });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/routes/telemetry_routes.test.ts`
Expected: PASS — 7 tests green.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — everything green.

- [ ] **Step 7: Commit**

```bash
git add src/routes/telemetry_routes.ts src/app.ts test/routes/telemetry_routes.test.ts
git commit -m "feat(server): aggregate-only telemetry route with per-ip rate limit"
```

---

### Task 13: Backup vault — authenticated PUT/GET of one opaque blob per user

**Files:**
- Create: `server/apps/api/src/routes/backup_routes.ts`
- Create: `server/apps/api/test/helpers/auth.ts`
- Modify: `server/apps/api/src/app.ts` (register the route)
- Test: `server/apps/api/test/routes/backup_routes.test.ts`

**Interfaces:**
- Consumes: `app.authenticate` + `request.userId` (Task 10), `app.prisma` (Task 4), `ApiError` (Task 3), `signAccessToken` (Task 6), `resetDb` (Task 7).
- Produces:
  - `createUserWithToken(app: FastifyInstance): Promise<{ userId: string; accessToken: string }>` from `test/helpers/auth.ts` — Task 14 reuses it.
  - Route `PUT /v1/backup/vault` (Bearer) — `{ schemaVersion, deviceId, blob }` → `{ storedAt }`; upserts so exactly one latest vault exists per user.
  - Route `GET /v1/backup/vault` (Bearer) — → `{ schemaVersion, deviceId, blob, storedAt }` or 404 `not_found` when absent.
- Product context (docs/07-privacy-and-compliance.md §1, §4 row 6): the blob is client-side-encrypted before upload; the server never inspects it, stores it opaquely (base64 text), and only ever hands it back to the same authenticated user. Fastify's default 1 MiB body limit applies and is acceptable for MVP.

- [ ] **Step 1: Create the auth test helper**

`server/apps/api/test/helpers/auth.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { signAccessToken } from "../../src/lib/jwt.js";

export async function createUserWithToken(
  app: FastifyInstance,
): Promise<{ userId: string; accessToken: string }> {
  const userId = randomUUID();
  await app.prisma.user.create({
    data: {
      id: userId,
      destination: `${userId}@example.com`,
      createdAt: BigInt(Date.now()),
    },
  });
  return {
    userId,
    accessToken: signAccessToken(userId, app.config.jwtSecret),
  };
}
```

- [ ] **Step 2: Write the failing tests**

`server/apps/api/test/routes/backup_routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { createUserWithToken } from "../helpers/auth.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
});

const VAULT_BODY = {
  schemaVersion: 1,
  deviceId: "device-abc",
  blob: "ZW5jcnlwdGVkX2xlZGdlcl9ieXRlcw==",
};

describe("PUT /v1/backup/vault", () => {
  it("rejects a request without a token — 401 unauthorized", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "unauthorized",
    );
  });

  it("stores the opaque blob and returns storedAt", async () => {
    const { userId, accessToken } = await createUserWithToken(app);
    const before = Date.now();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const { storedAt } = res.json() as { storedAt: number };
    expect(storedAt).toBeGreaterThanOrEqual(before);
    expect(storedAt).toBeLessThanOrEqual(Date.now());
    const row = await app.prisma.backupVault.findUnique({
      where: { userId },
    });
    expect(row?.blob).toBe(VAULT_BODY.blob);
    expect(row?.deviceId).toBe("device-abc");
  });

  it("keeps only the latest vault per user (upsert)", async () => {
    const { userId, accessToken } = await createUserWithToken(app);
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: { schemaVersion: 2, deviceId: "device-xyz", blob: "bmV3ZXJfYmxvYg==" },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const rows = await app.prisma.backupVault.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.blob).toBe("bmV3ZXJfYmxvYg==");
    expect(rows[0]?.schemaVersion).toBe(2);
    expect(rows[0]?.deviceId).toBe("device-xyz");
  });

  it("rejects an invalid body with 400 validation_error", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: { schemaVersion: 0, deviceId: "", blob: "" },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
  });

  it("rejects a non-base64 blob", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: { ...VAULT_BODY, blob: "not base64 !!!" },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/backup/vault", () => {
  it("rejects a request without a token — 401 unauthorized", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/backup/vault" });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "unauthorized",
    );
  });

  it("404s with the error envelope when no vault has been stored", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/backup/vault",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "not_found",
    );
  });

  it("returns the stored vault round-trip", async () => {
    const { accessToken } = await createUserWithToken(app);
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/backup/vault",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      schemaVersion: number;
      deviceId: string;
      blob: string;
      storedAt: number;
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.deviceId).toBe("device-abc");
    expect(body.blob).toBe(VAULT_BODY.blob);
    expect(typeof body.storedAt).toBe("number");
  });

  it("isolates vaults between users", async () => {
    const alice = await createUserWithToken(app);
    const bob = await createUserWithToken(app);
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/backup/vault",
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/routes/backup_routes.test.ts`
Expected: FAIL — requests get 404 `Route PUT /v1/backup/vault not found` (route unregistered).

- [ ] **Step 4: Implement `src/routes/backup_routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ApiError } from "../lib/errors.js";

const BASE64_PATTERN = "^[A-Za-z0-9+/=_-]+$"; // accepts base64 and base64url

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.put(
    "/backup/vault",
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: "object",
          required: ["schemaVersion", "deviceId", "blob"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "integer", minimum: 1 },
            deviceId: { type: "string", minLength: 1, maxLength: 128 },
            blob: { type: "string", minLength: 1, pattern: BASE64_PATTERN },
          },
        },
      },
    },
    async (request) => {
      const { schemaVersion, deviceId, blob } = request.body as {
        schemaVersion: number;
        deviceId: string;
        blob: string;
      };
      const storedAt = Date.now();
      await app.prisma.backupVault.upsert({
        where: { userId: request.userId },
        update: { schemaVersion, deviceId, blob, storedAt: BigInt(storedAt) },
        create: {
          id: randomUUID(),
          userId: request.userId,
          schemaVersion,
          deviceId,
          blob,
          storedAt: BigInt(storedAt),
        },
      });
      return { storedAt };
    },
  );

  app.get(
    "/backup/vault",
    { preHandler: app.authenticate },
    async (request) => {
      const vault = await app.prisma.backupVault.findUnique({
        where: { userId: request.userId },
      });
      if (!vault) {
        throw new ApiError(
          404,
          "not_found",
          "No backup vault stored for this user",
        );
      }
      return {
        schemaVersion: vault.schemaVersion,
        deviceId: vault.deviceId,
        blob: vault.blob,
        storedAt: Number(vault.storedAt),
      };
    },
  );
}
```

Note on lifecycle order: Fastify runs schema validation BEFORE route-level `preHandler`, so an unauthenticated request with an invalid body gets 400, not 401. The tests above always send a valid body when probing auth, so both behaviors are pinned unambiguously.

- [ ] **Step 5: Modify `src/app.ts` to register the route**

Add to the imports:

```ts
import { backupRoutes } from "./routes/backup_routes.js";
```

Add this line directly BELOW `void app.register(telemetryRoutes, { prefix: "/v1" });`:

```ts
  void app.register(backupRoutes, { prefix: "/v1" });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/routes/backup_routes.test.ts`
Expected: PASS — 9 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/routes/backup_routes.ts src/app.ts test/helpers/auth.ts test/routes/backup_routes.test.ts
git commit -m "feat(server): authenticated opaque backup vault with one latest per user"
```

---

### Task 14: Entitlements stub route

**Files:**
- Create: `server/apps/api/src/routes/entitlements_routes.ts`
- Modify: `server/apps/api/src/app.ts` (register the route)
- Test: `server/apps/api/test/routes/entitlements_routes.test.ts`

**Interfaces:**
- Consumes: `app.authenticate` (Task 10), `createUserWithToken` (Task 13), `resetDb` (Task 7).
- Produces: Route `GET /v1/entitlements` (Bearer) → `{ tier: "free", source: "stub" }`.
- Product context (docs/05-monetization.md §4): the real Entitlements layer is local-first on the mobile device (hardcoded `plus` during MVP); this server route is a stub seam for the future store-billing integration. The `entitlements` table exists (Task 2) but the stub deliberately does not read it — it always answers `free`/`stub` per the contract. Server-side tier evaluation arrives with billing, not before.

- [ ] **Step 1: Write the failing tests**

`server/apps/api/test/routes/entitlements_routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { createUserWithToken } from "../helpers/auth.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
});

describe("GET /v1/entitlements", () => {
  it("rejects a request without a token — 401 unauthorized", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/entitlements" });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "unauthorized",
    );
  });

  it("rejects an invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: "Bearer garbage" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the stub tier for an authenticated user", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tier: "free", source: "stub" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/routes/entitlements_routes.test.ts`
Expected: FAIL — requests get 404 `Route GET /v1/entitlements not found`.

- [ ] **Step 3: Implement `src/routes/entitlements_routes.ts`**

```ts
import type { FastifyInstance } from "fastify";

export async function entitlementsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/entitlements",
    { preHandler: app.authenticate },
    async () => ({ tier: "free", source: "stub" }),
  );
}
```

- [ ] **Step 4: Modify `src/app.ts` to register the route**

Add to the imports:

```ts
import { entitlementsRoutes } from "./routes/entitlements_routes.js";
```

Add this line directly BELOW `void app.register(backupRoutes, { prefix: "/v1" });`:

```ts
  void app.register(entitlementsRoutes, { prefix: "/v1" });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/routes/entitlements_routes.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Run the full suite and the build**

Run: `npm test`
Expected: PASS — all test files green.

Run: `npm run build`
Expected: `tsc` completes with zero errors and emits `dist/`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/entitlements_routes.ts src/app.ts test/routes/entitlements_routes.test.ts
git commit -m "feat(server): entitlements stub route returning free tier"
```

---

### Task 15: Server README

**Files:**
- Create: `server/README.md`

**Interfaces:**
- Consumes: everything above (documents it).
- Produces: `server/README.md` — setup, run, and test instructions for a developer with zero context.

- [ ] **Step 1: Write `server/README.md`**

````markdown
# PeraPlano Server

Fastify + Prisma + Postgres backend for PeraPlano (Android money tracker).
TypeScript strict, ESM, tested with vitest against a real Postgres.

## What this server does

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | — | Liveness probe → `{ "status": "ok" }` |
| `POST /v1/auth/otp/request` | — | Email OTP request → `{ requestId }` (dev: code is logged, not mailed) |
| `POST /v1/auth/otp/verify` | — | Verify OTP → access JWT (15 min) + refresh token (30 d) |
| `POST /v1/auth/token/refresh` | — | Rotate refresh token; reuse of a rotated token revokes the family |
| `GET /v1/parser_rules?since_version=N` | — | Latest versioned parser ruleset; short-circuits to empty providers when up to date |
| `POST /v1/telemetry/parse_stats` | — | Aggregate parse counts only (never content); per-IP rate limited |
| `PUT /v1/backup/vault` | Bearer | Store the client-side-encrypted backup blob (one latest per user) |
| `GET /v1/backup/vault` | Bearer | Fetch the blob; 404 when absent |
| `GET /v1/entitlements` | Bearer | Stub → `{ "tier": "free", "source": "stub" }` |

Errors always use the envelope `{ "error": { "code": "...", "message": "..." } }`.

## Prerequisites

- Node.js ≥ 20.19
- Docker (for Postgres)

## Setup

```bash
npm install
cp .env.example .env        # then edit JWT_SECRET to a long random string
npm run db:up               # starts Postgres 16 on localhost:5432
npm run db:migrate          # applies prisma migrations (also generates the client)
npm run db:seed             # loads parser ruleset v1 (GCash / Maya / BPI placeholders)
```

`.env` variables (see `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `PORT`
(default 3000), `TELEMETRY_RATE_LIMIT_MAX` (default 60 requests/min/IP).
Never commit a real `.env`.

## Run

```bash
npm run dev     # tsx watch src/server.ts (reload on change)
npm run build   # tsc → dist/
npm start       # node dist/server.js
```

Smoke check: `curl -s http://localhost:3000/health` → `{"status":"ok"}`.

During development the OTP code for `POST /v1/auth/otp/request` is written to
the server log (`otp issued (dev delivery)`); wire a real mail provider before
production.

## Test

```bash
npm run db:up   # tests need Postgres up and migrated
npm test        # vitest run — full suite
npx vitest run test/routes/backup_routes.test.ts   # single file
```

Integration tests TRUNCATE all tables between tests and run test files
serially (`fileParallelism: false`) — do not point `DATABASE_URL` at a
database with data you care about. Re-run `npm run db:seed` after a test run
if you want the dev ruleset back.

## Project layout

```
src/app.ts          buildApp(): registers plugins + routes, no listen
src/server.ts       entry point (listen)
src/config.ts       typed env loading
src/lib/            errors (ApiError + envelope handler), hashing, otp, jwt
src/plugins/        prisma (app.prisma), auth (app.authenticate → request.userId)
src/services/       auth_service (otp verify, refresh rotation + reuse detection)
src/routes/         one file per domain: health, auth, parser_rules, telemetry, backup, entitlements
prisma/             schema (7 snake_case-mapped models), migrations, seed
test/               mirrors routes/ + services/ + lib/ + plugins/
```

## Conventions

- snake_case file names and DB identifiers; camelCase/PascalCase TS symbols.
- Money: integer centavos. Time: epoch milliseconds (`BIGINT` in Postgres —
  convert `bigint` ↔ `number` at JSON boundaries). IDs: UUIDv4.
- Conventional Commits.
````

- [ ] **Step 2: Verify the documented commands**

Run: `npm test`
Expected: PASS — the README's test instructions are literally what CI would run.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(server): setup, run, and test instructions"
```

---

## Plan completion checklist (for the executor)

- [ ] All 15 tasks committed; `npm test` green; `npm run build` clean.
- [ ] Contract §6 conformance spot-check: route table matches exactly (paths, methods, auth, request/response shapes); tables are `users`, `otp_requests`, `refresh_tokens`, `parser_rulesets`, `telemetry_parse_stats`, `backup_vaults`, `entitlements`; access token TTL 15 min, refresh 30 d with rotation + family revocation on reuse; error envelope everywhere; `.env.example` committed, no real `.env` in git.
