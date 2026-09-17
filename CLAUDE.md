# PeraPlano

A local-first Philippine personal-finance Android app. It reads bank and e-wallet
notifications on-device and turns them into ledger entries; the ledger never leaves the
phone.

`docs/` is the spec. When the code and a feature doc disagree, one of them is a defect,
and which one is a decision rather than an assumption. Those decisions are recorded in
`GAP_ANALYSIS.md`, inside the entry they belong to, so they survive the session that made
them.

## Layout

| Path | What |
|---|---|
| `mobile/` | The Expo app: React Native, Expo Router, NativeWind, op-sqlite. |
| `server/` | An npm workspace holding the Next.js web app (`apps/web`) and `libs/common`. |
| `docs/` | The spec. `docs/04-features/` is per-feature, and its numbered rules are cited as "rule N" throughout the code. |
| `GAP_ANALYSIS.md` | The gap campaign. `## 0. Remediation log` is the source of truth for what is fixed; an id with no row there has not been started. |

## Naming

`snake_case` by default: files, directories, database columns, API field names, query and
route params.

`mobile/` is the carve-out, because it is React. Variables, functions, hooks and object
keys are `camelCase`; non-component files are `camelCase`, so `useAuth.ts` rather than
`use_auth.ts`; components and their files are `PascalCase`. Expo Router's own file
conventions win wherever they apply, and route params stay `snake_case` (`[user_id]`).

Match the surrounding file. Renaming to the convention is its own task, never a side
effect of an unrelated change.

## Tests and gates

| Package | Runner | Commands |
|---|---|---|
| `mobile/` | jest, via `jest-expo` | `npm test`, `npm run typecheck` |
| `server/` | vitest | `npm test`, `npm run typecheck`, `npm run lint` |

CI is the gate: `.github/workflows/mobile-ci.yml` and `server-ci.yml`. Both are
path-filtered, so a change outside a package runs none of its matrix. On a pull request
the filter is evaluated against the whole PR diff, not the last commit, which is why a
docs-only commit pushed onto a branch that already touched `mobile/` still runs the app's
matrix.

**`mobile/` has no ESLint config and no `lint` script, and that is deliberate rather than
an omission.** Lint is not a gate for the app. `server/` has both. Do not add one to
`mobile/` as a drive-by.

Do not overlap test runs in `mobile/`. Concurrent jest chunks, or jest alongside `tsc`,
starve `waitFor` calls and produce failures that vanish on a clean re-run.

## Things that will bite

- `mobile/node_modules` may be a junction on Windows. Never `npm install` from a git
  worktree; recreate the junction instead.
- Every Markdown file here uses CRLF. A multi-line literal replacement written against LF
  matches zero times and fails silently, which looks like a no-op rather than an error.
- `GAP_ANALYSIS.md`'s appendix is one compact JSON object per line. Never reformat it, and
  never write a pipe into a remediation row: the row is a table cell.
- The UI says "Delete" where the schema says archive (owner's ruling, 2026-08-28). Nothing
  is hard-deleted anywhere: every Plan entity and the Wallet are soft-deleted and
  restorable, and `wallets_repo` exports no `deleteWallet` at all.
- `mobile/app.json` holds the version that ships. `mobile/package.json`'s `version` field
  is read by nothing.
- The free tier's 90-day history floor is a BROWSING gate, not a computation one. A
  computation reads the window it asks for, through a bounded floor-exempt read
  (`listFullLedgerBetween`, `sumSpend`), never by passing a flag into `listTransactions`.
