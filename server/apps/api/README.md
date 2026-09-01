# PeraPlano API

Fastify + Prisma + Postgres backend for the PeraPlano Android money tracker.
TypeScript strict, ESM, tested with vitest against a real Postgres.

This package is `@peraplano/api`, one workspace inside `server/`. The other is
`@peraplano/web`, which is the shipped marketing site. The scripts at
`server/package.json` (`npm run dev`, `npm run build`, `npm test`) all target the
**web** app, so every command below is either run from this directory or scoped
with `-w @peraplano/api`. Running `npm test` from `server/` does not test the API.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness probe, returns `{ "status": "ok" }` |
| `POST /v1/auth/otp/request` | none | Email OTP request. In development the code is written to the log, not mailed |
| `POST /v1/auth/otp/verify` | none | Verify an OTP, returns an access JWT plus a refresh token |
| `POST /v1/auth/token/refresh` | none | Rotate the refresh token. Presenting a rotated token revokes the whole family |
| `POST /v1/auth/google/verify` | none | Sign in with a Google ID token plus a Play Integrity token, returns tokens and may grant beta Plus |
| `POST /v1/auth/google/link` | Bearer | Attach a Google identity to the signed-in account, returns `{ identity }` |
| `GET /v1/parser_rules?since_version=N` | none | Latest versioned parser ruleset, empty when the client is already current |
| `POST /v1/telemetry/parse_stats` | none | Aggregate parse counts only, never message content. Rate limited per IP |
| `PUT /v1/backup/vault` | Bearer | Store the client-side-encrypted backup blob, one latest per user |
| `GET /v1/backup/vault` | Bearer | Fetch that blob, 404 when absent |
| `GET /v1/entitlements` | Bearer | Resolved tier, `{ tier, source }` |

Errors always use the envelope `{ "error": { "code": "...", "message": "..." } }`,
including 404s and rate-limit 429s (`rate_limited`).

Unknown body fields are rejected with `400 validation_error` rather than stripped.
Fastify's Ajv defaults to `removeAdditional: true`, which would have made
`additionalProperties: false` enforce nothing, so `buildApp` turns it off.

### Entitlements

`GET /v1/entitlements` is no longer a stub. `resolveEntitlement` returns
`{ tier: "plus", source: "beta_cohort" }` for a device-attested beta installer,
`{ tier: "plus", source: "manual_grant" }` for someone claimed off the pregrant
list, and `{ tier: "free", source: "stub" }` otherwise. `play_billing` is reserved
and deliberately has no branch yet.

## Prerequisites

- Node.js >= 22 (see `engines`)
- Docker, for Postgres

## Setup

Run `npm install` once from `server/`, which installs every workspace. The rest is
from this directory:

```bash
cp .env.example .env        # then set JWT_SECRET and the Google values
npm run db:up               # starts Postgres on localhost:5432
npm run db:migrate          # applies migrations and generates the Prisma client
npm run db:seed             # loads parser ruleset v1
```

`npm run db:up` starts the `postgres` service behind compose profile `api`, so a
normal deploy does not bring it up. The container is named `peraplano-postgres-1`.

`dev`, `start`, `db:seed` and `pregrant` pass `--env-file-if-exists=.env`, so a
local `.env` is loaded into the process. "If exists" is deliberate: in staging and
production the environment is supplied by the container, and a missing file must
not stop the server from booting.

The Prisma CLI (`db:migrate`, `db:generate`, `db:deploy`) loads `.env` on its own.
If you have no `.env` at all, prefix the command instead:

```bash
DATABASE_URL="postgresql://peraplano:peraplano@localhost:5432/peraplano" npm run db:generate
```

### Environment

Required, no defaults: `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`,
`PLAY_PACKAGE_NAME`, `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`, `BETA_WINDOW_START_AT`,
`BETA_WINDOW_END_AT`. The API refuses to boot without them.

The beta window has no default on purpose. An install stamped inside it earns
*permanent* Plus, so a silent default would hand out grants nobody decided on.

Optional, with defaults: `PORT` (3000), `TELEMETRY_RATE_LIMIT_MAX` (60/min/IP),
`AUTH_RATE_LIMIT_MAX` (10/min/IP), `GOOGLE_AUTH_RATE_LIMIT_MAX` (20/min/IP),
`GOOGLE_JWKS_URL`, `INTEGRITY_MAX_SKEW_MS` (300000), `LOG_LEVEL` (`info`),
`MAIL_TRANSPORT` (`log`).

### Mail

`MAIL_TRANSPORT` decides how the sign-in code leaves the process.

- `log` writes the code to the server log and sends nothing. Local development
  only. **`loadConfig` refuses to boot with `log` when `NODE_ENV=production`**, so a
  misconfigured deploy fails loudly instead of quietly printing login codes.
- `smtp` sends it for real, and then requires `SMTP_HOST`, `SMTP_USER`,
  `SMTP_PASSWORD` and `MAIL_FROM_ADDRESS`. `SMTP_PORT` defaults to 587,
  `SMTP_SECURE` to `false`, `MAIL_FROM_NAME` to `PeraPlano`.

`SMTP_SECURE=true` means implicit TLS, which is port 465. Port 587 starts plaintext
and upgrades through STARTTLS, so it stays `false` there.

For Gmail, `SMTP_PASSWORD` is a 16-character App Password and the account needs
2-Step Verification enabled. Gmail also rewrites `From` to the authenticated
account unless a verified "send as" alias exists, so `MAIL_FROM_ADDRESS` normally
has to equal `SMTP_USER`. Gmail caps a free account near 500 recipients a day, and
mail from a personal address carries no SPF/DKIM for your own domain, so expect a
domain-authenticated provider to be a launch prerequisite rather than an upgrade.

If delivery fails the request returns `502 mail_delivery_failed` rather than a
misleading `200`. The OTP row is left to expire on its own.

The three rate-limit tiers are ordered by what an anonymous caller can spend:
telemetry is cheap, OTP creates rows and will send mail, and the Google routes
each cost two outbound requests to Google.

See `.env.example` for the full annotated list. Never commit a real `.env`, and
keep `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` in an encrypted file: it is a private key.

## Run

```bash
npm run dev     # tsx watch src/server.ts
npm run build   # tsc to dist/
npm start       # node dist/server.js
```

Smoke check: `curl -s http://localhost:3000/health` returns `{"status":"ok"}`.

Under `MAIL_TRANSPORT=log` the OTP code for `POST /v1/auth/otp/request` is written
to the server log as `otp issued (log transport, not delivered)` and no mail is
sent. Set `MAIL_TRANSPORT=smtp` to deliver it.

## Test

```bash
npm run db:up                                    # tests need Postgres up and migrated
npm test                                         # vitest run, full suite
npx vitest run test/routes/backup_routes.test.ts # a single file
```

Or from `server/`: `npm test -w @peraplano/api`.

Tests run against a real Postgres and `TRUNCATE` every table between cases, so do
not point `DATABASE_URL` at a database holding anything you want to keep. Files run
serially (`fileParallelism: false`) because they share that database. Re-run
`npm run db:seed` afterwards if you want the dev ruleset back.

Nothing in the suite talks to Google or an SMTP server. `buildApp` takes seams for
the three collaborators that would (`fetchJwks`, `decodeIntegrity`, `sendMail`);
when a test supplies them the real adapters are never constructed, so no suite
parses a service-account key, reads a mail password, or opens a socket.

The flip side is that the Google and SMTP contracts are never exercised by the
tests. Green here is not evidence that either one works against the real service.

## The pregrant CLI

Testers who installed over `adb` predate Google Play and can never return
`LICENSED`, so the beta cohort check cannot see them. The pregrant list waives the
licensing requirement for a named set of accounts. Every other binding check
(package name, request hash, freshness) still applies to them.

```bash
npm run pregrant -- add "tester@example.com" "adb tester, batch 1"
npm run pregrant -- list
```

A note is mandatory: a permanent grant with no stated reason cannot be audited.
`add` is idempotent and keeps the original note. This is a CLI rather than an HTTP
route because an admin endpoint would need an admin authentication surface that
does not exist.

## Layout

```
src/app.ts          buildApp(): plugins, routes and seams, no listen
src/server.ts       entry point
src/config.ts       typed env loading, throws on anything missing or invalid
src/cli/            pregrant, the beta pregrant list
src/lib/            errors, hashing, otp, jwt, mailer, google_id_token, play_integrity, beta_cohort
src/plugins/        prisma (app.prisma), auth (app.authenticate, request.userId)
src/routes/         one file per domain
src/services/       auth_service, google_auth_service, entitlement_service
prisma/             schema, migrations, seed
test/               mirrors src/, plus helpers/
```

## Conventions

- snake_case for file names and database identifiers, PascalCase and camelCase for
  TypeScript symbols as the language expects.
- Money is integer centavos. Time is epoch milliseconds, `BIGINT` in Postgres, so
  convert `bigint` to `number` at the JSON boundary. IDs are UUIDv4.
- Anything that must happen at most once is a single conditional write, not a read
  followed by an update. OTP attempt counting, refresh rotation and pregrant claims
  all had that bug and all were fixed the same way.
- Conventional Commits.
