# Deploying server/apps/web

Manual, environment-selectable deploys of the Next.js site (`server/apps/web`) to a
self-hosted box, driven from the GitHub Actions **Deploy web** workflow
(`.github/workflows/deploy.yml`).

**Scope:** web only. There is no backend API service in this repo yet — port 5005 is
reserved for it (see `docker-compose.yml`) — so this pipeline covers nothing beyond
`apps/web`. Extend it, don't replace it, once `apps/api` exists.

This mirrors the pattern already proven on `talyer-e-inventory` on the same box, adapted
to this repo's env-file-based config injection instead of GitHub-secret substitution
(see "Why env files, not GitHub secrets" below).

## How deploys are routed

The deploy job targets `runs-on: [self-hosted, linux, "${{ inputs.environment }}"]` — the
environment name **is** the runner label. Since staging and production both live on this
one box, register its runner with **both** `staging` and `production` labels (a single
runner can hold multiple labels).

`production` only deploys from the `master` branch; `staging` only deploys from the
`staging` branch. The workflow's "Guard branch/environment pairing" step enforces this —
a mismatched dispatch fails before touching the box.

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

## Compliance env files (must exist before either environment can boot)

`server/libs/common/src/config/env.ts` refuses to start in production if any of
`PIC_LEGAL_NAME`, `PIC_ADDRESS`, `DPO_NAME`, `DPO_EMAIL`, `SUPPORT_EMAIL`,
`NPC_REGISTRATION` is unset — these are the legal identifiers printed on the published
privacy notice, and a plausible-but-wrong value is worse than an outage. As of this
writing those roles are still unresolved (PIC entity, DPO, NPC registration), so **both**
staging and production containers will crash-loop until real values exist. That's the
gate working as designed, not a pipeline bug — see the error message the container
prints for the citation to each field's purpose.

The overlays read from absolute paths outside the git checkout, not from inside the repo:

```
/opt/pera-plano/env/staging.env
/opt/pera-plano/env/production.env
```

Absolute and outside the checkout on purpose: `actions/checkout` runs `git clean -ffdx`
by default, which would delete a file placed anywhere inside the repo working tree on
the very next deploy.

Create both files on the box (as the `runner` user, or root + chown), following
`server/.env.example` for the full key list:

```bash
mkdir -p /opt/pera-plano/env
$EDITOR /opt/pera-plano/env/staging.env
$EDITOR /opt/pera-plano/env/production.env
chmod 600 /opt/pera-plano/env/*.env
```

`PIC_*`/`DPO_*`/`NPC_REGISTRATION` will be identical between the two files (same legal
entity); `PUBLIC_BASE_URL` should differ once staging has its own address (see "What's
still missing" below).

## Why env files, not GitHub secrets

`talyer-e-inventory`'s deploy job passes secrets/vars from a GitHub Environment straight
into the Compose `environment:` block. This repo already committed to a different,
deliberate design instead (see the comment in `docker-compose.yml`'s git history): the
compliance values are legal identifiers, not application secrets, and are meant to be
edited directly on the box via `server/.env.local` / the files above — never baked into
the image, never round-tripped through CI. This pipeline preserves that design rather
than replacing it.

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

- **Staging has no domain or nginx vhost yet** — it's reachable directly at
  `http://<box-ip>:3004` until one exists. Production's vhost
  (`docs/nginx/peraplano-production.conf`) is the pattern to copy once a staging
  subdomain is chosen.
- **No `staging` branch exists yet** in this repo — create one before the first staging
  dispatch, or the branch guard rejects it.
- **GitHub Environments** (`staging`, `production`) aren't pre-configured with protection
  rules. Auto-created on first workflow run; add a required reviewer on `production` in
  Settings → Environments if you want a manual approval gate in front of the deploy job
  itself (on top of the `workflow_dispatch` trigger).
- **The compliance env files above don't exist on the box yet** — both environments will
  crash-loop until they do.
