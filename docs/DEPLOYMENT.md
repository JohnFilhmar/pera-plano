# Deploying server/apps/web

Manual, environment-selectable deploys of the Next.js site (`server/apps/web`) to a
self-hosted box, driven from the GitHub Actions **Deploy web** workflow
(`.github/workflows/deploy.yml`).

**Scope:** web only. There is no backend API service in this repo yet — port 5005 is
reserved for it (see `docker-compose.yml`) — so this pipeline covers nothing beyond
`apps/web`. Extend it, don't replace it, once `apps/api` exists.

This mirrors the pattern already proven on `talyer-e-inventory` on the same box.
**Production** reads its compliance/operational values from the `production` GitHub
Environment's variables, substituted into Compose the same way talyer does it.
**Staging** still uses a box-local env file for now (see "Compliance config" below) —
revisit that once staging is actually picked back up.

## How deploys are routed

The deploy job targets `runs-on: [self-hosted, linux, "${{ inputs.environment }}"]` — the
environment name **is** the runner label. Since staging and production both live on this
one box, register its runner with **both** `staging` and `production` labels (a single
runner can hold multiple labels).

`production` only deploys from the `master` branch; `staging` only deploys from the
`staging` branch. The workflow's "Guard branch/environment pairing" step enforces this —
a mismatched dispatch fails before touching the box.

**This currently blocks every production dispatch**: `master` is 400+ commits behind
`feat/mvp-implementation` and doesn't have `server/` at all yet. Nothing will deploy to
production until `feat/mvp-implementation` (or wherever `apps/web` lives) merges to
`master`. Fine for now while you're only exercising the pipeline itself.

## Setting up the runner

This repository is **private** (unlike `talyer-e-inventory`, which is public), so the
fork/PR self-hosted-runner risk that repo's docs warn about doesn't apply here. Keep
`deploy.yml` `workflow_dispatch`-only anyway — it's the right discipline regardless of
visibility.

**1. Docker**, as root, if not already present on this box (it will be — other services
already run here):

```bash
docker compose version   # must print v2.x
```

**2. A dedicated runner user**, as root. Don't run the runner as root, and don't reuse an
application user — `docker` group membership is effectively root on this host.

```bash
adduser --system --group --shell /bin/bash --home /opt/pera-plano runner
usermod -aG docker runner
chown -R runner:runner /opt/pera-plano
```

(If the runner tarball was already extracted into `/opt/pera-plano` as root, the `chown`
above hands the existing directory to the new user — no need to re-download.)

**3. Register the runner**, as that user. Get the download URL and token from GitHub →
repo → Settings → Actions → Runners → **New self-hosted runner** (Linux x64) — the token
is single-use and expires in about an hour.

```bash
sudo -iu runner
cd /opt/pera-plano
./config.sh \
  --url https://github.com/JohnFilhmar/pera-plano \
  --token <TOKEN from the GitHub page> \
  --name peraplano-box \
  --labels self-hosted,linux,staging,production \
  --work /opt/pera-plano/_work \
  --unattended --replace
```

**4. Install it as a service**, back as root:

```bash
cd /opt/pera-plano
./svc.sh install runner
./svc.sh start
./svc.sh status
```

**5. Confirm** it shows as *Idle* under Settings → Actions → Runners with both labels.

## Compliance config

`server/libs/common/src/config/env.ts` refuses to start in production if any of
`PIC_LEGAL_NAME`, `PIC_ADDRESS`, `DPO_NAME`, `DPO_EMAIL`, `SUPPORT_EMAIL`,
`NPC_REGISTRATION` is unset — these are the legal identifiers printed on the published
privacy notice, and a plausible-but-wrong value is worse than an outage. The gate only
checks presence (and email shape for the two email fields), so it will happily accept a
placeholder — it cannot tell "TBA" from a real legal name.

### Production — GitHub Environment variables

Read from the `production` GitHub Environment (Settings → Environments → production →
Variables), substituted by Compose from the deploy job's process env
(`.github/workflows/deploy.yml` → `docker-compose.production.yml`). Never a file, never
baked into the image. These are legal identifiers meant to be public on the privacy
notice, not secrets — that's why they're plain Environment variables, not encrypted ones.

**Already set, but every PIC/DPO/NPC field is currently the literal placeholder `TBA`**
(`DPO_EMAIL` is `tba@peraplano.com`; `SUPPORT_EMAIL` is the one real value,
`olajohnfilhmar@gmail.com`). A production deploy today will boot successfully and then
publish "TBA" as the legal Controller name/address/DPO on the live privacy page — that's
a known, deliberate tradeoff for now (see the PR/commit that wired this up), not a gate
failure. Update the values in Settings → Environments → production → Variables the
moment the PIC entity/DPO/NPC registration are real; no redeploy of code is needed, just
a fresh dispatch.

### Staging — box-local env file (unchanged, deferred)

Staging still reads from an absolute path outside the git checkout:

```
/opt/pera-plano/env/staging.env
```

Absolute and outside the checkout on purpose: `actions/checkout` runs `git clean -ffdx`
by default, which would delete a file placed anywhere inside the repo working tree on
the very next deploy. Create it on the box (as the `runner` user, or root + chown),
following `server/.env.example` for the full key list, when staging is picked back up:

```bash
mkdir -p /opt/pera-plano/env
$EDITOR /opt/pera-plano/env/staging.env
chmod 600 /opt/pera-plano/env/staging.env
```

## Running a deploy

GitHub → repo → Actions → **Deploy web** → Run workflow → pick `staging` or
`production`. Leave "Run security checks" on unless you're redeploying the same commit
after a fix and already know it's clean.

## Where the code and data actually live

`actions/checkout` clones into the runner's work directory
(`/opt/pera-plano/_work/...`), and that is where `docker compose` runs from. There is no
volume-backed state for this service (it's a stateless Next.js site), so a wiped
workspace loses nothing.

## What's still missing

- **`master` doesn't have `apps/web` yet** — the branch guard blocks every production
  dispatch until `feat/mvp-implementation` (or equivalent) merges to `master`.
- **PIC/DPO/NPC are placeholder values** (`TBA`) in the `production` Environment — see
  "Compliance config" above. Deploying today publishes those placeholders live.
- **Staging is deferred**: no domain/nginx vhost (reachable directly at
  `http://<box-ip>:3004` once used), no `staging` branch yet (the branch guard rejects a
  staging dispatch until one exists), and its compliance env file doesn't exist on the
  box yet.
- **The runner itself isn't registered/running yet** — see "Setting up the runner" above.
- **GitHub Environment protection rules** aren't configured. Add a required reviewer on
  `production` in Settings → Environments if you want a manual approval gate in front of
  the deploy job itself (on top of the `workflow_dispatch` trigger).
