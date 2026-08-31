# Beta tester signup — design

> Owner-approved 2026-08-31. Adds `/beta`, the first surface in this project that collects
> personal data on a server.
> Reads with `docs/07-privacy-and-compliance.md` (§4 lifecycle table, which this change adds
> a row to) and `docs/14-design-revamp-prompt.md` §2.1 (the web page inventory, now seven).

## 1. What this is

A recruitment page for Google Play closed testing. It makes one offer — beta testers keep
PeraPlano Plus at no cost after public release — collects the Google account email Play needs
in order to invite them, and appends it to a spreadsheet.

## 2. Decisions taken

Chosen by the owner on 2026-08-31:

- **Ingestion:** an on-page form posting to a Next route handler, which calls a Google Apps
  Script web app server-to-server; the script appends the row.
- **The reward is committed, not hinted at:** the page promises permanent Plus, and a clause
  on `/terms` carries the binding version.
- **Placement:** a new `/beta` route, linked from the site navigation.
- **Fields:** Google account email, first name, optional phone model, explicit consent.

## 3. The collisions this had to resolve

Three, all of which shaped the result.

**The capabilities tripwire.** `libs/common/src/config/capabilities.ts` declares
`serverSideStorage: false`, guarded by a test whose comment says the flag flipping means
`/privacy` and `/data-deletion` "stop being true". A beta list is server-held personal data,
so something had to change — but `serverSideStorage` describes the **ledger**, and the ledger
genuinely still never leaves the phone. Flipping it would have made the notice *less* accurate,
not more.

Resolution: a fourth flag, `betaWaitlist: true`, with the distinction written into the constant
itself and the tripwire test extended rather than weakened. `serverSideStorage` stays `false`
and means what it always meant.

**The tier is Plus, not Pro.** `lib/entitlements.ts` and the shipped upgrade sheet know Free
and Plus. Nothing in the app can honour a promise about a "Pro" tier, and `MVP_TIER = "plus"`
means enforcement does not exist yet either — everyone is Plus today and the free caps are one
constant away. The page therefore promises Plus by name, and the spreadsheet is the record of
who qualifies when enforcement lands. A test asserts the page never says "Pro".

**Six routes was an asserted invariant.** `structure.test.ts` asserted exactly six locale
routes and that the header and footer link every one. Both were updated to seven rather than
loosened.

## 4. What the page says, and in what order

The obligations come **before** the form, deliberately. A closed test full of people who
installed the app once and never opened it is worse than a shorter list, so the page states
the commitment it is asking for before it asks for an address.

1. The offer, on the `--ink` band: Plus for life, a direct line, your corrections ship.
2. The work: an Android phone used for real money, a few weeks of real use, reporting misreads.
3. Why a Google account email is needed — Play closed testing is keyed to one — plus an
   explicit sentence that no password is ever requested. A form asking for a Google address is
   shaped exactly like a phishing page; the answer to that is a sentence, not a smaller font.
4. The form.
5. What happens to the data: purpose, storage, retention, removal.
6. A pointer to the `/terms` clause.

No price, no currency figure, no Play badge, no "Pro".

## 5. The form

Google account email (required), first name (required), phone model (optional), consent
checkbox (required). Plus a honeypot field and a fill-time floor, neither visible.

**No password field, ever.** Asserted by a test rather than left as an intention.

Without JavaScript it is a plain `POST` to the same route, which content-negotiates: a
form-encoded submission gets a 303 back to `/beta?submitted=…` and the page renders the same
success and error states server-side. The locale rides in a hidden field because the route sits
outside the `[locale]` segment.

Validation runs against one Zod schema in `types/beta_signup.ts`, shared by the client and the
route, so a field's message and the server's reason for rejecting it cannot drift.

## 6. The route

`app/api/beta-signup/route.ts`: validate, check the honeypot and the fill time, then POST
server-to-server to the Apps Script webhook with a shared token, a 15-second timeout, and no
retry.

**Never logged:** the email, the name, the device, the token. A log line carries the request id
and an outcome word. A 90-day retention promise means nothing if the same address is sitting in
an application log with its own lifetime, and log retention is not something this page controls.
A test asserts nothing reaches stdout or stderr.

**A filled honeypot returns a bland success.** Telling a bot which check caught it is free
tuning information. The row is simply never written.

**A duplicate is a success.** Someone submitting twice is unsure it worked, not an attacker.

### Rate limiting, stated rather than claimed

Honeypot, fill-time floor, an in-memory per-IP counter (5 per minute), and dedupe on the Apps
Script side. This is **weaker than `backend-security-baseline`**, which asks for Redis-backed
limiting. This app has no Redis and no session store; the endpoint writes one spreadsheet row.
If the list attracts real abuse the fix is a limiter in front of the app, not more code in the
handler. Recorded here so the gap is a decision and not an oversight.

## 7. Configuration

Two variables, deliberately **not** `COMPLIANCE_FIELDS`:

| Variable | Purpose |
|---|---|
| `BETA_SIGNUP_WEBHOOK_URL` | The Apps Script `/exec` deployment URL. Must be https |
| `BETA_SIGNUP_TOKEN` | Shared secret, matched against the script property of the same name |

Compliance fields abort production boot when unset, which is right for a legal identifier
printed on a notice and wrong for this: a missing webhook must not stop the privacy notice being
served. Both present or the config is `undefined` — a URL without a token would post
unauthenticated, and a token without a URL has nowhere to go.

When it is `undefined` the page renders the offer with the form replaced by a support-mailbox
notice, and the route answers 503. Same rule `requiredMarker` follows: publish the truth, never
a control that silently does nothing. **This is the state the site ships in until the Apps
Script deployment exists**, and it is covered by tests.

### Where the values live

Both are **GitHub Environment secrets**, not variables — the one place this differs from every
other value in `deploy.yml`. The compliance values there are legal identifiers that publish
verbatim on the privacy notice; these two authorise writes to the tester spreadsheet, and the
deployment URL is as sensitive as the token, because the token is the only thing standing in
front of it.

| Environment | Source |
|---|---|
| Production | `secrets.BETA_SIGNUP_*`, substituted into `docker-compose.production.yml` |
| Staging | the box-local env file its overlay already reads |
| Local | `server/.env.local`, which is gitignored |

Neither value is ever written into a committed file, and unset is a supported state rather than
a boot failure.

## 7.1 Verified against the live deployment, 2026-08-31

The Apps Script deployment was tested end to end before this shipped: `GET /exec` answers the
liveness probe, a wrong token is rejected without writing, a correct token appends a row, and
resubmitting the same address in different capitalisation returns `duplicate: true` and adds
nothing. The full chain through the route handler was then exercised against the real webhook.

That test surfaced one thing worth recording. **Apps Script answers a POST with a 302** to
`googleusercontent.com`, and the result is fetched from there. `fetch` handles this correctly:
the redirect hop is a GET, and it returns the stored `doPost` result. But if that hop ever
reached `doGet` instead, the reply would be `{ ok: true, service: … }` — and a plain `ok` check
would have reported a successful signup while writing nothing at all. The route therefore
requires a boolean `duplicate` field, which only `doPost` produces, and a regression test covers
it. A silent data loss became a visible 502.

## 8. Keeping the other pages true

- `/privacy` gains a "beta tester list" section (basis, purpose, recipients, retention, removal)
  and **row 9 of the lifecycle table**. That table is compared verbatim against
  `docs/07-privacy-and-compliance.md` §4 by `privacy_drift.test.tsx`, so the source document was
  edited in the same change.
- `/data-deletion` gains a removal route for the list.
- `/terms` gains the beta clause, placed directly after the tier table because it is an
  exception to it.
- `ServiceStatusNotice` gains one paragraph naming the list as the exception to "no copy on our
  servers". It renders on both `/privacy` and `/data-deletion`, so the exception appears
  wherever the claim does.

## 9. The spreadsheet

`server/apps/web/scripts/beta_signup.gs`, kept in the repository because a web app deployment
living only in one person's Google account is indistinguishable from a broken one. Setup
instructions are in its header.

Columns: `submitted_at`, `google_email`, `first_name`, `device_model`, `consent_version`,
`source`, `request_id`, `status`, `notes`. `status` is filled in by hand as invitations go out;
that column plus `submitted_at` is what makes this list the cohort record for the Plus promise —
which, per the existing memory note, previously existed only inside Play Console.

Email is lowercased before storage, because Play matches tester addresses case-insensitively and
the list must not hold one person twice.

## 10. Tests

New: `beta.test.tsx` (offer renders, says Plus and never Pro, no password field, consent present,
purpose and retention stated before the ask, links to `/terms` and `/privacy`, no price, closed
state renders a support route instead of a dead form, `?submitted=ok` renders the success state,
the form posts to a real action) and `beta_signup_route.test.ts` (503 unconfigured, 400 invalid
email, 400 unticked consent, bland success for honeypot and for too-fast fills with no upstream
call, happy path forwards the token and a normalised address, duplicate is a success, 502 on
upstream refusal, 502 on throw with no leaked detail, burst limiting, and nothing personal
written to stdout or stderr).

Updated: `structure.test.ts` (seven routes), `messages.test.ts`, `capabilities.test.ts`.

## 11. Explicitly not built

A password field, any account, any login, a price, a Play badge, a newsletter, an unsubscribe
system, or any analytics on this page. Removal is a message to a human, which at this list size
is the honest mechanism rather than a placeholder for one.
