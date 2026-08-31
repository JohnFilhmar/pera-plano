# Google Account Linking via Google Play: Server Design

**Status:** Approved design, 2026-08-31
**Supersedes:** the deferral in [../../09-v2-backlog.md](../../09-v2-backlog.md) §2.12 and the cohort
deferral in [2026-08-22-mobile-ui-revamp-design.md](2026-08-22-mobile-ui-revamp-design.md) §6.3.
**Layers on:** [../plans/2026-08-02-server-functional-core.md](../plans/2026-08-02-server-functional-core.md)
(unstarted, 0 of 109 steps) and [../plans/2026-08-02-00-interface-contract.md](../plans/2026-08-02-00-interface-contract.md) §6.

---

## 1. Purpose

Give PeraPlano an identity that exists off the phone, sourced from the user's Google account, and
use Google Play's own signals to decide who is entitled to Plus. Two outcomes:

1. A user signs in with Google and the server issues the same access and refresh tokens the OTP
   path already issues, so the mobile client has exactly one token path.
2. The permanent-Plus promise made to testers who install during the beta window becomes a rule the
   server can evaluate and audit, instead of a promise with no mechanism behind it
   ([2026-08-21-plus-tier-prerequisites.md](2026-08-21-plus-tier-prerequisites.md) §4.2).

This design is written to be executed by parallel subagents. Every seam that crosses a slice
boundary is pinned here by exact name, signature, route, status code, and error code. An
implementer who needs a decision that is not written down should stop and ask, not choose.

## 2. Decisions locked

| # | Decision | Provenance |
|---|---|---|
| D1 | Google Play does both jobs: identity (Sign in with Google) and entitlement (Play Integrity licensing verdict). | Owner, 2026-08-31 |
| D2 | OTP email auth is kept. Google is the primary route, OTP is the fallback. Neither is removed. | Owner, 2026-08-31 |
| D3 | Beta cohort is established by a device-attested install claim wrapped in a Play Integrity token, not by Play Console records. | Owner, 2026-08-31, after the §3 findings |
| D4 | This pass ships identity and entitlement only. No ledger data is uploaded. The backup vault route stays built and tested but unused. | Owner, 2026-08-31 |
| D5 | The server verifies both Google tokens itself. No Firebase, no third-party auth vendor. | Owner, 2026-08-31 |

D5 matters beyond taste: adding Firebase would make Google a Personal Information Processor holding
the sign-in identity, which requires the written outsourcing agreement
[../../07-privacy-and-compliance.md](../../07-privacy-and-compliance.md) §2.1 mandates, before a DPO
is appointed or the NPC registration in §2.5 is done. Verifying tokens directly keeps the server the
only party holding identity.

## 3. Verified platform facts

Checked against Google's documentation on 2026-08-31. These constrain the design, so any future
change to them invalidates §7.

1. **Play Integrity `accountDetails.appLicensingVerdict`** returns exactly one of `LICENSED`,
   `UNLICENSED`, `UNEVALUATED`. `LICENSED` means the requesting Google account holds an app
   entitlement, that is, it installed or updated the app from Google Play. It requires the user to be
   signed in to Play, the device to be trustworthy enough to evaluate, and the installed version to
   be known to Play, otherwise the verdict is `UNEVALUATED`.
   Source: https://developer.android.com/google/play/integrity/verdicts
2. **The Play Integrity payload contains no install date, no purchase date, and no account
   identifier.** It answers "does this account own this app from Play", nothing more.
   Source: as above.
3. **There is no per-account first-install date in Play Console or the Play Developer API.** The only
   install-time signal available is the client-side Install Referrer API, which returns the referrer
   URL, referrer click timestamp, install begin timestamp, the app version at first install, and an
   instant-experience flag.
   Source: https://developer.android.com/google/play/installreferrer

Fact 3 falsifies the premise recorded in v2 backlog §2.12 and revamp spec §6.3, which both treat
Play Console install records as the sole surviving evidence of the beta cohort. Play Console will not
supply it. The device can, and only while the app remains installed. §9 and §16 carry the
consequence.

## 4. Architecture

One new service, two new libraries, two new routes, layered on the functional-core server. Nothing
in the ingest pipeline, the ledger, or the mobile local-first store changes.

```
POST /v1/auth/google/verify        (no auth)     sign in or sign up with Google
POST /v1/auth/google/link          (Bearer)      attach Google to an existing OTP account
GET  /v1/entitlements              (Bearer)      now resolves for real, no longer a stub

routes/google_auth_routes.ts     thin, validation and status codes only
services/google_auth_service.ts  the whole flow: verify, upsert, attest, grant, issue tokens
services/entitlement_service.ts  resolution order, the only place tier is decided
lib/google_id_token.ts           pure: verify an ID token against a supplied JWKS
lib/play_integrity.ts            port + HTTP adapter for decodeIntegrityToken
```

**Ports, so no slice waits on another and no test touches the network.** Both are plain interfaces
declared in `lib/`, injected through `buildApp()` options with the real adapter as the default:

```ts
export type JwksFetcher = () => Promise<JsonWebKeySet>;
export type PlayIntegrityDecoder = (integrityToken: string) => Promise<IntegrityPayload>;
```

Tests supply a `JwksFetcher` backed by an RSA keypair generated in the test file, and a
`PlayIntegrityDecoder` that returns a literal payload. No fixture is fetched over the network in any
test, and no test needs Google credentials.

### 4.1 The verify flow, step by step

1. Mobile obtains a Google ID token through Credential Manager, with the audience set to the
   server's OAuth web client id.
2. Mobile builds the install claim, then requests a Play Integrity token with
   `requestHash = base64url(sha256(id_token + "." + canonical_json(install_claim)))`. This binds the
   integrity verdict to this exact request, so a captured integrity token cannot be replayed against
   a different claim.
3. Mobile posts both tokens plus the claim to `POST /v1/auth/google/verify`.
4. The server verifies the ID token: RS256 signature against Google's JWKS, `iss` in
   `{"accounts.google.com", "https://accounts.google.com"}`, `aud` equal to the configured client id,
   `exp` in the future, `iat` not in the future beyond the configured skew, and `email_verified` true.
5. The server decodes the integrity token and checks, in this order:
   `requestDetails.requestPackageName` equals the configured package,
   `requestDetails.requestHash` equals the hash recomputed server-side from the received body,
   `requestDetails.timestampMillis` within the configured freshness window,
   `appIntegrity.appRecognitionVerdict` equals `PLAY_RECOGNIZED`,
   `accountDetails.appLicensingVerdict` equals `LICENSED`.
6. The server upserts the user, upserts the Google identity, writes the install attestation, resolves
   the entitlement, and issues an access token and a refresh token through the existing
   `lib/jwt.ts`. No new token format is invented.

### 4.2 Response envelope

`POST /v1/auth/google/verify` returns **exactly** the envelope
`POST /v1/auth/otp/verify` already returns, and nothing more:

```json
{ "accessToken": "...", "refreshToken": "...", "user": { "id": "...", "destination": "..." } }
```

The client learns its tier from `GET /v1/entitlements`, which is the single source of truth for tier.
Returning tier from the auth route as well would create two sources that can disagree. Do not add it.

## 5. Data model

Two new tables. The existing seven from interface contract §6 are unchanged: `entitlements.source` is
already a `String` column, so widening its accepted values (§14 item 3) needs no migration.

```prisma
model GoogleIdentity {
  id             String  @id
  userId         String  @map("user_id")
  googleSub      String  @unique @map("google_sub")
  email          String
  emailVerified  Boolean @map("email_verified")
  linkedAt       BigInt  @map("linked_at")
  lastVerifiedAt BigInt  @map("last_verified_at")

  user User @relation(fields: [userId], references: [id])

  @@map("google_identities")
}

model InstallAttestation {
  id                  String  @id
  userId              String  @map("user_id")
  googleSub           String  @map("google_sub")
  packageName         String  @map("package_name")
  claimSource         String  @map("claim_source")
  installBeginAt      BigInt? @map("install_begin_at")
  firstInstallAt      BigInt? @map("first_install_at")
  appVersionAtInstall String? @map("app_version_at_install")
  licensingVerdict    String  @map("licensing_verdict")
  recognitionVerdict  String  @map("recognition_verdict")
  cohortGranted       Boolean @map("cohort_granted")
  createdAt           BigInt  @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@map("install_attestations")
}
```

`claim_source` is `"install_referrer"` or `"package_manager"`, recorded so a later audit can tell a
Play-supplied timestamp from a device-clock one. The attestation row is written on **every** verify
call, granted or not, because a permanent Plus grant must be explainable a year later.

`prisma.user.destination` stays unique and non-null. A Google sign-in writes the verified Google
email into it, which means a person who used OTP with that same address lands on the same user row
rather than a duplicate. That unification is intended. It is also why `email_verified` must be true
before the address is trusted: an unverified Google email would let an attacker claim an existing
OTP account.

**The three cases `/verify` must handle, pinned so no implementer decides for themselves:**

| Found | Action |
|---|---|
| No user, no identity | Create both. Issue tokens. |
| A `google_identities` row for this `google_sub` | Use its `user_id`. Update `last_verified_at`. Issue tokens. |
| A `users` row with this email but no Google identity | Attach a new identity to that user. Do not create a second user, and do not error. |

The third case is the OTP-then-Google user, and silently unifying is correct only because
`email_verified` was checked first.

## 6. Wire contract

Every non-2xx response uses the existing envelope `{ "error": { "code": "...", "message": "..." } }`.

### POST /v1/auth/google/verify

Auth: none. Rate limited per IP.

```jsonc
// request
{
  "idToken": "string",
  "integrityToken": "string",
  "installClaim": {
    "packageName": "com.filldev.peraplano",
    "claimSource": "install_referrer" | "package_manager",
    "installBeginAt": 1756000000000,     // epoch ms, null when claimSource is package_manager
    "firstInstallAt": 1756000000000,     // epoch ms, null when unavailable
    "appVersionAtInstall": "0.1.0"       // null when unavailable
  }
}
// 200
{ "accessToken": "...", "refreshToken": "...", "user": { "id": "...", "destination": "..." } }
```

### POST /v1/auth/google/link

Auth: Bearer. Attaches a Google identity to the caller's existing account.

```jsonc
// request: identical body to /verify
// 200
{ "identity": { "googleSub": "...", "email": "...", "linkedAt": 1756000000000 } }
```

### GET /v1/entitlements

Auth: Bearer. Unchanged shape, real values.

```jsonc
{ "tier": "free" | "plus", "source": "stub" | "beta_cohort" | "play_billing" }
```

### Error codes

| Code | Status | Cause |
|---|---|---|
| `invalid_request` | 400 | Body fails schema validation |
| `invalid_google_token` | 401 | Signature, issuer, audience, or expiry check failed |
| `google_email_unverified` | 401 | `email_verified` is not true |
| `integrity_token_invalid` | 401 | Decode failed, or package name mismatch |
| `integrity_request_mismatch` | 401 | `requestHash` does not match the recomputed hash |
| `integrity_stale` | 401 | `timestampMillis` outside the freshness window |
| `app_not_play_licensed` | 403 | `appLicensingVerdict` is not `LICENSED`, or recognition is not `PLAY_RECOGNIZED` |
| `install_claim_invalid` | 400 | Claim timestamps are in the future, or both are null |
| `google_identity_already_linked` | 409 | `google_sub` already belongs to a different user |
| `google_upstream_unavailable` | 503 | JWKS or Play Integrity call failed after retry |

`app_not_play_licensed` is a 403 and not a 401 deliberately: the caller authenticated fine, the app
copy is the problem. The mobile client must show a different message for it.

## 7. The beta cohort rule

A grant is issued if and only if **all** of these hold:

1. `accountDetails.appLicensingVerdict == "LICENSED"`
2. `appIntegrity.appRecognitionVerdict == "PLAY_RECOGNIZED"`
3. `requestDetails.requestPackageName == config.playPackageName`
4. The effective install time is inside `[config.betaWindowStartAt, config.betaWindowEndAt]`
5. The effective install time is not in the future relative to server time
6. The `google_sub` has no existing grant attached to a different user

**Effective install time** is `installBeginAt` when present, otherwise `firstInstallAt`. Prefer
`installBeginAt`: it comes from Play, whereas `firstInstallAt` comes from `PackageManager` and moves
with the device clock. When only `firstInstallAt` is available the grant is still issued, and
`claim_source` records why, because refusing it would punish users whose referrer data expired.

A grant writes `entitlements` with `tier = "plus"`, `source = "beta_cohort"`. **It is permanent.** No
later verify call, integrity failure, or reinstall downgrades it. That is the promise, and the
attestation row is the evidence.

## 8. Entitlement resolution

`services/entitlement_service.ts` is the only place tier is decided. Resolution order:

1. An `entitlements` row with `source = "beta_cohort"` wins. Return `plus`.
2. `source = "play_billing"` is **reserved and not implemented in this pass.** No branch resolves it.
3. Otherwise return `free`.

**No `entitlements` row is written unless a grant is issued.** A missing row resolves to
`{ tier: "free", source: "stub" }`. Do not write a placeholder row on sign-in: an empty table then
means "nobody has been granted anything", which is the property that makes the grant auditable.

Play Billing verification is deliberately absent: [../../05-monetization.md](../../05-monetization.md)
§6 has not set a price, so there is no SKU to verify against, and Plus remains blocked on a PIC
entity, a DPO, and NPC registration. The enum value exists so the next pass adds a branch instead of
a migration. An implementer must not invent a Play Billing check.

## 9. Mobile changes

Small, and one of them is time-sensitive.

1. **Persist install evidence.** On first launch after upgrade, read the Install Referrer install
   begin timestamp and `PackageManager.firstInstallTime`, and store both. This reverses
   [2026-08-22-mobile-ui-revamp-design.md](2026-08-22-mobile-ui-revamp-design.md) §6.3, which chose
   not to persist `first_install_at`. Fact 3 in §3 is why: the device is the only source, and it stops
   being a source the moment the app is uninstalled.
2. **Ship item 1 in the next mobile release, ahead of the server.** Install Referrer data is not
   guaranteed to be retrievable indefinitely after install, and this design has not confirmed the
   retention window (§16, O1). Capturing early costs one small module. Capturing late may cost the
   cohort.
3. Add the Google sign-in call and the two client methods that post to §6's routes.
4. `lib/entitlements.ts` keeps its shape. `getTier()` gains a stored server value as its source once
   linking exists. `MVP_TIER` and `__setTierForTests` stay: nothing in the gate call sites changes.

## 10. Security

| Threat | Handling |
|---|---|
| Forged install claim from a sideloaded build | `appLicensingVerdict` and `appRecognitionVerdict` must both pass, so the claim only counts from a Play-installed, Play-recognized binary |
| Replay of a captured integrity token against a different claim | `requestHash` binds the token to the exact body, recomputed server-side and compared |
| Stale integrity token | `timestampMillis` freshness window, configurable, default 5 minutes |
| Account takeover through an unverified Google email | `email_verified` must be true before the address is written to `users.destination` |
| One Google account claiming many user rows | `google_sub` is unique, and a mismatch returns 409 rather than silently re-pointing |
| Brute force against the routes | Per-IP rate limiting through `@fastify/rate-limit`, the same plugin the telemetry route already uses |
| Service account key exposure | Supplied through the environment, never committed, `.env` stays gitignored per the core plan's global constraints |

## 11. Configuration

New environment variables, added to `loadConfig` in `src/config.ts` with the same throw-on-missing
posture the existing four have, and added to `.env.example`:

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | yes | none | Expected `aud` on the ID token |
| `PLAY_PACKAGE_NAME` | yes | none | Expected `requestPackageName` |
| `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` | yes | none | Credentials for `decodeIntegrityToken` |
| `BETA_WINDOW_START_AT` | yes | none | Epoch ms, inclusive |
| `BETA_WINDOW_END_AT` | yes | none | Epoch ms, inclusive |
| `GOOGLE_JWKS_URL` | no | `https://www.googleapis.com/oauth2/v3/certs` | Overridable for tests |
| `INTEGRITY_MAX_SKEW_MS` | no | `300000` | Freshness window |
| `GOOGLE_AUTH_RATE_LIMIT_MAX` | no | `20` | Per-IP, per minute |

## 12. Testing

Same posture as the core plan: test-first, vitest, integration through `fastify.inject()` against the
dockerized Postgres, no mocking of the database.

- `lib/google_id_token.ts` is unit-tested against a keypair generated in the test, covering a good
  token and one failure per check in §4.1 step 4.
- `lib/play_integrity.ts` is unit-tested through its port with literal payloads, covering each
  verdict value and each check in §4.1 step 5.
- `services/google_auth_service.ts` is integration-tested: new user, returning user, user who already
  exists from OTP with the same email, `google_sub` conflict, grant issued, grant withheld for an
  out-of-window install, grant not re-issued twice.
- `routes/google_auth_routes.ts` is integration-tested for every row of the §6 error table, asserting
  both status and `error.code`.
- `services/entitlement_service.ts` is integration-tested for all three resolution branches.
- One test asserts the verify response has exactly the four keys in §4.2, so tier never leaks into the
  auth envelope by accident.

## 13. Parallel execution slices

Seven slices. Files are disjoint, so agents do not collide. Every slice is testable on its own.

| Slice | Owns | Depends on |
|---|---|---|
| S1 | `prisma/schema.prisma` additions, migration, `test/prisma_schema.test.ts` update | core task 2 |
| S2 | `lib/google_id_token.ts` + test | core task 1 |
| S3 | `lib/play_integrity.ts` + test | core task 1 |
| S4 | `services/google_auth_service.ts` + test | S1, S2, S3, core task 6 |
| S5 | `routes/google_auth_routes.ts` + test | S4, core task 10 |
| S6 | `services/entitlement_service.ts`, real `routes/entitlements_routes.ts` + tests | S1 |
| S7 | mobile install-evidence capture and link client + tests | none |

S2, S3, S6, S7 start immediately and in parallel. S1 needs the core schema task. The whole slice set
sits **after** core plan tasks 1 through 10, which build the scaffold, schema, app, Prisma plugin,
hashing, JWT, OTP request, OTP verify, refresh rotation, and the auth plugin. Those ten are the
prerequisite, not part of this design.

## 14. Interface contract amendments

[../plans/2026-08-02-00-interface-contract.md](../plans/2026-08-02-00-interface-contract.md) §6 is
pinned as law, so these edits are made there in the same change that lands this spec:

1. Model list grows from seven to nine: add `google_identities`, `install_attestations`.
2. Route table gains `POST /v1/auth/google/verify` and `POST /v1/auth/google/link`.
3. `GET /v1/entitlements` response changes from `source: "stub"` returning `"free"` to
   `source: "stub" | "beta_cohort" | "play_billing"` returning a resolved tier.
4. The closing note "Auth, vault, entitlements: built + fully tested server-side, mobile wiring
   deferred" is amended: auth and entitlements are now wired to mobile, the vault is not.

## 15. Out of scope

- Play Billing purchase verification and any pricing mechanic.
- Uploading ledger data. The vault routes stay as the core plan builds them, unused.
- Multi-device sync.
- Account deletion flows tied to a Google identity. Play's account-deletion obligation
  ([2026-08-21-plus-tier-prerequisites.md](2026-08-21-plus-tier-prerequisites.md) §2.8) attaches once
  an identity layer exists, so it is the immediate next spec, not this one.
- iOS. There is no iOS app.

## 16. Open questions

| # | Question | Why it matters | Owner |
|---|---|---|---|
| O1 | How long does Install Referrer data stay retrievable after install? The docs page consulted did not state a retention period. | If it expires, §9 item 2 is urgent rather than merely advisable, and late-linking testers fall back to the device-clock timestamp. | Verify before the mobile release that ships install capture |
| O2 | What is the exact beta window, as two epoch-ms values? | §7 rule 4 cannot be configured without it, and the grant is permanent, so a wrong bound is expensive. | Owner |
| O3 | Does adding a Google identity change the NPC registration position in [../../07-privacy-and-compliance.md](../../07-privacy-and-compliance.md) §2.5, given the Free tier now touches a server for identity even without cloud backup? | §2.4's rule is that the notice must never claim more than the architecture delivers, and §1 currently says a Free user's data never touches a server. | Privacy counsel |

O3 is the one that can block a release. The privacy notice, the lawful-basis table in §2.3, the
lifecycle table in §4, and the Play Data safety form all need a revision in the same release that
ships linking. That is a documentation task with a hard dependency, and it belongs in the
implementation plan rather than being discovered at submission time.
